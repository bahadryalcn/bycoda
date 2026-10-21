// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
import { mergeQueueChange, type SharedQueue } from "./sharedQueue";
import { DeliveryUnknownError, type DeliverySettlement } from "../../../shared/lib/deliveryUnknown";
import { readDeliveryProgress } from "../../sessions/model/deliveryProgress";
import {
  sharedLocalQueueReady,
  resumeSharedLocalQueue,
  submitSharedLocalQueue,
  useSharedLocalQueues,
  useLocalSharedQueueClient,
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
let localClient: ReturnType<typeof useLocalSharedQueueClient>;
const reachable = { current: true };
const row = (id: string, text = id) => ({ id, text, attachments: [] });
const setSessions = (update: (sessions: Session[]) => Session[]) => {
  sessionsRef.current = update(sessionsRef.current);
};
function Probe() {
  useSharedLocalQueues(sessionsRef, setSessions, reachable);
  localClient = useLocalSharedQueueClient("chat");
  return null;
}
beforeEach(() => {
  mocks.request.mockReset();
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  queue = { messages: [], revision: 0 };
  sessionsRef = {
    current: [
      {
        id: "chat",
        cwd: "/repo",
        blocks: [{ id: "user", role: "user", text: "task" }],
        queuedMessages: [row("a")],
        queueStatus: "active",
      } as Session,
    ],
  };
  mocks.request.mockImplementation(async (_machine, method, params) => {
    if (method.endsWith(".change"))
      queue = {
        ...mergeQueueChange(queue, {
          before: params.before,
          after: params.after,
          consumer: params.takeOwnership ? params.clientId : undefined,
        }),
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
  await tick();
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
  const polling = tick();
  await act(async () => {
    await Promise.resolve();
  });
  sessionsRef.current = [{ ...sessionsRef.current[0], queuedMessages: [row("a"), row("new")] }];
  await act(async () => resolve(structuredClone(queue)));
  await polling;
  mocks.request.mockImplementation(original);
  await tick();
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
  await tick();
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
  await act(async () => {
    vi.advanceTimersByTime(10_000);
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
            consumer: params.takeOwnership ? params.clientId : undefined,
          }),
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
  expect(queue.status).toBe("paused");
  expect(send).toHaveBeenCalledOnce();
});
