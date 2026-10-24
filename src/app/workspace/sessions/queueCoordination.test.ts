// @vitest-environment happy-dom
/**
 * Two computers share one queue through the host. Real code under test: the
 * host's SessionQueues, SharedQueueClient, useSharedLocalQueues (dispatch and
 * Resume), the inline recovery notice and useQueuedMessageActions. Faked: the
 * RPC wire (the host's `sessions.queue.*` handlers over the real store) and
 * the provider turn.
 */
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueueDrainer } from "../../../../host/queue-drainer";
import { SessionQueues } from "../../../../host/session-queue";
import { QUEUE_LEASE_TTL_MS } from "../../../features/connections/model/sharedQueue";
import { DeliveryUnknownError } from "../../../shared/lib/deliveryUnknown";
import { CONTINUE_PROMPT } from "../../../features/sessions/model/inFlight";
import {
  appendQueuedMessage,
  sentQueuedMessage,
} from "../../../features/sessions/model/messageQueue";
import { newSession } from "../../../features/sessions/model/session";
import {
  queueHoldReason,
  resetLateSettlementsForTests,
} from "../../../features/sessions/model/deliveryReview";
import {
  clearDeliveryProgress,
  readDeliveryProgress,
} from "../../../features/sessions/model/deliveryProgress";
import {
  getSessions,
  resetSessionsStore,
  sessionsRef,
  setSessions,
  subscribeShell,
  useLiveSessions,
} from "../../../features/sessions/model/sessionsStore";
import { enqueueRemoteMessage } from "../../../features/connections/model/remoteQueue";
import {
  desktopQueueClientId,
  SharedQueueClient,
} from "../../../features/connections/model/sharedQueueClient";
import { SharedQueueRecoveryNotice } from "../../../features/connections/ui/SharedQueueRecoveryNotice";
import {
  HUNG_CLAIM_MS,
  heldSharedQueueLeases,
  markSharedProviderSend,
  noteSharedQueueLeases,
  sharedLocalQueueClaiming,
  sharedLocalQueueLeaseHeld,
  submitSharedLocalQueue,
  takeOverSharedLocalQueue,
  useSharedLocalQueues,
  wakeSharedLocalQueues,
} from "../../../features/connections/model/useSharedLocalQueues";
import { useQueuedMessageActions } from "./useQueuedMessageActions";

const hoisted = vi.hoisted(() => ({
  request: (..._args: unknown[]): Promise<unknown> => Promise.reject(new Error("unset")),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async () => [
    { id: "local", environmentId: "host", localHost: true, endpoint: "http://127.0.0.1:1" },
  ],
}));
vi.mock("../../../features/connections/model/connections", () => ({
  cachedRemoteCapabilities: () => ["sessions.queue"],
  loadRemoteCapabilities: async () => ["sessions.queue"],
  remoteRequest: (...args: unknown[]) => hoisted.request(...args),
}));
vi.mock("../../../features/connections/model/remoteAttachments", () => ({
  uploadRemoteAttachments: async (_machine: string, attachments: unknown[]) => attachments,
}));
vi.mock("../../../features/usage/model/usageBudgetReadings", () => ({
  assertUsageBudgets: () => {},
  blockingUsageBudgets: () => [],
}));

const SESSION = "chat";
const row = (id: string) => ({ id, text: id, attachments: [] as never[] });

/** The host's `sessions.queue.*` handlers (host/server.ts) over the real store. */
class Host {
  readonly queues = new SessionQueues(new DatabaseSync(":memory:"));
  unreachable = false;
  /** Runs before a call is served: another computer's write lands here. */
  before?: (method: string) => Promise<void> | void;
  readonly rpc = async (_machine: string, method: string, params: Record<string, any>) => {
    if (this.unreachable) throw new Error("Host unreachable");
    await this.before?.(method);
    const action = method.split(".").pop() as "get" | "change" | "claim" | "finish" | "lease";
    // The host reports a changed queue on the desktop's next heartbeat answer.
    if (action !== "get") setTimeout(() => wakeSharedLocalQueues([String(params.sessionId)]), 1500);
    return structuredClone(
      this.queues.serve(
        action,
        String(params.sessionId),
        String(params.clientId),
        params,
        action === "change" ? { before: params.before, after: params.after } : undefined,
      ),
    );
  };
}

const world = {
  host: new Host(),
  sent: [] as Array<{ id?: string; text: string }>,
  /** What the provider answers for a row the queue hands over. */
  mode: "accept" as "accept" | "refuse" | "unknown" | "hang" | "prepare" | "takeover",
  settle: undefined as undefined | ((value: "accepted" | "rejected" | "unknown") => void),
  hang: undefined as undefined | ((accepted: boolean) => void),
  status: [] as string[],
};

function startTurn(sessionId: string, text: string, options: any): boolean | Promise<boolean> {
  const session = getSessions().find((entry) => entry.id === sessionId)!;
  // The host runs this conversation for the other computer: a send is queued.
  if (session.continuingElsewhere && !session.busy) {
    if (options?.queuedMessageId) return false;
    setSessions((all) =>
      all.map((entry) =>
        entry.id === sessionId ? appendQueuedMessage(entry, row(`q-${text}`) as never) : entry,
      ),
    );
    return true;
  }
  if (world.mode === "refuse") return false;
  if (world.mode === "takeover") {
    // The mirror reports the host's turn after the dispatcher decided and claimed.
    setSessions((all) => all.map((entry) => ({ ...entry, continuingElsewhere: true })));
    return false;
  }
  if (world.mode === "unknown") {
    const settlement = new Promise<"accepted" | "rejected" | "unknown">(
      (resolve) => (world.settle = resolve),
    );
    throw new DeliveryUnknownError("late acknowledgement", settlement);
  }
  // Waiting for the run lease or a dialog: the provider has not been called yet.
  if (world.mode === "prepare") return new Promise<boolean>((resolve) => (world.hang = resolve));
  if (world.mode === "hang") {
    markSharedProviderSend(sessionId);
    return new Promise<boolean>((resolve) => (world.hang = resolve));
  }
  world.sent.push({ id: options?.queuedMessageId, text });
  setSessions((all) =>
    all.map((entry) => {
      if (entry.id !== sessionId) return entry;
      const next = options?.queuedMessageId
        ? sentQueuedMessage(entry, options.queuedMessageId)
        : entry;
      return { ...next, busy: true };
    }),
  );
  return true;
}
const finishTurn = () =>
  act(async () => setSessions((all) => all.map((entry) => ({ ...entry, busy: false }))));

// A queued row goes through the shared-queue claim (submitRouting).
const onSubmit = async (sessionId: string, text: string, attachments: any[], options: any) => {
  if (options?.queuedMessageId && !options.sharedQueueClaimed)
    return submitSharedLocalQueue(
      sessionId,
      options.queuedMessageId,
      options.followUpBehavior === "steer",
      (message) =>
        onSubmit(sessionId, message?.text ?? text, message?.attachments ?? attachments, {
          ...options,
          sharedQueueClaimed: true,
        }),
      () => true,
    );
  return startTurn(sessionId, text, options);
};

let actions!: ReturnType<typeof useQueuedMessageActions>;
let beat: ReturnType<typeof setInterval>;
let root: Root;
let container: HTMLElement;
const reachable = { current: true };
function Probe() {
  const sessions = useLiveSessions();
  useSharedLocalQueues(sessionsRef, setSessions, reachable, subscribeShell);
  const moves = useRef(new Set<string>());
  const retiring = useRef(new Map<string, number>());
  const pending = useRef(false);
  actions = useQueuedMessageActions({
    sessions,
    sessionsRef,
    setSessions,
    movingWindows: moves.current,
    movingSessionIds: moves,
    retiringTurns: retiring,
    windowTransferPending: false,
    windowTransferPendingRef: pending,
    onSubmit: onSubmit as never,
    enqueueHarnessEvent: (_id: string, event: any) => world.status.push(event.text),
    flushHarnessEvents: () => {},
    onStopRef: { current: () => {} },
  });
  return createElement(SharedQueueRecoveryNotice, { sessionId: SESSION });
}
async function pump(ms = 1500, steps = 1) {
  for (let i = 0; i < steps; i++)
    await act(async () => {
      vi.advanceTimersByTime(ms);
      for (let k = 0; k < 80; k++) await Promise.resolve();
    });
}
async function mount(patch: Record<string, unknown> = {}) {
  resetSessionsStore([
    {
      ...newSession("codex", "/repo"),
      id: SESSION,
      blocks: [{ id: "user", role: "user", text: "task" }],
      ...patch,
    } as never,
  ]);
  await act(async () => root.render(createElement(Probe)));
  await pump(0, 1);
}
const session = () => getSessions().find((entry) => entry.id === SESSION)!;
const hostQueue = () => world.host.queues.get(SESSION);
const resume = async () => {
  let result: unknown;
  let error: unknown;
  await act(async () => {
    await actions.onResumeQueue(SESSION).then(
      (value) => (result = value),
      (reason) => (error = reason),
    );
  });
  return { result, error };
};
const click = (label: string) =>
  act(async () => {
    [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === label)!
      .click();
    for (let i = 0; i < 100; i++) await Promise.resolve();
  });
const wire = (method: string, params: unknown) =>
  world.host.rpc("m", method, params as never) as never;
const upload = (async (_machine: string, files: unknown[]) => files) as never;
/** The other computer's client, as useSharedRemoteQueue creates it. */
const macClient = () =>
  new SharedQueueClient("m", "host", SESSION, "remote:mac-window-1", wire, upload);
async function macEnqueue(mac: SharedQueueClient, id: string) {
  if (!mac.snapshot().loaded) await mac.initialize();
  mac.update((queue) => enqueueRemoteMessage(queue, { id, text: id, attachments: [] }));
  await mac.sync();
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  world.host = new Host();
  world.sent = [];
  world.mode = "accept";
  world.settle = world.hang = undefined;
  world.status = [];
  reachable.current = true;
  // The desktop's heartbeat keeps its drain leases alive and reports a lost one.
  beat = setInterval(() => {
    const held = heldSharedQueueLeases();
    if (!held.length || world.host.unreachable) return;
    noteSharedQueueLeases(
      Object.fromEntries(
        held.map((lease) => [
          lease.sessionId,
          world.host.queues.renew(lease.sessionId, desktopQueueClientId, lease.epoch),
        ]),
      ),
    );
  }, 1500);
  hoisted.request = (...args: unknown[]) =>
    world.host.rpc(args[0] as string, args[1] as string, args[2] as never);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  resetLateSettlementsForTests();
  clearInterval(beat);
  await act(async () => root.unmount());
  resetSessionsStore([]);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("coordination never pauses the queue", () => {
  it("sends the head when the other computer appends a row between the desktop's read and its claim", async () => {
    let injected = false;
    const mac = macClient();
    world.host.before = async (method) => {
      if (method.endsWith(".claim") && !injected) {
        injected = true;
        await macEnqueue(mac, "from-mac");
      }
    };
    await mount({ queuedMessages: [row("a")], queueStatus: "active" });
    let everPaused = false;
    for (let i = 0; i < 12; i++) {
      await pump(1500, 1);
      everPaused ||= session().queueStatus === "paused" || hostQueue().status === "paused";
    }
    expect(injected).toBe(true);
    expect(everPaused).toBe(false);
    expect(world.status.join("|")).not.toMatch(/shared queue changed/i);
    expect(world.sent.map((s) => s.id)).toContain("a");
  });

  it("keeps the queue active when a refused send is explained by the host taking the conversation over", async () => {
    world.mode = "takeover";
    await mount({ queuedMessages: [row("a")], queueStatus: "active" });
    await pump(1500, 6);
    expect(session().continuingElsewhere).toBe(true);
    expect(session().queueStatus).not.toBe("paused");
    expect(hostQueue().status).not.toBe("paused");
    expect(hostQueue().claim).toBeUndefined();
  });

  it("keeps the queue active while the host is unreachable and offers the head again afterwards", async () => {
    world.host.before = (method) => {
      if (method.endsWith(".claim")) throw new Error("Host unreachable");
    };
    await mount({ queuedMessages: [row("a")], queueStatus: "active" });
    await pump(1500, 10);
    expect(session().queueStatus).not.toBe("paused");
    expect(world.status.join("|")).not.toMatch(/Host unreachable/);
    world.host.before = undefined;
    await pump(1500, 40);
    expect(world.sent.map((s) => s.id)).toEqual(["a"]);
  });

  it("pauses and releases the claim when a refused send has nothing to explain it", async () => {
    world.mode = "refuse";
    await mount({ queuedMessages: [row("a")], queueStatus: "active" });
    await pump(1500, 6);
    expect(session().queueStatus).toBe("paused");
    expect(hostQueue().status).toBe("paused");
    expect(hostQueue().claim).toBeUndefined();
  });
});

describe("Resume always does something visible", () => {
  it("retries a refused head directly, without a synthetic continue turn", async () => {
    world.mode = "refuse";
    await mount({ queuedMessages: [row("a")], queueStatus: "active" });
    await pump(1500, 6);
    expect(session().queueStatus).toBe("paused");
    world.mode = "accept";
    const { error } = await resume();
    await pump(1500, 6);
    expect(error).toBeUndefined();
    expect(world.sent).toEqual([{ id: "a", text: "a" }]);
    expect(hostQueue().messages).toEqual([]);
  });

  it("resumes an idle paused queue by sending its head, never a continue message", async () => {
    await mount({ queuedMessages: [row("a")], queueStatus: "paused" });
    const { error } = await resume();
    await pump(1500, 6);
    expect(error).toBeUndefined();
    expect(world.sent).toEqual([{ id: "a", text: "a" }]);
    expect(world.sent.map((s) => s.text)).not.toContain(CONTINUE_PROMPT);
    expect(hostQueue().messages).toEqual([]);
  });

  it("shows why the host holds the queue and drops the reason once Resume releases it", async () => {
    // The host paused it on its own turn's provider error.
    await world.host.rpc("m", "sessions.queue.change", {
      sessionId: SESSION,
      clientId: "remote:mac",
      before: { messages: [] },
      after: { messages: [row("a")], status: "active" },
    });
    world.host.queues.hold(SESSION, "Provider crashed");
    await mount({ queuedMessages: undefined, queueStatus: undefined });
    await pump(1500, 4);
    expect(session().queueStatus).toBe("paused");
    expect(queueHoldReason(SESSION)).toBe("Provider crashed");
    const { error } = await resume();
    await pump(1500, 6);
    expect(error).toBeUndefined();
    expect(queueHoldReason(SESSION)).toBeUndefined();
    expect((hostQueue() as { holdReason?: string }).holdReason).toBeUndefined();
    expect(world.sent).toEqual([{ id: "a", text: "a" }]);
  });

  it("resumes a queue that a refused head paused after the rejection fact is gone", async () => {
    world.mode = "refuse";
    await mount({ queuedMessages: [row("a")], queueStatus: "active" });
    await pump(1500, 6);
    expect(session().queueStatus).toBe("paused");
    // The owner edits the row (or the app restarts): the delivery record is gone.
    clearDeliveryProgress(SESSION, readDeliveryProgress(SESSION)!);
    world.mode = "accept";
    const { error } = await resume();
    await pump(1500, 6);
    expect(error).toBeUndefined();
    expect(world.sent).toEqual([{ id: "a", text: "a" }]);
  });

  it("answers an unconfirmed delivery with the inline choice instead of an error, and sends it again only when the owner says it never arrived", async () => {
    world.mode = "unknown";
    await mount({ queuedMessages: [row("a")], queueStatus: "active" });
    await pump(1500, 6);
    expect(hostQueue().claim?.id).toBe("a");
    world.mode = "accept";
    const held = await resume();
    expect(held.error).toBeUndefined();
    expect(held.result).toMatchObject({
      kind: "waiting",
      message: expect.stringMatching(/Choose what happened/),
    });
    expect(world.sent).toEqual([]);
    expect(hostQueue().claim?.id).toBe("a");
    expect(session().queueStatus).toBe("paused");
    expect(container.querySelector("[data-delivery-review]")).not.toBeNull();
    // The provider call is still open: it may yet deliver, so "Send again" is not
    // offered and the risk is written out where the choice is made.
    const sendAgain = () =>
      [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "Send again",
      )!;
    expect(sendAgain().disabled).toBe(true);
    expect(container.querySelector("[data-delivery-review-warning]")?.textContent).toMatch(
      /may still deliver this message/,
    );
    await act(async () => {
      world.settle?.("unknown");
      for (let i = 0; i < 100; i++) await Promise.resolve();
    });
    expect(sendAgain().disabled).toBe(false);
    expect(container.querySelector("[data-delivery-review-warning]")?.textContent).toMatch(
      /duplicates a message that was delivered/,
    );
    // The inline choice: it never arrived, send it again.
    await click("Send again");
    await pump(1500, 6);
    expect(world.sent).toEqual([{ id: "a", text: "a" }]);
    expect(container.querySelector("[data-delivery-review]")).toBeNull();
  });

  it("lets the owner mark an unconfirmed delivery as sent without sending it again", async () => {
    world.mode = "unknown";
    await mount({ queuedMessages: [row("a"), row("b")], queueStatus: "active" });
    await pump(1500, 6);
    world.mode = "accept";
    await resume();
    await click("Already delivered");
    await pump(1500, 4);
    expect(world.sent).toEqual([]);
    expect(hostQueue().claim).toBeUndefined();
    expect(hostQueue().messages.map((m) => m.id)).toEqual(["b"]);
    // The rest of the queue waits for the owner's Resume.
    expect(hostQueue().status).toBe("paused");
  });

  it("releases the claim and resumes after the provider's late answer was a rejection", async () => {
    world.mode = "unknown";
    await mount({ queuedMessages: [row("a")], queueStatus: "active" });
    await pump(1500, 6);
    await act(async () => {
      world.settle?.("rejected");
      for (let i = 0; i < 100; i++) await Promise.resolve();
    });
    world.mode = "accept";
    const { error } = await resume();
    await pump(1500, 6);
    expect(error).toBeUndefined();
    expect(hostQueue().claim).toBeUndefined();
  });

  it("does not throw while a claimed send is still waiting for the provider, and says so", async () => {
    world.mode = "hang";
    await mount({ queuedMessages: [row("a")], queueStatus: "active" });
    await pump(1500, 4);
    expect(sharedLocalQueueClaiming(SESSION)).toBe(true);
    setSessions((all) => all.map((entry) => ({ ...entry, queueStatus: "paused" as const })));
    world.mode = "accept"; // anything Resume itself submits must not hang too
    const { result, error } = await resume();
    expect(error).toBeUndefined();
    expect(result).toMatchObject({
      kind: "waiting",
      message: expect.stringMatching(/still waiting for confirmation/),
    });
    expect(sharedLocalQueueClaiming(SESSION)).toBe(true);
    expect(session().queueStatus).toBe("paused");
  });

  it("gives up on a provider call that never settles after the bounded timeout, without Stop", async () => {
    world.mode = "hang";
    await mount({ queuedMessages: [row("a")], queueStatus: "active" });
    await pump(1500, 4);
    setSessions((all) => all.map((entry) => ({ ...entry, queueStatus: "paused" as const })));
    await pump(HUNG_CLAIM_MS, 1);
    world.mode = "accept";
    const { result, error } = await resume();
    expect(error).toBeUndefined();
    expect(result).toMatchObject({
      kind: "waiting",
      message: expect.stringMatching(/Choose what happened/),
    });
    expect(sharedLocalQueueClaiming(SESSION)).toBe(false);
    // Held as unconfirmed: the row is neither lost nor sent again.
    expect(hostQueue().claim?.id).toBe("a");
    expect(world.sent).toEqual([]);
    expect(container.querySelector("[data-delivery-review]")).not.toBeNull();
    // The provider may still answer, so sending again could duplicate the message.
    const sendAgain = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Send again",
    )!;
    expect(sendAgain.disabled).toBe(true);
    expect(container.querySelector("[data-delivery-review-warning]")?.textContent).toMatch(
      /may still deliver this message/,
    );
    // The provider answers late: the held row settles exactly once, as delivered.
    await act(async () => {
      world.hang?.(true);
      for (let i = 0; i < 100; i++) await Promise.resolve();
    });
    await pump(1500, 3);
    expect(hostQueue().claim).toBeUndefined();
    expect(hostQueue().messages).toEqual([]);
    expect(container.querySelector("[data-delivery-review]")).toBeNull();
    expect(world.sent).toEqual([]);
  });

  it("does not count the preparation before the provider call towards a hung send", async () => {
    world.mode = "prepare";
    await mount({ queuedMessages: [row("a")], queueStatus: "active" });
    await pump(1500, 4);
    expect(sharedLocalQueueClaiming(SESSION)).toBe(true);
    setSessions((all) => all.map((entry) => ({ ...entry, queueStatus: "paused" as const })));
    // Far longer than the bound: the run lease or a dialog is what it waits for.
    await pump(HUNG_CLAIM_MS * 3, 1);
    const { result, error } = await resume();
    expect(error).toBeUndefined();
    expect(result).toMatchObject({
      kind: "waiting",
      message: expect.stringMatching(/still waiting for confirmation/),
    });
    expect(sharedLocalQueueClaiming(SESSION)).toBe(true);
    expect(container.querySelector("[data-delivery-review]")).toBeNull();
  });

  it("gives up only once the provider call itself has been open for the bound", async () => {
    world.mode = "hang";
    await mount({ queuedMessages: [row("a")], queueStatus: "active" });
    await pump(1500, 4);
    setSessions((all) => all.map((entry) => ({ ...entry, queueStatus: "paused" as const })));
    await pump(HUNG_CLAIM_MS - 10_000, 1);
    const young = await resume();
    expect(young.result).toMatchObject({ message: expect.stringMatching(/still waiting/) });
    expect(sharedLocalQueueClaiming(SESSION)).toBe(true);
    await pump(15_000, 1);
    const old = await resume();
    expect(old.result).toMatchObject({ message: expect.stringMatching(/Choose what happened/) });
  });

  it("removes a row the provider took after the owner kept it queued, so Resume cannot send it twice", async () => {
    world.mode = "hang";
    await mount({ queuedMessages: [row("a"), row("b")], queueStatus: "active" });
    await pump(1500, 4);
    setSessions((all) => all.map((entry) => ({ ...entry, queueStatus: "paused" as const })));
    await pump(HUNG_CLAIM_MS, 1);
    world.mode = "accept";
    await resume();
    await click("Keep queued, pause");
    await pump(1500, 3);
    expect(hostQueue().messages.map((m) => m.id)).toEqual(["a", "b"]);
    await act(async () => {
      world.hang?.(true);
      for (let i = 0; i < 100; i++) await Promise.resolve();
    });
    await pump(1500, 3);
    expect(hostQueue().messages.map((m) => m.id)).toEqual(["b"]);
    expect(world.sent).toEqual([]);
  });

  it("lets Stop free a hung send: the queue ends paused with the claim released", async () => {
    world.mode = "hang";
    await mount({ queuedMessages: [row("a")], queueStatus: "active" });
    await pump(1500, 4);
    await act(async () => {
      setSessions((all) => all.map((entry) => ({ ...entry, queueStatus: "paused" as const })));
      world.hang?.(false);
      for (let i = 0; i < 100; i++) await Promise.resolve();
    });
    await pump(1500, 3);
    expect(sharedLocalQueueClaiming(SESSION)).toBe(false);
    expect(hostQueue().claim).toBeUndefined();
    expect(hostQueue().status).toBe("paused");
  });

  it("resumes dispatch for a conversation the host runs elsewhere without inventing a continue message", async () => {
    await mount({ queuedMessages: [row("a")], queueStatus: "paused", continuingElsewhere: true });
    const { result, error } = await resume();
    await pump(1500, 4);
    expect(error).toBeUndefined();
    expect(result).toMatchObject({ kind: "waiting" });
    expect((session().queuedMessages ?? []).map((m) => m.text)).toEqual(["a"]);
    expect(session().queueStatus).toBe("active");
    expect(hostQueue().status).toBe("active");
    // The other computer's turn ends: the head goes out once.
    setSessions((all) => all.map((entry) => ({ ...entry, continuingElsewhere: undefined })));
    await pump(1500, 6);
    expect(world.sent).toEqual([{ id: "a", text: "a" }]);
  });
});

describe("a queue the other computer enqueued", () => {
  it("is drained by the desktop without a click: it takes the drain lease, nothing is restored", async () => {
    await macEnqueue(macClient(), "m1");
    await mount({ queuedMessages: undefined, queueStatus: undefined });
    await pump(1500, 6);
    expect(session().queueStatus).not.toBe("restored");
    expect(world.sent.map((s) => s.id)).toEqual(["m1"]);
    // The last row left: nobody holds an empty queue.
    expect(world.host.queues.live(hostQueue())).toBe(false);
  });

  it("is never claimed by a remote client", async () => {
    await macEnqueue(macClient(), "m1");
    await expect(
      world.host.rpc("m", "sessions.queue.claim", {
        sessionId: SESSION,
        clientId: "remote:mac-window-1",
        id: "m1",
        revision: hostQueue().revision,
      }),
    ).rejects.toThrow("Only the owning desktop claims local sends.");
    await expect(
      world.host.rpc("m", "sessions.queue.lease", {
        sessionId: SESSION,
        clientId: "remote:mac-window-1",
        leaseAware: true,
      }),
    ).rejects.toThrow(/desktop/);
  });

  it("is drained without a click once the Mac window that enqueued it is gone", async () => {
    // A Mac that does not know leases owns the queue by asking, as it always did.
    await world.host.rpc("m", "sessions.queue.change", {
      sessionId: SESSION,
      clientId: "remote:old-mac-window",
      before: { messages: [] },
      after: { messages: [row("m1")], status: "active" },
      takeOwnership: true,
    });
    await mount({ queuedMessages: undefined, queueStatus: undefined });
    await pump(1500, 8);
    // Its window is still there (it keeps asking): the queue is its own, nothing is
    // restored and nothing is sent by the desktop.
    expect(hostQueue().drain?.holder).toBe("remote:old-mac-window");
    expect(session().queueStatus).not.toBe("restored");
    expect(world.sent).toEqual([]);
    // The window is closed. At the end of its lease the desktop drains, no click.
    await pump(1500, Math.ceil(QUEUE_LEASE_TTL_MS / 1500) + 8);
    expect(world.sent.map((s) => s.id)).toEqual(["m1"]);
    expect(session().queueStatus).not.toBe("restored");
  });

  it("is drained once the other window of the same computer that enqueued first is gone", async () => {
    // Two windows share the host: the second enqueued while the first was away.
    const other = new SharedQueueClient("m", "host", SESSION, "desktop:other-window", wire, upload);
    await other.initialize();
    other.update((queue) => enqueueRemoteMessage(queue, { id: "w2", text: "w2", attachments: [] }));
    await other.sync();
    expect(hostQueue().drain?.holder).toBe("desktop:other-window");
    await mount({ queuedMessages: undefined, queueStatus: undefined });
    await pump(1500, 8);
    expect(world.sent).toEqual([]); // the other window holds it and is alive
    expect(session().queueStatus).not.toBe("restored");
    // That window goes away without a word: its lease runs out and this one drains.
    await pump(1500, Math.ceil(QUEUE_LEASE_TTL_MS / 1500) + 8);
    expect(world.sent.map((s) => s.id)).toEqual(["w2"]);
    expect(hostQueue().messages).toEqual([]);
  });

  it("is taken over by an explicit Resume while another window still holds the lease", async () => {
    const other = new SharedQueueClient("m", "host", SESSION, "desktop:other-window", wire, upload);
    await other.initialize();
    other.update((queue) => enqueueRemoteMessage(queue, { id: "w2", text: "w2", attachments: [] }));
    await other.sync();
    await mount({ queuedMessages: undefined, queueStatus: undefined });
    await pump(1500, 4);
    expect(world.sent).toEqual([]);
    const { error } = await resume();
    await pump(1500, 6);
    expect(error).toBeUndefined();
    expect(world.sent.map((s) => s.id)).toEqual(["w2"]);
  });

  it("shows that another window holds it and is taken over explicitly, without touching the queue", async () => {
    const other = new SharedQueueClient("m", "host", SESSION, "desktop:other-window", wire, upload);
    await other.initialize();
    other.update((queue) => enqueueRemoteMessage(queue, { id: "w2", text: "w2", attachments: [] }));
    await other.sync();
    await mount({ queuedMessages: undefined, queueStatus: undefined });
    await pump(1500, 4);
    // Held by the other window, which is alive: nothing here sends, and it says so.
    expect(sharedLocalQueueLeaseHeld(SESSION)).toBe(true);
    expect(world.sent).toEqual([]);
    expect(hostQueue().drain?.holder).toBe("desktop:other-window");
    await act(async () => {
      await takeOverSharedLocalQueue(SESSION);
    });
    expect(sharedLocalQueueLeaseHeld(SESSION)).toBe(false);
    expect(hostQueue().drain).toMatchObject({ holder: desktopQueueClientId, epoch: 2 });
    expect(hostQueue().messages.map((m) => m.id)).toEqual(["w2"]);
    expect(hostQueue().status).toBe("active");
    await pump(1500, 6);
    expect(world.sent.map((s) => s.id)).toEqual(["w2"]);
  });

  it("re-acquires a lease that lapsed in a throttled window without showing the queue as held by another", async () => {
    await mount({ queuedMessages: [row("a")], queueStatus: "active", busy: true });
    await pump(1500, 4);
    const lease = hostQueue().drain!;
    let heldByOther = false;
    // The window was throttled: no beat for longer than the lease.
    clearInterval(beat);
    await pump(QUEUE_LEASE_TTL_MS + 5_000, 1);
    heldByOther ||= sharedLocalQueueLeaseHeld(SESSION);
    // The next beat is told the lease is gone and the queue looks again at once.
    await act(async () => {
      noteSharedQueueLeases({ [SESSION]: null });
      for (let i = 0; i < 80; i++) await Promise.resolve();
    });
    heldByOther ||= sharedLocalQueueLeaseHeld(SESSION);
    await pump(1500, 2);
    heldByOther ||= sharedLocalQueueLeaseHeld(SESSION);
    expect(heldByOther).toBe(false);
    expect(hostQueue().drain).toMatchObject({
      holder: desktopQueueClientId,
      epoch: lease.epoch + 1,
    });
    expect(session().queueStatus).toBe("active");
    await finishTurn();
    await pump(1500, 8);
    expect(world.sent.map((s) => s.id)).toEqual(["a"]);
  });

  it("is reclaimed after an app restart under the same instance id", async () => {
    await mount({ queuedMessages: [row("a")], queueStatus: "active", busy: true });
    await pump(1500, 4);
    const lease = hostQueue().drain!;
    expect(lease.holder).toBe(desktopQueueClientId);
    // The app crashes and starts again: same window identity, new process. A
    // crash cannot give the lease back (a graceful quit does, and a new one is granted).
    world.host.unreachable = true;
    await act(async () => root.unmount());
    world.host.unreachable = false;
    root = createRoot(container);
    // The saved session comes back with its queue, waiting for the host's word on it.
    await mount({ queuedMessages: [row("a")], queueStatus: "restored", busy: true });
    await pump(1500, 4);
    expect(hostQueue().drain).toMatchObject({ holder: desktopQueueClientId, epoch: lease.epoch });
    expect(session().queuedMessages?.map((m) => m.id)).toEqual(["a"]);
    expect(session().queueStatus).toBe("active");
    await finishTurn();
    await pump(1500, 8);
    expect(world.sent.map((s) => s.id)).toEqual(["a"]);
  });

  it("is reclaimed under a new epoch when the restart took longer than the lease", async () => {
    await mount({ queuedMessages: [row("a")], queueStatus: "active", busy: true });
    await pump(1500, 4);
    const lease = hostQueue().drain!;
    await act(async () => root.unmount());
    await pump(QUEUE_LEASE_TTL_MS + 1000, 1);
    root = createRoot(container);
    await mount({ queuedMessages: [row("a")], queueStatus: "restored", busy: true });
    await pump(1500, 4);
    expect(hostQueue().drain).toMatchObject({
      holder: desktopQueueClientId,
      epoch: lease.epoch + 1,
    });
    await finishTurn();
    await pump(1500, 8);
    expect(world.sent.map((s) => s.id)).toEqual(["a"]);
  });

  it("is sent by the home host itself when no desktop is there", async () => {
    // No desktop window at all (the app is closed): the host's drainer sends it.
    const hostSent: string[] = [];
    let hostBusy = true;
    const drainer = new QueueDrainer(world.host.queues, {
      ready: () => !hostBusy,
      send: (_id, message) => {
        hostSent.push(message.id);
        hostBusy = true;
      },
      transaction: (action) => action(),
    });
    try {
      await macEnqueue(macClient(), "m1");
      await macEnqueue(macClient(), "m2");
      await pump(1500, 4);
      expect(hostSent).toEqual([]); // the host's own turn is running
      hostBusy = false;
      drainer.kick(SESSION); // the engine's settled event
      await pump(0, 2);
      expect(hostSent).toEqual(["m1"]);
      hostBusy = false;
      drainer.kick(SESSION);
      await pump(0, 2);
      expect(hostSent).toEqual(["m1", "m2"]);
      expect(hostQueue().messages).toEqual([]);
    } finally {
      drainer.close();
    }
  });

  it("fences a window that comes back after another one took the queue over", async () => {
    await mount({ queuedMessages: [row("a")], queueStatus: "active", busy: true });
    await pump(1500, 4);
    const stale = hostQueue();
    expect(stale.drain?.holder).toBe(desktopQueueClientId);
    world.host.queues.acquire(SESSION, "desktop:other-window", true);
    await expect(
      world.host.rpc("m", "sessions.queue.claim", {
        sessionId: SESSION,
        clientId: desktopQueueClientId,
        id: "a",
        revision: hostQueue().revision,
        epoch: stale.drain!.epoch,
        leaseAware: true,
      }),
    ).rejects.toThrow(/drain lease/);
  });
});

describe("both computers enqueue", () => {
  it("keeps both rows, unique, and sends each exactly once in queue order", async () => {
    const mac = macClient();
    await mount({ queuedMessages: [row("w1")], queueStatus: "active", busy: true });
    await pump(1500, 3);
    setSessions((all) =>
      all.map((entry) =>
        entry.id === SESSION ? appendQueuedMessage(entry, row("w2") as never) : entry,
      ),
    );
    await macEnqueue(mac, "m1");
    await pump(1500, 4);
    expect(
      hostQueue()
        .messages.map((m) => m.id)
        .sort(),
    ).toEqual(["m1", "w1", "w2"]);
    expect(
      session()
        .queuedMessages?.map((m) => m.id)
        .sort(),
    ).toEqual(["m1", "w1", "w2"]);
    for (let i = 0; i < 4; i++) {
      await finishTurn();
      await pump(1500, 8);
    }
    expect(world.sent.map((s) => s.id).sort()).toEqual(["m1", "w1", "w2"]);
    expect(new Set(world.sent.map((s) => s.id)).size).toBe(3);
    expect(hostQueue().messages).toEqual([]);
  });

  it("refuses the other computer's enqueue while a claim is in flight and takes it after the claim settles", async () => {
    const mac = macClient();
    let duringClaim: boolean | undefined;
    world.host.before = async (method) => {
      if (method.endsWith(".finish") && duringClaim === undefined) {
        await mac.initialize();
        duringClaim = mac.update((queue) =>
          enqueueRemoteMessage(queue, { id: "m1", text: "m1", attachments: [] }),
        );
      }
    };
    await mount({ queuedMessages: [row("w1")], queueStatus: "active" });
    await pump(1500, 12);
    world.host.before = undefined;
    await mac.sync();
    const afterClaim = mac.update((queue) =>
      enqueueRemoteMessage(queue, { id: "m1", text: "m1", attachments: [] }),
    );
    await mac.sync();
    await finishTurn();
    for (let waited = 0; waited < 120 && world.sent.length < 2; waited += 15) {
      await pump(1500, 10);
      await finishTurn();
    }
    expect(duringClaim).toBe(false);
    expect(afterClaim).toBe(true);
    expect(world.sent.map((s) => s.id)).toEqual(["w1", "m1"]);
  });
});
