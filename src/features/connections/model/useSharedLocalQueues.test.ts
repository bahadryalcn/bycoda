// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
import {
  mergeQueueChange,
  QUEUE_LEASE_TTL_MS,
  QueueNotReadyError,
  type SharedQueue,
} from "./sharedQueue";
import { desktopQueueClientId } from "./sharedQueueClient";
import { notifyLocalHostReachable } from "./hostWake";
import { DeliveryUnknownError, type DeliverySettlement } from "../../../shared/lib/deliveryUnknown";
import { resetLateSettlementsForTests } from "../../sessions/model/deliveryReview";
import { readDeliveryProgress } from "../../sessions/model/deliveryProgress";
import { DatabaseSync } from "node:sqlite";
import { SessionQueues } from "../../../../host/session-queue";
import {
  heldSharedQueueLeases,
  sharedLocalQueueReady,
  resumeSharedLocalQueue,
  submitSharedLocalQueue,
  useSharedLocalQueues,
  useLocalSharedQueueClient,
  wakeSharedLocalQueues,
} from "./useSharedLocalQueues";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async () => [
    { id: "local", environmentId: "host", localHost: true, endpoint: "http://127.0.0.1:1" },
  ],
}));
vi.mock("./connections", () => ({
  cachedRemoteCapabilities: () => ["sessions.queue"],
  loadRemoteCapabilities: async () => ["sessions.queue"],
  remoteRequest: (...args: unknown[]) => mocks.request(...args),
}));
vi.mock("./remoteAttachments", () => ({
  uploadRemoteAttachments: async (_machine: string, attachments: unknown[]) => attachments,
}));

let root: Root;
let queue: SharedQueue;
let sessionsRef: { current: Session[] };
/** The workspace store's change notifications (`subscribeShell`). */
const sessionListeners = new Set<() => void>();
const subscribeSessions = (listener: () => void) => {
  sessionListeners.add(listener);
  return () => void sessionListeners.delete(listener);
};
/** Every write to the list tells the subscribers, as the store does. */
function observed(initial: Session[]): { current: Session[] } {
  let value = initial;
  return {
    get current() {
      return value;
    },
    set current(next: Session[]) {
      value = next;
      sessionListeners.forEach((listener) => listener());
    },
  };
}
let localClient: ReturnType<typeof useLocalSharedQueueClient>;
const reachable = { current: true };
const row = (id: string, text = id) => ({ id, text, attachments: [] });
const setSessions = (update: (sessions: Session[]) => Session[]) => {
  sessionsRef.current = update(sessionsRef.current);
};
function Probe() {
  useSharedLocalQueues(sessionsRef, setSessions, reachable, subscribeSessions);
  localClient = useLocalSharedQueueClient("chat");
  return null;
}
beforeEach(() => {
  mocks.request.mockReset();
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  queue = { messages: [], revision: 0 };
  sessionListeners.clear();
  sessionsRef = observed([
    {
      id: "chat",
      cwd: "/repo",
      blocks: [{ id: "user", role: "user", text: "task" }],
      queuedMessages: [row("a")],
      queueStatus: "active",
    } as Session,
  ]);
  mocks.request.mockImplementation(async (_machine, method, params) => {
    if (method.endsWith(".change"))
      queue = {
        ...mergeQueueChange(queue, {
          before: params.before,
          after: params.after,
        }),
        // A host from before drain leases: the first owner is permanent.
        ...(params.takeOwnership ? { consumer: params.clientId } : {}),
        revision: queue.revision + 1,
      };
    if (method.endsWith(".claim"))
      queue = {
        ...queue,
        revision: queue.revision + 1,
        claim: { id: params.id, clientId: params.clientId, token: "claimed" },
      };
    if (method.endsWith(".finish"))
      queue = {
        ...queue,
        revision: queue.revision + 1,
        messages: params.accepted
          ? queue.messages.filter((message) => message.id !== queue.claim?.id)
          : queue.messages,
        claim: undefined,
      };
    return structuredClone(queue);
  });
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  resetLateSettlementsForTests();
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => {
    root.render(createElement(Probe));
  });
  await act(async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
}
async function tick() {
  await act(async () => {
    vi.advanceTimersByTime(1500);
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
}

/** The host's heartbeat answer naming the queue another computer changed. */
async function wake(ids = ["chat"]) {
  await act(async () => {
    wakeSharedLocalQueues(ids);
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
}

it("publishes a local queue and applies edits from the other computer without replacing the transcript", async () => {
  const blocks = sessionsRef.current[0].blocks;
  await mount();
  expect(queue.messages).toEqual([row("a")]);
  expect(sharedLocalQueueReady("chat")).toBe(true);
  queue = {
    ...queue,
    messages: [row("a", "edited remotely"), row("b")],
    revision: queue.revision + 1,
  };
  await wake();
  expect(sessionsRef.current[0].queuedMessages?.map((message) => message.text)).toEqual([
    "edited remotely",
    "b",
  ]);
  expect(sessionsRef.current[0].blocks).toBe(blocks);
});

it("preserves a new local row created while the host poll is pending", async () => {
  await mount();
  const original = mocks.request.getMockImplementation()!;
  let resolve!: (value: SharedQueue) => void;
  mocks.request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const polling = wake();
  await act(async () => {
    await Promise.resolve();
  });
  sessionsRef.current = [{ ...sessionsRef.current[0], queuedMessages: [row("a"), row("new")] }];
  await act(async () => resolve(structuredClone(queue)));
  await polling;
  mocks.request.mockImplementation(original);
  await wake();
  expect(queue.messages.map((message) => message.id)).toEqual(["a", "new"]);
  expect(sessionsRef.current[0].queuedMessages?.map((message) => message.id)).toEqual(["a", "new"]);
});

it("reserves a local queued send until acceptance and prevents a second sender", async () => {
  await mount();
  let accept!: (value: boolean) => void;
  const send = vi.fn(
    () =>
      new Promise<boolean>((done) => {
        accept = done;
      }),
  );
  const first = submitSharedLocalQueue("chat", "a", false, send);
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
  expect(send).toHaveBeenCalledOnce();
  expect(await submitSharedLocalQueue("chat", "a", false, send)).toBe(false);
  expect(sharedLocalQueueReady("chat")).toBe(false);
  accept(true);
  expect(await first).toBe(true);
  expect(queue.messages).toEqual([]);
});

it("holds the queue when Stop invalidates preparation instead of launching another turn", async () => {
  await mount();
  const send = vi.fn(() => true);
  sessionsRef.current = [{ ...sessionsRef.current[0], queueStatus: "paused" }];
  expect(await submitSharedLocalQueue("chat", "a", true, send, () => false)).toBe(false);
  expect(send).not.toHaveBeenCalled();
  await tick();
  expect(queue.messages).toEqual([row("a")]);
  expect(queue.status).toBe("paused");
});

it("recovers a synchronization failure and steers on the same click", async () => {
  await mount();
  mocks.request.mockRejectedValueOnce(new Error("temporary connection failure"));
  await wake();
  const send = vi.fn(() => true);
  expect(await submitSharedLocalQueue("chat", "a", true, send)).toBe(true);
  expect(send).toHaveBeenCalledOnce();
  expect(queue.messages).toEqual([]);
});

it("durably releases a paused shared queue without sending a message", async () => {
  await mount();
  sessionsRef.current = [{ ...sessionsRef.current[0], queueStatus: "resuming", busy: true }];
  await resumeSharedLocalQueue("chat");
  expect(queue.status).toBe("active");
  expect(queue.messages).toEqual([row("a")]);
  expect(sharedLocalQueueReady("chat")).toBe(true);
});

it("keeps a shared queue paused when Stop cancels Resume", async () => {
  await mount();
  sessionsRef.current = [{ ...sessionsRef.current[0], queueStatus: "paused" }];
  await expect(resumeSharedLocalQueue("chat", () => false)).rejects.toThrow("cancelled");
  expect(queue.status).toBe("paused");
  expect(queue.messages).toEqual([row("a")]);
});

it.each(["paused", "restored"] as const)(
  "does not release a %s queue when the selected Steer is rejected",
  async (status) => {
    sessionsRef.current[0].queueStatus = status;
    await mount();
    expect(await submitSharedLocalQueue("chat", "a", true, () => false)).toBe(false);
    expect(queue.messages.map((message) => message.id)).toEqual(["a"]);
    expect(queue.status).toBe(status);
    expect(sessionsRef.current[0].queueStatus).toBe(status);
    expect(readDeliveryProgress("chat")?.stage).toBe("rejected");
  },
);

it("polls empty idle queues less frequently but still discovers remotely added messages", async () => {
  sessionsRef.current[0].queuedMessages = [];
  await mount();
  const before = mocks.request.mock.calls.length;
  await tick();
  expect(mocks.request.mock.calls).toHaveLength(before);
  queue = { ...queue, messages: [row("remote")], revision: queue.revision + 1 };
  // Idle queues are re-read on a one-minute safety cadence.
  await act(async () => {
    vi.advanceTimersByTime(60_000);
    for (let i = 0; i < 60; i++) await Promise.resolve();
  });
  expect(sessionsRef.current[0].queuedMessages?.map((message) => message.id)).toEqual(["remote"]);
});

it("prioritizes the active queue and bounds idle initialization across many sessions", async () => {
  const active = sessionsRef.current[0];
  sessionsRef.current = [
    ...Array.from({ length: 100 }, (_, index) => ({
      ...active,
      id: `idle-${index}`,
      queuedMessages: [],
      queueStatus: undefined,
    })),
    active,
  ];
  const queues = new Map<string, SharedQueue>();
  mocks.request.mockImplementation(async (_machine, method, params) => {
    const previous = queues.get(params.sessionId) ?? { messages: [], revision: 0 };
    const value = method.endsWith(".change")
      ? {
          ...mergeQueueChange(previous, {
            before: params.before,
            after: params.after,
          }),
          ...(params.takeOwnership ? { consumer: params.clientId } : {}),
          revision: previous.revision + 1,
        }
      : previous;
    queues.set(params.sessionId, value);
    return structuredClone(value);
  });
  await mount();
  await act(async () => {
    for (let i = 0; i < 300; i++) await Promise.resolve();
  });
  const firstIds = [...new Set(mocks.request.mock.calls.map((call) => call[2].sessionId))];
  expect(firstIds[0]).toBe("chat");
  expect(firstIds).toHaveLength(9);
  expect(sharedLocalQueueReady("chat")).toBe(true);
  await tick();
  await act(async () => {
    for (let i = 0; i < 300; i++) await Promise.resolve();
  });
  const nextIds = [...new Set(mocks.request.mock.calls.map((call) => call[2].sessionId))];
  expect(nextIds).toHaveLength(17);
});

it("reconciles a late provider acknowledgement without sending the row twice", async () => {
  await mount();
  let settle!: (value: DeliverySettlement) => void;
  const settlement = new Promise<DeliverySettlement>((resolve) => {
    settle = resolve;
  });
  const send = vi.fn(() => {
    throw new DeliveryUnknownError("late acknowledgement", settlement);
  });
  await expect(submitSharedLocalQueue("chat", "a", true, send)).rejects.toThrow(
    "late acknowledgement",
  );
  expect(queue.claim?.id).toBe("a");
  expect(queue.messages).toHaveLength(1);
  expect(readDeliveryProgress("chat")?.stage).toBe("unknown");
  await act(async () => {
    settle("accepted");
    for (let i = 0; i < 100; i++) await Promise.resolve();
  });
  expect(send).toHaveBeenCalledOnce();
  expect(queue.messages).toEqual([]);
  expect(queue.claim).toBeUndefined();
  expect(readDeliveryProgress("chat")?.stage).toBe("accepted");
});

it("does not rewrite an already reviewed claim journal when a late acknowledgement arrives", async () => {
  await mount();
  let settle!: (value: DeliverySettlement) => void;
  const settlement = new Promise<DeliverySettlement>((resolve) => {
    settle = resolve;
  });
  const send = vi.fn(() => {
    throw new DeliveryUnknownError("late acknowledgement", settlement);
  });
  await expect(submitSharedLocalQueue("chat", "a", true, send)).rejects.toThrow();
  await tick();
  expect(localClient?.snapshot().recovery).toBeTruthy();
  await localClient!.resolveRecovery(false);
  expect(queue.claim).toBeUndefined();
  await act(async () => {
    settle("accepted");
    for (let i = 0; i < 100; i++) await Promise.resolve();
  });
  await expect(localClient!.sync()).resolves.toBeUndefined();
  expect(localClient?.snapshot().error).toBeUndefined();
  expect(send).toHaveBeenCalledOnce();
  // The provider did take the message after the owner kept it queued: it is delivered,
  // so it leaves the queue instead of being sent a second time on the next Resume.
  expect(queue.messages).toEqual([]);
  expect(readDeliveryProgress("chat")?.stage).toBe("accepted");
});

it("does not pause the queue when Send now is refused because another computer runs the conversation", async () => {
  const host = useRealHostQueue();
  await mount();
  const send = vi.fn(() => {
    // The mirror reports the other computer's turn after the claim was made.
    sessionsRef.current = [{ ...sessionsRef.current[0], continuingElsewhere: true }];
    return false;
  });
  expect(await submitSharedLocalQueue("chat", "a", true, send)).toBe(false);
  await tick();
  expect(host.queues.get("chat")).toMatchObject({ messages: [row("a")], status: "active" });
  expect(host.queues.get("chat").claim).toBeUndefined();
  expect(sessionsRef.current[0].queueStatus).toBe("active");
  // The coordination failure is reported inline, not as a refusal of the message.
  expect(readDeliveryProgress("chat")).toMatchObject({
    stage: "rejected",
    detail: expect.stringMatching(/Another computer is running this conversation/),
  });
});

it("still pauses the queue when the running turn itself refuses a Send now", async () => {
  const host = useRealHostQueue();
  sessionsRef.current[0].busy = true;
  await mount();
  expect(await submitSharedLocalQueue("chat", "a", true, () => false)).toBe(false);
  await tick();
  expect(host.queues.get("chat")).toMatchObject({ messages: [row("a")], status: "paused" });
});

it("stops renewing the lease of a conversation that left this window", async () => {
  const host = useRealHostQueue();
  await mount();
  expect(heldSharedQueueLeases()).toEqual([{ sessionId: "chat", epoch: 1 }]);
  expect(localClient).toBeDefined();
  // The conversation moved to another window.
  await act(async () => {
    sessionsRef.current = [];
  });
  expect(heldSharedQueueLeases()).toEqual([]);
  expect(localClient).toBeUndefined();
  // Nobody renews it: it runs out and the window that shows it now takes the queue.
  await act(async () => {
    vi.advanceTimersByTime(QUEUE_LEASE_TTL_MS + 1_000);
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
  expect(host.queues.live(host.queues.get("chat"))).toBe(false);
  host.queues.acquire("chat", "desktop:new-window");
  expect(host.queues.get("chat").drain).toMatchObject({ holder: "desktop:new-window" });
});

it("keeps a Resume in flight local: the host never sees it and a read does not cancel it", async () => {
  sessionsRef.current[0].queueStatus = "paused";
  await mount();
  expect(queue.status).toBe("paused");
  sessionsRef.current = [{ ...sessionsRef.current[0], queueStatus: "resuming" }];
  await wake();
  expect(queue.status).toBe("paused");
  expect(sessionsRef.current[0].queueStatus).toBe("resuming");
});

/** The host's durable queue behind the same RPC surface the desktop calls. */
function useRealHostQueue(onCall?: (method: string, params: Record<string, unknown>) => void) {
  const queues = new SessionQueues(new DatabaseSync(":memory:"));
  mocks.request.mockImplementation(async (_machine, method, params) => {
    onCall?.(method, params);
    const action = method.split(".").pop() as "get" | "change" | "claim" | "finish" | "lease";
    return structuredClone(
      queues.serve(
        action,
        String(params.sessionId),
        String(params.clientId),
        params,
        action === "change" ? { before: params.before, after: params.after } : undefined,
      ),
    );
  });
  /** What another computer does: append a row to the shared queue. */
  const remoteAppend = (rowId: string) => {
    const current = queues.get("chat");
    queues.change("chat", current, {
      ...current,
      messages: [...current.messages, row(rowId)],
      status: current.status ?? "active",
    });
  };
  return { queues, remoteAppend };
}

it("retries the claim when another computer appends a row between the desktop's read and its claim", async () => {
  let injected = false;
  const host = useRealHostQueue((method) => {
    if (method.endsWith(".claim") && !injected) {
      injected = true;
      host.remoteAppend("b");
    }
  });
  await mount();
  const send = vi.fn(() => true);
  expect(await submitSharedLocalQueue("chat", "a", false, send)).toBe(true);
  expect(send).toHaveBeenCalledOnce();
  expect(host.queues.get("chat").messages.map((message) => message.id)).toEqual(["b"]);
  expect(host.queues.get("chat").claim).toBeUndefined();
});

it("leaves the queue untouched when the host cannot be asked before anything is sent", async () => {
  let down = false;
  const host = useRealHostQueue((method) => {
    if (down && !method.endsWith(".change")) throw new Error("Host unreachable");
  });
  await mount();
  down = true;
  const send = vi.fn(() => true);
  await expect(submitSharedLocalQueue("chat", "a", false, send)).rejects.toBeInstanceOf(
    QueueNotReadyError,
  );
  expect(send).not.toHaveBeenCalled();
  down = false;
  await tick();
  expect(host.queues.get("chat")).toMatchObject({ messages: [row("a")], status: "active" });
  expect(sessionsRef.current[0].queueStatus).toBe("active");
});

it("does not pause the queue when the host starts running the conversation while its head is being claimed", async () => {
  const host = useRealHostQueue();
  await mount();
  // The mirror marks the conversation as continuing on the host after the
  // dispatcher decided to send, so the send is refused for now.
  const send = vi.fn(() => {
    sessionsRef.current = [{ ...sessionsRef.current[0], continuingElsewhere: true }];
    return false;
  });
  expect(await submitSharedLocalQueue("chat", "a", false, send)).toBe(false);
  await tick();
  expect(host.queues.get("chat")).toMatchObject({ messages: [row("a")], status: "active" });
  expect(host.queues.get("chat").claim).toBeUndefined();
  expect(sessionsRef.current[0].queueStatus).toBe("active");
});

it("still pauses the queue when a refused send has no waiting state to explain it", async () => {
  const host = useRealHostQueue();
  await mount();
  expect(await submitSharedLocalQueue("chat", "a", false, () => false)).toBe(false);
  await tick();
  expect(host.queues.get("chat")).toMatchObject({ messages: [row("a")], status: "paused" });
});

it("picks up a row another computer queued on an idle conversation as soon as the host reports it, even while the window is hidden", async () => {
  const host = useRealHostQueue();
  await mount();
  // The desktop owns the queue and has sent everything: the conversation is idle.
  sessionsRef.current = [
    { ...sessionsRef.current[0], queuedMessages: undefined, queueStatus: undefined },
  ];
  await tick();
  expect(host.queues.get("chat").messages).toEqual([]);
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  try {
    host.remoteAppend("from-phone");
    // Idle queues are only re-read on the slow safety cadence, never while hidden.
    await tick();
    expect(sessionsRef.current[0].queuedMessages).toBeUndefined();
    // The host's heartbeat answer names the changed queue: it is read at once.
    await act(async () => {
      wakeSharedLocalQueues(["chat"]);
      for (let i = 0; i < 60; i++) await Promise.resolve();
    });
    expect(sessionsRef.current[0].queuedMessages?.map((message) => message.id)).toEqual([
      "from-phone",
    ]);
    expect(sessionsRef.current[0].queueStatus).toBe("active");
    expect(sharedLocalQueueReady("chat")).toBe(true);
  } finally {
    hidden.mockRestore();
  }
});

// Wake parity: with no interval, each of these reaches the host at once.
const hostCalls = (method: string) =>
  mocks.request.mock.calls.filter((call) => String(call[1]).endsWith(method)).length;
const flush = () =>
  act(async () => {
    for (let i = 0; i < 60; i++) await Promise.resolve();
  });

it("publishes a local queue edit at once, without waiting for a timer", async () => {
  await mount();
  sessionsRef.current = [{ ...sessionsRef.current[0], queuedMessages: [row("a"), row("typed")] }];
  await flush();
  expect(queue.messages.map((message) => message.id)).toEqual(["a", "typed"]);
});

it("reads a busy conversation's queue when its turn settles, and not before", async () => {
  sessionsRef.current = [{ ...sessionsRef.current[0], busy: true }];
  await mount();
  await act(async () => {
    vi.advanceTimersByTime(30_000);
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
  const before = hostCalls(".get");
  // A turn running for thirty seconds read nothing: no interactive queue is polled.
  expect(before).toBeLessThanOrEqual(2);
  sessionsRef.current = [{ ...sessionsRef.current[0], busy: false }];
  await flush();
  expect(hostCalls(".get")).toBeGreaterThan(before);
});

it("catches up the interactive queues on focus and when the window is shown again", async () => {
  await mount();
  const base = hostCalls(".get");
  window.dispatchEvent(new Event("focus"));
  await flush();
  const focused = hostCalls(".get");
  expect(focused).toBeGreaterThan(base);
  document.dispatchEvent(new Event("visibilitychange"));
  await flush();
  expect(hostCalls(".get")).toBeGreaterThan(focused);
});

it("looks again as soon as the local host is reachable", async () => {
  reachable.current = false;
  try {
    await mount();
    expect(mocks.request).not.toHaveBeenCalled();
    reachable.current = true;
    notifyLocalHostReachable();
    await flush();
    expect(queue.messages).toEqual([row("a")]);
  } finally {
    reachable.current = true;
  }
});

it("takes the queue over when another window's lease runs out, with one timer and no tick", async () => {
  const host = useRealHostQueue();
  host.queues.change(
    "chat",
    { messages: [], revision: 0 },
    { messages: [row("a")], status: "active" },
  );
  host.queues.serve("lease", "chat", "desktop:other-window", { leaseAware: true }, undefined);
  await mount();
  expect(host.queues.get("chat").drain?.holder).toBe("desktop:other-window");
  expect(sharedLocalQueueReady("chat")).toBe(false);
  await act(async () => {
    vi.advanceTimersByTime(QUEUE_LEASE_TTL_MS - 5_000);
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
  expect(host.queues.get("chat").drain?.holder).toBe("desktop:other-window");
  await act(async () => {
    vi.advanceTimersByTime(6_000);
    for (let i = 0; i < 60; i++) await Promise.resolve();
  });
  expect(host.queues.get("chat").drain?.holder).toBe(desktopQueueClientId);
  expect(sharedLocalQueueReady("chat")).toBe(true);
});

it("backs off while the host answers with errors instead of retrying every tick", async () => {
  await mount();
  mocks.request.mockReset();
  mocks.request.mockRejectedValue(new Error("Host unreachable"));
  await wake();
  await act(async () => {
    for (let elapsed = 0; elapsed < 60_000; elapsed += 500) {
      vi.advanceTimersByTime(500);
      for (let i = 0; i < 20; i++) await Promise.resolve();
    }
  });
  // The old 1.5 s tick retried about forty times a minute.
  expect(mocks.request.mock.calls.length).toBeLessThanOrEqual(10);
});

it("does not resume while a given-up send may still be answered, and resumes once it has been", async () => {
  await mount();
  let settle!: (value: DeliverySettlement) => void;
  const settlement = new Promise<DeliverySettlement>((resolve) => {
    settle = resolve;
  });
  const send = vi.fn(() => {
    throw new DeliveryUnknownError("late acknowledgement", settlement);
  });
  await expect(submitSharedLocalQueue("chat", "a", true, send)).rejects.toThrow();
  await tick();
  // "Keep queued, pause": the row stays, the provider call is still open.
  await localClient!.resolveRecovery(false);
  expect(queue.claim).toBeUndefined();
  expect(queue.messages.map((message) => message.id)).toEqual(["a"]);
  expect(await resumeSharedLocalQueue("chat")).toBe("late");
  expect(sharedLocalQueueReady("chat")).toBe(false);
  expect(queue.status).not.toBe("active");
  await act(async () => {
    settle("rejected");
    for (let i = 0; i < 100; i++) await Promise.resolve();
  });
  expect(await resumeSharedLocalQueue("chat")).toBe("resumed");
  expect(queue.status).toBe("active");
});

it("tells the host a held lease cannot send while the conversation diverged from its host copy", async () => {
  useRealHostQueue();
  await mount();
  expect(heldSharedQueueLeases()).toEqual([{ sessionId: "chat", epoch: 1 }]);
  await act(async () => {
    sessionsRef.current = sessionsRef.current.map((session) => ({
      ...session,
      adoptedSyncConflict: true,
    })) as Session[];
  });
  expect(heldSharedQueueLeases()).toEqual([{ sessionId: "chat", epoch: 1, blocked: true }]);
});

function releasing() {
  const released: unknown[] = [];
  const host = useRealHostQueue();
  const serve = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (machine, method, params) => {
    if (String(method).endsWith(".release")) {
      released.push(params.epoch);
      return null;
    }
    return serve(machine, method, params);
  });
  return { host, released };
}

it("gives the lease back when the window closes", async () => {
  const { host, released } = releasing();
  await mount();
  expect(host.queues.live(host.queues.get("chat"))).toBe(true);
  await act(async () => {
    window.dispatchEvent(new Event("pagehide"));
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
  expect(released).toEqual([1]);
});

it("gives the lease back when the conversation leaves the window", async () => {
  const { released } = releasing();
  await mount();
  await act(async () => {
    sessionsRef.current = [];
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
  expect(released).toEqual([1]);
});
