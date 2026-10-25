import { StoreDatabase } from "./store-db";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isTransientDrainError, QueueDrainer, queueRowCommands } from "./queue-drainer";
import { CLAIM_GRACE_MS, QUEUE_STALL_MS, SessionQueues } from "./session-queue";
import { RunLeases } from "./run-lease";
import { QUEUE_LEASE_TTL_MS } from "../src/features/connections/model/sharedQueue";
import { RUN_LEASE_TTL_MS } from "../src/features/sync/model/runLease";

const row = (id: string, extra: object = {}) => ({ id, text: id, attachments: [], ...extra });
const databases: StoreDatabase[] = [];
const drainers: QueueDrainer[] = [];

function setup(ready = true) {
  const db = new StoreDatabase(":memory:");
  databases.push(db);
  const queues = new SessionQueues(db);
  const world = { ready, sent: [] as string[], refuse: undefined as string | undefined };
  const drainer = new QueueDrainer(queues, {
    ready: () => world.ready,
    send: (_id, message) => {
      if (world.refuse) throw new Error(world.refuse);
      world.sent.push(message.id);
      world.ready = false; // the turn it started is running
    },
    transaction: async (action) => await action(),
  });
  drainers.push(drainer);
  const enqueue = async (id = "chat", owner?: string, status: "active" | "paused" = "active") =>
    await queues.change(id, { messages: [] }, { messages: [row("a"), row("b")], status }, owner);
  return { queues, world, drainer, enqueue, db };
}
/** Microtasks run: the drainer looks at a queue after the current call stack. */
const settle = async () => {
  await Promise.all(drainers.map(async (drainer) => await drainer.idle()));
};

it("drains immediately when a mobile client returns its own legacy lease on resume", async () => {
  const { queues, world, enqueue } = setup();
  const before = await enqueue("chat", "mobile:one", "paused");
  await settle();
  expect(world.sent).toEqual([]);
  await queues.serve(
    "change",
    "chat",
    "mobile:one",
    { leaseAware: true },
    {
      before,
      after: { ...before, status: "active" },
    },
  );
  await settle();
  expect(world.sent).toEqual(["a"]);
});

it("does not launch durable pending rows before explicit activation, and persists an interrupted hold after close", async () => {
  const db = new StoreDatabase(":memory:");
  databases.push(db);
  const queues = new SessionQueues(db);
  const send = vi.fn();
  const drainer = new QueueDrainer(
    queues,
    {
      ready: () => true,
      send,
      transaction: async (action) => await db.scope(action),
    },
    Date.now,
    false,
  );
  drainers.push(drainer);
  await drainer.ready;
  await queues.change(
    "chat",
    { messages: [] },
    { messages: [row("a"), row("b")], status: "active" },
  );
  await drainer.idle();
  expect(send).not.toHaveBeenCalled();
  await drainer.start();
  await drainer.idle();
  expect(send).toHaveBeenCalledTimes(2);
  await queues.change("chat", { messages: [] }, { messages: [row("c")], status: "active" });
  await drainer.close();
  await drainer.settled("chat", { interrupted: true, reason: "Host stopped" });
  const queue = await queues.get("chat");
  expect(queue.messages.map((message) => message.id)).toEqual(["c"]);
  expect(queue.status).toBe("paused");
  expect(queue.holdReason).toBe("Host stopped");
});

beforeEach(() =>
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  }),
);
afterEach(async () => {
  for (const drainer of drainers.splice(0)) await drainer.close();
  for (const db of databases.splice(0)) await db.close();
  vi.useRealTimers();
});

it("sends the head of an unleased queue the moment it appears, then the next one when the turn settles", async () => {
  const { world, queues, drainer, enqueue } = setup();
  await enqueue();
  await settle();
  expect(world.sent).toEqual(["a"]);
  expect((await queues.get("chat")).messages.map((message) => message.id)).toEqual(["b"]);
  // The turn started by "a" is running: the rest waits, however often it is asked.
  drainer.kick("chat");
  await settle();
  expect(world.sent).toEqual(["a"]);
  world.ready = true;
  drainer.kick("chat"); // the engine's settled event
  await settle();
  expect(world.sent).toEqual(["a", "b"]);
  expect((await queues.get("chat")).messages).toEqual([]);
});

it("leaves a queue with a live lease to its holder and takes over once the lease runs out, with the one timer", async () => {
  const { world, queues, enqueue } = setup();
  await enqueue("chat", "desktop:a");
  await settle();
  expect(world.sent).toEqual([]);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(QUEUE_LEASE_TTL_MS - 1_000);
  expect(world.sent).toEqual([]);
  // The holder keeps it alive on its heartbeat: the timer moves, nothing is sent.
  expect(await queues.renew("chat", "desktop:a", 1)).not.toBeNull();
  await vi.advanceTimersByTimeAsync(QUEUE_LEASE_TTL_MS - 1_000);
  expect(world.sent).toEqual([]);
  await vi.advanceTimersByTimeAsync(2_000);
  await settle();
  expect(world.sent).toEqual(["a"]);
  expect(vi.getTimerCount()).toBe(0);
});

it("does not drain a paused queue, a row being edited or an unconfirmed head", async () => {
  const { world, queues, enqueue } = setup();
  await enqueue("paused", undefined, "paused");
  const editing = await queues.change(
    "editing",
    { messages: [] },
    { messages: [row("a")], status: "paused" },
  );
  await queues.change("editing", editing, { ...editing, status: "active", editingId: "a" });
  const flagged = await queues.change(
    "flagged",
    { messages: [] },
    { messages: [row("a", { deliveryUnknown: true })], status: "paused" },
  );
  await queues.change("flagged", flagged, { ...flagged, status: "active" });
  await settle();
  expect(world.sent).toEqual([]);
});

it("finds waiting queues again after a restart", async () => {
  const { world, db, drainer, queues } = setup();
  await drainer.close();
  await queues.change("chat", { messages: [] }, { messages: [row("a")], status: "active" });
  const restarted = new QueueDrainer(new SessionQueues(db), {
    ready: () => true,
    send: (_id, message) => void world.sent.push(message.id),
    transaction: async (action) => await action(),
  });
  drainers.push(restarted);
  await settle();
  expect(world.sent).toEqual(["a"]);
});

it("holds the queue for its owner when the host refuses the message, and keeps it when a turn raced in", async () => {
  const { world, queues, enqueue } = setup();
  world.refuse = "Draft not found";
  await enqueue();
  await settle();
  expect(world.sent).toEqual([]);
  expect(await queues.get("chat")).toMatchObject({ status: "paused" });
  expect((await queues.get("chat")).messages.map((message) => message.id)).toEqual(["a", "b"]);
  // A refusal because the conversation just started running is not a hold.
  const raced = setup();
  raced.world.refuse = "This session is already running";
  const original = raced.world;
  await raced.drainer.close();
  const drainer = new QueueDrainer(raced.queues, {
    ready: () => original.ready,
    send: () => {
      original.ready = false;
      throw new Error("This session is already running");
    },
    transaction: async (action) => await action(),
  });
  drainers.push(drainer);
  await raced.enqueue();
  await settle();
  expect((await raced.queues.get("chat")).status).toBe("active");
});

it("gives up on the claim of a sender that is gone and never sends that row again by itself", async () => {
  const { world, queues, drainer, enqueue } = setup();
  const owned = await enqueue("chat", "desktop:a");
  await queues.claim("chat", "a", "desktop:a", owned.revision);
  await vi.advanceTimersByTimeAsync(QUEUE_LEASE_TTL_MS + 5);
  drainer.kick("chat");
  await settle();
  expect(world.sent).toEqual([]);
  expect(await queues.get("chat")).toMatchObject({ status: "paused" });
  expect((await queues.get("chat")).messages[0]).toMatchObject({ id: "a", deliveryUnknown: true });
});

it("turns a queued row into the host's own commands", () => {
  const session = { harness: "codex", model: "gpt", runtimeMode: "supervised", modelSettings: {} };
  expect(queueRowCommands("s", row("r", { intent: "plan" }) as never, session)).toEqual([
    {
      type: "send",
      commandId: "queue-drain:s:r",
      sessionId: "s",
      text: "r",
      attachments: [],
      intent: "plan",
    },
  ]);
  expect(queueRowCommands("s", row("c", { text: " /Compact " }) as never, session)).toEqual([
    { type: "compact", commandId: "queue-drain:s:c", sessionId: "s" },
  ]);
  const retargeted = queueRowCommands(
    "s",
    row("r", {
      modelTarget: { harness: "codex", model: "other", modelSettings: { effort: "high" } },
    }) as never,
    session,
  );
  expect(retargeted.map((command) => command.type)).toEqual(["configure", "send"]);
  expect(retargeted[0]).toMatchObject({ model: "other", runtimeMode: "supervised" });
  expect(() => queueRowCommands("s", row("x", { text: "/clear" }) as never, session)).toThrow(
    /desktop/,
  );
  expect(() =>
    queueRowCommands("s", row("x", { intent: "orchestrate" }) as never, session),
  ).toThrow(/desktop/);
});

it("waits while a desktop window runs the conversation and sends when its run lease ends, with the same one timer", async () => {
  const db = new StoreDatabase(":memory:");
  databases.push(db);
  const queues = new SessionQueues(db);
  const runs = new RunLeases();
  const sent: string[] = [];
  const drainer = new QueueDrainer(queues, {
    ready: () => !runs.holder("chat"),
    send: (_id, message) => void sent.push(message.id),
    transaction: async (action) => await action(),
    wakeAt: () => runs.nextExpiry(),
    expired: () => void runs.takeExpired(),
  });
  drainers.push(drainer);
  runs.acquire("chat", "desktop:a");
  await queues.change("chat", { messages: [] }, { messages: [row("a")], status: "active" });
  await settle();
  expect(sent).toEqual([]);
  // The window crashed: nothing renews the lease, and the host looks again once it ends.
  drainer.kick("chat");
  await vi.advanceTimersByTimeAsync(RUN_LEASE_TTL_MS + 1_000);
  await settle();
  expect(sent).toEqual(["a"]);
  expect(vi.getTimerCount()).toBe(0);
});

// H1: a steer or "send now" claim carries no lease; the drainer must not mistake it for a dead sender.
it("leaves a fresh leaseless claim alone and gives up on it only after the grace", async () => {
  const { world, queues, drainer, enqueue } = setup();
  const queue = await enqueue("chat", undefined, "paused");
  const active = await queues.change("chat", queue, { ...queue, status: "active" });
  world.ready = false; // a turn runs on the host; the steer goes to it
  const claimed = await queues.claim("chat", "a", "desktop:a", active.revision, true);
  drainer.kick("chat");
  await settle();
  expect(await queues.get("chat")).toMatchObject({ status: "active", claim: { id: "a" } });
  expect((await queues.get("chat")).messages[0].deliveryUnknown).toBeUndefined();
  // The steer is accepted: the queue goes on, nothing is held.
  const done = await queues.finish("chat", claimed.claim!.token, true);
  expect(done).toMatchObject({ status: "active" });
  expect(done.messages.map((message) => message.id)).toEqual(["b"]);
  // A sender that never answers is given up on, by the one timer, past the grace.
  const stuck = await queues.claim("chat", "b", "desktop:a", done.revision, true);
  expect(stuck.claim).toBeDefined();
  await settle();
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(CLAIM_GRACE_MS + 10);
  await settle();
  expect(await queues.get("chat")).toMatchObject({ status: "paused" });
  expect((await queues.get("chat")).messages[0]).toMatchObject({ id: "b", deliveryUnknown: true });
});

// M4: a stale claim must not block the conversation just because its queue is paused.
it("gives up on a stale claim of a paused queue", async () => {
  const { queues, enqueue } = setup();
  const queue = await enqueue("chat", undefined, "active");
  await queues.claim("chat", "a", "desktop:a", queue.revision, true);
  await queues.hold("chat");
  expect((await queues.get("chat")).claim).toBeDefined();
  await vi.advanceTimersByTimeAsync(CLAIM_GRACE_MS + 10);
  expect((await queues.get("chat")).claim).toBeUndefined();
  expect((await queues.get("chat")).messages[0].deliveryUnknown).toBe(true);
});

// H2: what the turn that just ended says about the queue behind it.
it("goes on after a turn that ended well, but holds the queue after a Stop or a failure", async () => {
  const { world, queues, drainer, enqueue } = setup();
  await enqueue();
  await settle();
  expect(world.sent).toEqual(["a"]);
  world.ready = true;
  await drainer.settled("chat", {});
  await settle();
  expect(world.sent).toEqual(["a", "b"]);

  // The user stopped the turn: the owner decides when the rest goes.
  const stopped = setup();
  await stopped.enqueue();
  await settle();
  stopped.world.ready = true;
  await stopped.drainer.settled("chat", { cancelled: true });
  await settle();
  expect(stopped.world.sent).toEqual(["a"]);
  expect(await stopped.queues.get("chat")).toMatchObject({
    status: "paused",
    holdReason: "stopped",
  });
  stopped.drainer.kick("chat");
  await settle();
  expect(stopped.world.sent).toEqual(["a"]);

  // The provider failed: one failure does not burn the whole queue.
  const failed = setup();
  await failed.queues.change(
    "chat",
    { messages: [] },
    { messages: [row("a"), row("b"), row("c")], status: "active" },
  );
  await settle();
  failed.world.ready = true;
  await failed.drainer.settled("chat", { error: "Provider crashed" });
  await settle();
  await failed.drainer.kickAll();
  await settle();
  expect(failed.world.sent).toEqual(["a"]);
  expect(await failed.queues.get("chat")).toMatchObject({
    status: "paused",
    holdReason: "Provider crashed",
  });
  expect((await failed.queues.get("chat")).messages.map((message) => message.id)).toEqual([
    "b",
    "c",
  ]);

  // A turn cut short (the host stopped or restarted, its storage failed) is not a
  // turn that ended well: the owner decides, so nothing is sent on its own.
  const closing = setup();
  await closing.enqueue();
  await settle();
  closing.world.ready = true;
  await closing.drainer.settled("chat", {
    interrupted: true,
    reason: "Host restarted. This turn was interrupted; inspect its work before continuing.",
  });
  await settle();
  await closing.drainer.kickAll();
  await settle();
  expect(closing.world.sent).toEqual(["a"]);
  expect(await closing.queues.get("chat")).toMatchObject({
    status: "paused",
    holdReason: "Host restarted. This turn was interrupted; inspect its work before continuing.",
  });
});

// H2: a host that is busy for a moment says nothing about the message.
it("keeps a queue that met a host which is stopping, rewinding or switching, and sends when it can", async () => {
  for (const message of [
    "Host is stopping",
    "A conversation change is in progress",
    "Wait for the branch switch to finish",
    "LEASE_HELD: This session is running in bycoda on that computer.",
  ]) {
    const { world, queues, drainer, enqueue } = setup();
    world.refuse = message;
    await enqueue();
    await settle();
    expect(world.sent).toEqual([]);
    expect((await queues.get("chat")).status).toBe("active");
    expect((await queues.get("chat")).messages).toHaveLength(2);
    world.refuse = undefined;
    drainer.kickWaiting();
    await settle();
    expect(world.sent).toEqual(["a"]);
  }
});

it("holds the queue with the reason when the host refuses a message for good", async () => {
  const { world, queues, enqueue } = setup();
  world.refuse = "Draft not found";
  await enqueue();
  await settle();
  expect(await queues.get("chat")).toMatchObject({
    status: "paused",
    holdReason: "Draft not found",
  });
});

// M5: a holder that could send but does not is not kept alive.
it("tells a lease holder that makes no progress apart from one waiting on a busy conversation", async () => {
  const { world, queues, drainer, enqueue } = setup();
  const owned = await enqueue("chat", "desktop:a");
  const epoch = owned.drain!.epoch;
  await settle();
  const keepAlive = async (ms: number) => {
    for (let waited = 0; waited < ms; waited += 5_000) {
      await vi.advanceTimersByTimeAsync(Math.min(5_000, ms - waited));
      await queues.renew("chat", "desktop:a", epoch);
    }
  };
  // Its conversation runs a turn for much longer than the limit: waiting is not a stall,
  // and the end of that turn gives the holder the whole limit again to send.
  world.ready = false;
  await keepAlive(QUEUE_STALL_MS * 2);
  expect(await drainer.holderStalled("chat")).toBe(false);
  world.ready = true;
  expect(await drainer.holderStalled("chat")).toBe(false); // the first free look starts the clock
  await keepAlive(QUEUE_STALL_MS - 5_000);
  expect(await drainer.holderStalled("chat")).toBe(false);
  await keepAlive(5_000);
  expect(await drainer.holderStalled("chat")).toBe(true);
  // The host stops renewing and takes the lease: the row is sent by the host.
  await queues.release("chat", "desktop:a", epoch);
  await settle();
  expect(world.sent).toEqual(["a"]);
});

it("classifies refusals that only mean the conversation is busy", () => {
  for (const text of [
    "This session is already running",
    "Host is stopping",
    "A conversation change is in progress",
    "Wait for the branch switch to finish",
    "Session cleanup is still pending.",
    "Wait for the current turn before changing settings",
    "LEASE_HELD: busy",
  ])
    expect(isTransientDrainError(new Error(text))).toBe(true);
  for (const text of ["Draft not found", "The host cannot send this queued message."])
    expect(isTransientDrainError(new Error(text))).toBe(false);
});

// A holder that cannot send for a reason of its own is neither stalled nor replaced.
it("does not count a holder that reports it cannot send, and does not send on the host's own copy meanwhile", async () => {
  const { world, queues, drainer, enqueue } = setup();
  const owned = await enqueue("chat", "desktop:a");
  const epoch = owned.drain!.epoch;
  await settle();
  world.ready = true;
  drainer.noteBlocked("chat", "desktop:a", true);
  expect(await drainer.holderStalled("chat")).toBe(false);
  for (let waited = 0; waited < QUEUE_STALL_MS * 3; waited += 5_000) {
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await queues.renew("chat", "desktop:a", epoch)).not.toBeNull();
    drainer.noteBlocked("chat", "desktop:a", true); // every beat says so again
    expect(await drainer.holderStalled("chat")).toBe(false);
  }
  expect(world.sent).toEqual([]);
  // Beats stop (the window closed): the lease and the mark run out, and the host takes over.
  await vi.advanceTimersByTimeAsync(QUEUE_LEASE_TTL_MS + 2_000);
  await settle();
  expect(world.sent).toEqual(["a"]);
});

it("ends the block with the beat that no longer reports it, and counts the holder again", async () => {
  const { world, queues, drainer, enqueue } = setup();
  const epoch = (await enqueue("chat", "desktop:a")).drain!.epoch;
  await settle();
  world.ready = true;
  const beats = async (ms: number, blocked: boolean) => {
    for (let waited = 0; waited < ms; waited += 5_000) {
      await vi.advanceTimersByTimeAsync(5_000);
      await queues.renew("chat", "desktop:a", epoch);
      drainer.noteBlocked("chat", "desktop:a", blocked);
    }
  };
  await beats(QUEUE_STALL_MS + 5_000, true);
  expect(await drainer.holderStalled("chat")).toBe(false);
  await beats(5_000, false);
  expect(await drainer.holderStalled("chat")).toBe(false); // the clock starts now
  await beats(QUEUE_STALL_MS, false);
  expect(await drainer.holderStalled("chat")).toBe(true);
});
