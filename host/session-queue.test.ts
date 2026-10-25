import { StoreDatabase } from "./store-db";
import { afterEach, expect, it } from "vitest";
import {
  CLAIM_GRACE_MS,
  CLAIM_MAX_MS,
  QUEUE_RENEW_AFTER_MS,
  QueueLeaseError,
  SessionQueues,
} from "./session-queue";
import { QUEUE_LEASE_TTL_MS } from "../src/features/connections/model/sharedQueue";
import type { RemoteQueue } from "../src/features/connections/model/remoteQueue";
const databases: StoreDatabase[] = [];
const message = (id: string, text = id) => ({
  id,
  text,
  attachments: [],
  modelTarget: { harness: "codex" as const, model: "gpt", modelSettings: { effort: "high" } },
});
function setup() {
  const db = new StoreDatabase(":memory:");
  databases.push(db);
  return { db, queues: new SessionQueues(db) };
}
afterEach(async () => {
  for (const db of databases.splice(0)) await db.close();
});
it("gives the home host an active mobile queue without waiting for that client's legacy lease", async () => {
  const { queues } = setup();
  const before = await queues.change(
    "chat",
    { messages: [] },
    {
      messages: [message("a")],
      status: "paused",
    },
    "mobile:one",
  );
  expect(queues.live(before)).toBe(true);
  const resumed = await queues.serve(
    "change",
    "chat",
    "mobile:one",
    { leaseAware: true },
    {
      before,
      after: { ...before, status: "active" },
    },
  );
  expect(resumed.status).toBe("active");
  expect(queues.live(resumed)).toBe(false);
  expect(resumed.messages).toEqual(before.messages);
});
it("does not give back foreign leases, modern leases, or a mobile send already in flight", async () => {
  const { queues } = setup();
  for (const [id, owner, modern] of [
    ["foreign-mobile", "mobile:other", false],
    ["legacy-desktop", "desktop:other", false],
    ["modern-desktop", "desktop:other", true],
    ["modern-mobile", "mobile:one", true],
    ["pending-mobile", "mobile:one", false],
  ] as const) {
    let before = await queues.change(
      id,
      { messages: [] },
      {
        messages: [message("a")],
        status: "paused",
      },
      modern ? undefined : owner,
    );
    if (modern) before = await queues.acquire(id, owner);
    if (id === "pending-mobile")
      before = await queues.claim(id, "a", owner, before.revision, true, { legacy: true });
    const resumed = await queues.serve(
      "change",
      id,
      "mobile:one",
      { leaseAware: true },
      {
        before,
        after: { ...before, status: "active" },
      },
    );
    expect(resumed.drain).toEqual(before.drain);
    expect(resumed.claim).toEqual(before.claim);
    expect(queues.live(resumed)).toBe(true);
  }
});
it("never claims a message with unconfirmed prior delivery", async () => {
  const { queues } = setup();
  const value = await queues.change(
    "chat",
    { messages: [] },
    { messages: [{ ...message("a"), deliveryUnknown: true }], status: "active" },
    "desktop:test",
  );
  await expect(
    (async () => await queues.claim("chat", "a", "desktop:test", value.revision, true))(),
  ).rejects.toThrow(/queue changed/i);
});
it("validates explicit selected-row sends without releasing a paused queue", async () => {
  const { queues } = setup();
  const paused = await queues.change(
    "chat",
    { messages: [] },
    { messages: [message("a"), message("b")], status: "paused" },
    "pc1",
  );
  await expect(
    (async () => await queues.assertSend("chat", "b", "pc1", paused.revision))(),
  ).rejects.toThrow(/queue changed/);
  expect(await queues.assertSend("chat", "b", "pc1", paused.revision, true)).toEqual(paused);
  await queues.consumed("chat", "b");
  expect((await queues.get("chat")).messages.map((row) => row.id)).toEqual(["a"]);
  expect((await queues.get("chat")).status).toBe("paused");
});
it("persists ordered messages and saved settings across queue service restarts", async () => {
  const { db, queues } = setup();
  const first = await queues.change(
    "chat",
    { messages: [] },
    { messages: [message("a"), message("b")], status: "paused" },
    "pc1",
  );
  expect(await new SessionQueues(db).get("chat")).toEqual(first);
  expect((await queues.get("other")).messages).toEqual([]);
});
it("merges simultaneous appends and edits of different rows without losing either", async () => {
  const { queues } = setup();
  const empty = { messages: [] };
  await queues.change("chat", empty, { messages: [message("a")], status: "active" }, "pc1");
  await queues.change("chat", empty, { messages: [message("b")], status: "active" });
  const before = await queues.get("chat");
  await queues.change("chat", before, {
    ...before,
    messages: [message("a", "edit a"), message("b")],
  });
  const next = await queues.change("chat", before, {
    ...before,
    messages: [message("a"), message("b", "edit b")],
  });
  expect(next.messages.map((row) => row.text)).toEqual(["edit a", "edit b"]);
  expect(next.drain).toMatchObject({ holder: "pc1", epoch: 1 });
});
it("rejects competing edits and orders, leaving the first change intact", async () => {
  const { queues } = setup();
  const before = await queues.change(
    "chat",
    { messages: [] },
    { messages: [message("a"), message("b"), message("c")], status: "paused" },
  );
  await queues.change("chat", before, {
    ...before,
    messages: [message("a", "first"), message("b"), message("c")],
  });
  await expect(
    (async () =>
      await queues.change("chat", before, {
        ...before,
        messages: [message("a", "second"), message("b"), message("c")],
      }))(),
  ).rejects.toThrow(/another computer/);
  const order = await queues.get("chat");
  await queues.change("chat", order, {
    ...order,
    messages: [order.messages[1], order.messages[0], order.messages[2]],
  });
  await expect(
    (async () =>
      await queues.change("chat", order, { ...order, messages: [...order.messages].reverse() }))(),
  ).rejects.toThrow(/order changed/);
});
it("keeps an uncertain local send reserved and retries its acknowledgement idempotently", async () => {
  const { queues } = setup();
  const before = await queues.change(
    "chat",
    { messages: [] },
    { messages: [message("a")], status: "active" },
    "desktop:pc1",
  );
  const claimed = await queues.claim("chat", "a", "desktop:pc1", before.revision);
  await expect(
    (async () => await queues.assertSend("chat", "a", "pc2", claimed.revision))(),
  ).rejects.toThrow();
  await expect(
    (async () =>
      await queues.change("chat", claimed, { ...claimed, messages: [message("a", "edit")] }))(),
  ).rejects.toThrow(/being sent/);
  const finished = await queues.finish("chat", claimed.claim!.token, true);
  expect(finished.messages).toEqual([]);
  expect(await queues.finish("chat", claimed.claim!.token, true)).toEqual(finished);
});
it("does not resurrect consumed or removed rows when an enqueue reply was lost", async () => {
  const { queues } = setup();
  const empty = { messages: [] };
  const queued: RemoteQueue = { messages: [message("a")], status: "active" };
  await queues.change("chat", empty, queued, "pc1");
  await queues.consumed("chat", "a");
  expect((await queues.change("chat", empty, queued, "pc1")).messages).toEqual([]);
  expect(
    (await queues.change("chat", queued, { ...queued, messages: [message("a"), message("new")] }))
      .messages,
  ).toEqual([message("new")]);
  const b = await queues.change("chat", empty, { ...queued, messages: [message("b")] });
  await queues.change("chat", b, empty);
  expect(
    (await queues.change("chat", empty, { ...queued, messages: [message("b")] })).messages,
  ).toEqual([]);
});
it("guards saved state, ownership, revision and head before dispatch", async () => {
  const { queues } = setup();
  const queue = await queues.change(
    "chat",
    { messages: [] },
    { messages: [message("a"), message("b")], status: "paused" },
    "pc1",
  );
  await expect(
    (async () => await queues.assertSend("chat", "a", "pc1", queue.revision))(),
  ).rejects.toThrow();
  const active = await queues.change("chat", queue, { ...queue, status: "active" }, "pc2");
  await expect(
    (async () => await queues.assertSend("chat", "a", "pc1", active.revision))(),
  ).rejects.toThrow();
  await expect(
    (async () => await queues.assertSend("chat", "b", "pc2", active.revision))(),
  ).rejects.toThrow();
  await expect(
    (async () => await queues.assertSend("chat", "a", "pc2", queue.revision))(),
  ).rejects.toThrow();
  expect(await queues.assertSend("chat", "a", "pc2", active.revision)).toEqual(active);
});
it("reports which queues another computer changed since a cursor", async () => {
  const { queues } = setup();
  const first = queues.changesSince(undefined);
  const { seq: start, boot } = first;
  // No cursor yet: nothing can be said precisely, but the cursor to resume from is.
  expect(first).toEqual({ seq: start, ids: [], boot, reset: true });
  await queues.change(
    "a",
    { messages: [] },
    { messages: [message("m1")], status: "active" },
    "pc1",
  );
  await queues.change(
    "b",
    { messages: [] },
    { messages: [message("m2")], status: "active" },
    "pc1",
  );
  expect(queues.changesSince(start)).toEqual({ seq: start + 2, ids: ["a", "b"], boot });
  const current = await queues.get("a");
  await queues.change("a", current, { ...current, messages: [...current.messages, message("m3")] });
  expect(queues.changesSince(start + 2)).toEqual({ seq: start + 3, ids: ["a"], boot });
  // Nothing changed: no new sequence number and no ids.
  await queues.change("a", await queues.get("a"), await queues.get("a"));
  expect(queues.changesSince(start + 3)).toEqual({ seq: start + 3, ids: [], boot });
  // A cursor from before this host restarted may be ahead of it.
  expect(queues.changesSince(start + 99)).toMatchObject({ ids: [], reset: true });
});
const clock = { at: 1000000 };
function leased() {
  const db = new StoreDatabase(":memory:");
  databases.push(db);
  const queues = new SessionQueues(db, () => clock.at);
  return { db, queues };
}
const waiting = { messages: [message("a"), message("b")], status: "active" as const };
async function enqueue(queues: SessionQueues, owner?: string) {
  return await queues.change("chat", { messages: [] }, waiting, owner);
}
it("grants one lease per holder, renews it in place and bumps the epoch only on a takeover or after expiry", async () => {
  clock.at = 1000000;
  const { queues } = leased();
  const first = await enqueue(queues, "desktop:a");
  // Owning by asking is how an older client gets a lease: marked as such.
  expect(first.drain).toEqual({
    holder: "desktop:a",
    epoch: 1,
    expiresAt: clock.at + QUEUE_LEASE_TTL_MS,
    legacy: true,
  });
  expect(queues.live(first)).toBe(true);
  // The holder asking again keeps its epoch.
  expect((await queues.acquire("chat", "desktop:a")).drain?.epoch).toBe(1);
  // Another window is refused while the lease is live, unless it takes over.
  await expect((async () => await queues.acquire("chat", "desktop:b"))()).rejects.toThrow(
    QueueLeaseError,
  );
  expect((await queues.acquire("chat", "desktop:b", true)).drain).toMatchObject({
    holder: "desktop:b",
    epoch: 2,
  });
  // After expiry even the same holder starts a new epoch, and any window may take it.
  clock.at += QUEUE_LEASE_TTL_MS + 1;
  expect(queues.live(await queues.get("chat"))).toBe(false);
  expect((await queues.acquire("chat", "desktop:b")).drain).toMatchObject({
    holder: "desktop:b",
    epoch: 3,
  });
  clock.at += QUEUE_LEASE_TTL_MS + 1;
  expect((await queues.acquire("chat", "desktop:c")).drain).toMatchObject({
    holder: "desktop:c",
    epoch: 4,
  });
});
it("gives an empty queue no holder and lets go of the lease when the last row leaves", async () => {
  clock.at = 1000000;
  const { queues } = leased();
  expect((await queues.acquire("chat", "desktop:a")).drain).toBeUndefined();
  const owned = await enqueue(queues, "desktop:a");
  const claimed = await queues.claim("chat", "a", "desktop:a", owned.revision);
  await queues.finish("chat", claimed.claim!.token, true);
  const next = await queues.get("chat");
  const second = await queues.claim("chat", "b", "desktop:a", next.revision);
  const done = await queues.finish("chat", second.claim!.token, true);
  expect(done.messages).toEqual([]);
  expect(queues.live(done)).toBe(false);
  expect(done.drain?.epoch).toBe(1); // the epoch is kept so it only ever grows
  expect(queues.nextLeaseExpiry()).toBeUndefined();
});
it("renews a lease only for its holder and epoch, and writes only once a little of it is used", async () => {
  clock.at = 1000000;
  const { queues } = leased();
  const owned = await enqueue(queues, "desktop:a");
  const stored = (await queues.get("chat")).drain!;
  clock.at += 3000;
  expect(await queues.renew("chat", "desktop:a", 1)).toEqual(stored); // plenty left: nothing written
  clock.at += QUEUE_RENEW_AFTER_MS;
  const renewed = (await queues.renew("chat", "desktop:a", 1))!;
  expect(renewed.expiresAt).toBe(clock.at + QUEUE_LEASE_TTL_MS);
  expect((await queues.get("chat")).drain).toEqual(renewed);
  expect((await queues.get("chat")).revision).toBe(owned.revision); // a renewal never moves the revision
  expect(await queues.renew("chat", "desktop:b", 1)).toBeNull();
  expect(await queues.renew("chat", "desktop:a", 2)).toBeNull();
  clock.at += QUEUE_LEASE_TTL_MS + 1;
  expect(await queues.renew("chat", "desktop:a", 1)).toBeNull();
});
// A hidden, throttled window beats about once a minute: its lease must never lapse.
it("keeps a lease alive for a holder that beats once a minute, whenever its first beat came", async () => {
  for (const first of [0, 20, 31, 40, 45, 50, 59]) {
    clock.at = 1000000;
    const { queues } = leased();
    await enqueue(queues, "desktop:a");
    clock.at += first * 1000;
    expect(await queues.renew("chat", "desktop:a", 1)).not.toBeNull();
    for (let beat = 0; beat < 6; beat++) {
      clock.at += 60000;
      expect(
        await queues.renew("chat", "desktop:a", 1),
        `offset ${first}s, beat ${beat}`,
      ).not.toBeNull();
    }
  }
});
it("tracks the earliest live lease for the one host timer and forgets expired ones", async () => {
  clock.at = 1000000;
  const { queues } = leased();
  await enqueue(queues, "desktop:a");
  clock.at += 5000;
  await queues.change("other", { messages: [] }, waiting, "desktop:a");
  expect(queues.nextLeaseExpiry()).toBe(1000000 + QUEUE_LEASE_TTL_MS);
  expect(await queues.takeExpired()).toEqual([]);
  clock.at = 1000000 + QUEUE_LEASE_TTL_MS;
  expect(await queues.takeExpired()).toEqual(["chat"]);
  expect(queues.nextLeaseExpiry()).toBe(1005000 + QUEUE_LEASE_TTL_MS);
  expect(await queues.takeExpired()).toEqual([]);
});
it("rejects a stale holder: wrong epoch, taken over, or expired", async () => {
  clock.at = 1000000;
  const { queues } = leased();
  const owned = await enqueue(queues, "desktop:a");
  await expect(
    (async () =>
      await queues.claim("chat", "a", "desktop:a", owned.revision, false, { epoch: 7 }))(),
  ).rejects.toThrow(QueueLeaseError);
  const taken = await queues.acquire("chat", "desktop:b", true);
  await expect(
    (async () =>
      await queues.claim("chat", "a", "desktop:a", taken.revision, false, { epoch: 1 }))(),
  ).rejects.toThrow(QueueLeaseError);
  await expect(
    (async () => await queues.assertSend("chat", "a", "desktop:a", taken.revision))(),
  ).rejects.toThrow(QueueLeaseError);
  const claim = await queues.claim("chat", "a", "desktop:b", taken.revision, false, { epoch: 2 });
  expect(claim.claim).toMatchObject({ clientId: "desktop:b", epoch: 2 });
  await expect(
    (async () => await queues.finish("chat", claim.claim!.token, true, 1))(),
  ).rejects.toThrow(QueueLeaseError);
  expect(
    (await queues.finish("chat", claim.claim!.token, true, 2)).messages.map((row) => row.id),
  ).toEqual(["b"]);
  // Without a live lease only an explicit selection (steer) may send; the host drains otherwise.
  clock.at += QUEUE_LEASE_TTL_MS + 1;
  const idle = await queues.get("chat");
  await expect(
    (async () => await queues.assertSend("chat", "b", "desktop:b", idle.revision))(),
  ).rejects.toThrow(QueueLeaseError);
  expect(await queues.assertSend("chat", "b", "remote:mac", idle.revision, true)).toEqual(idle);
});
it("lets an older client send under a lease it never asked for", async () => {
  clock.at = 1000000;
  const { queues } = leased();
  const queue = await queues.change("chat", { messages: [] }, waiting); // an older client enqueued
  expect(queue.drain).toBeUndefined();
  const claimed = await queues.claim("chat", "a", "remote:old", queue.revision, false, {
    legacy: true,
  });
  expect(claimed.drain).toMatchObject({ holder: "remote:old", epoch: 1 });
  expect(claimed.claim?.epoch).toBe(1);
  // An older client sees the live holder as its consumer, a leased one the lease itself.
  expect(queues.view(claimed, false).consumer).toBe("remote:old");
  expect(queues.view(claimed, true)).toMatchObject({ leased: true, hostTime: clock.at });
  expect(queues.view(claimed, true).consumer).toBeUndefined();
  clock.at += QUEUE_LEASE_TTL_MS + 1;
  expect(queues.view(await queues.get("chat"), false).consumer).toBeUndefined();
});
it("turns a send whose sender is gone into an unconfirmed hold that the sender can still settle", async () => {
  clock.at = 1000000;
  const { queues } = leased();
  const owned = await enqueue(queues, "desktop:a");
  const claimed = await queues.claim("chat", "a", "desktop:a", owned.revision);
  // Its sender still holds a live lease: the send is in progress, not abandoned.
  expect((await queues.reapStale("chat")).claim?.token).toBe(claimed.claim!.token);
  clock.at += QUEUE_LEASE_TTL_MS + 1;
  const reaped = await queues.reapStale("chat");
  expect(reaped.claim).toBeUndefined();
  expect(reaped.status).toBe("paused");
  expect(reaped.messages[0]).toMatchObject({ id: "a", deliveryUnknown: true });
  // Never offered to anyone for sending again.
  await expect(
    (async () => await queues.assertSend("chat", "a", "remote:mac", reaped.revision, true))(),
  ).rejects.toThrow(/queue changed/);
  // The sender comes back and reports what happened.
  const accepted = await queues.finish("chat", claimed.claim!.token, true);
  expect(accepted.messages.map((row) => row.id)).toEqual(["b"]);
  expect(await queues.finish("chat", claimed.claim!.token, true)).toEqual(accepted);
});
it("migrates rows owned by a permanent consumer: unleased, and the wait on a dead owner becomes a pause", async () => {
  clock.at = 1000000;
  const { db } = leased();
  const insert = (id: string, queue: object) =>
    db.prepare("INSERT INTO session_queues VALUES (?, ?)").run(id, JSON.stringify(queue));
  insert("dead-owner", {
    messages: [message("a")],
    status: "active",
    consumer: "desktop:dead",
    revision: 4,
  });
  insert("restored", { messages: [message("a")], status: "restored", revision: 1 });
  insert("empty", { messages: [], status: "active", consumer: "desktop:dead", revision: 9 });
  insert("paused", {
    messages: [message("a")],
    status: "paused",
    consumer: "desktop:dead",
    revision: 2,
  });
  insert("plain", { messages: [message("a")], status: "active", revision: 3 });
  const queues = new SessionQueues(db, () => clock.at);
  expect(await queues.get("dead-owner")).toMatchObject({ status: "paused", revision: 5 });
  expect("consumer" in (await queues.get("dead-owner"))).toBe(false);
  expect((await queues.get("dead-owner")).drain).toBeUndefined();
  expect(await queues.get("restored")).toMatchObject({ status: "paused", revision: 2 });
  expect((await queues.get("empty")).status).toBeUndefined();
  expect(await queues.get("paused")).toMatchObject({ status: "paused" });
  expect(await queues.get("plain")).toMatchObject({ status: "active", revision: 3 });
  expect(await queues.pending()).toEqual(["plain"]);
  // A second start changes nothing more.
  expect((await new SessionQueues(db, () => clock.at).get("dead-owner")).revision).toBe(5);
});
it("stores a restored status from an older client as a pause", async () => {
  const { queues } = leased();
  const queue = await queues.change(
    "chat",
    { messages: [] },
    { messages: [message("a")], status: "restored" },
  );
  expect(queue.status).toBe("paused");
});
it("resets a client whose queue cursor came from another host run, however few changes both saw", () => {
  const first = new SessionQueues(new StoreDatabase(":memory:"));
  const second = new SessionQueues(new StoreDatabase(":memory:"));
  const cursor = first.changesSince(undefined).seq;
  expect(second.boot).not.toBe(first.boot);
  expect(second.changesSince(cursor)).toMatchObject({ ids: [], reset: true });
  expect(second.changesSince(second.changesSince(undefined).seq).reset).toBeUndefined();
});
// A send that has no lease behind it (a steer, "send now") is in flight, not abandoned.
it("does not reap a fresh leaseless claim, and reaps it past the grace; a late acceptance restores the queue", async () => {
  clock.at = 1000000;
  const { queues } = leased();
  const queue = await queues.change("chat", { messages: [] }, waiting);
  const claimed = await queues.claim("chat", "a", "desktop:a", queue.revision, true);
  expect(claimed.drain).toBeUndefined();
  expect((await queues.reapStale("chat")).claim?.token).toBe(claimed.claim!.token);
  clock.at += CLAIM_GRACE_MS - 1;
  expect((await queues.reapStale("chat")).claim?.token).toBe(claimed.claim!.token);
  // The one timer is armed for the moment it may be given up on.
  expect(queues.nextLeaseExpiry()).toBe(1000000 + CLAIM_GRACE_MS);
  clock.at += 2;
  expect(await queues.takeExpired()).toEqual(["chat"]);
  const reaped = await queues.reapStale("chat");
  expect(reaped).toMatchObject({ status: "paused" });
  expect(reaped.messages[0]).toMatchObject({ id: "a", deliveryUnknown: true });
  // The sender was only slow: its acceptance puts the queue back as it was.
  const done = await queues.finish("chat", claimed.claim!.token, true);
  expect(done.messages.map((row) => row.id)).toEqual(["b"]);
  expect(done.status).toBe("active");
});
it("does not restore a queue its owner paused after the doubt", async () => {
  clock.at = 1000000;
  const { queues } = leased();
  const queue = await queues.change("chat", { messages: [] }, waiting);
  const claimed = await queues.claim("chat", "a", "desktop:a", queue.revision, true);
  clock.at += CLAIM_GRACE_MS + 1;
  const reaped = await queues.reapStale("chat");
  const active = await queues.change("chat", reaped, { ...reaped, status: "active" });
  await queues.change("chat", active, { ...active, status: "paused" });
  expect((await queues.finish("chat", claimed.claim!.token, true)).status).toBe("paused");
});
it("gives up on a stale claim of a paused queue, and bounds a holder that keeps renewing", async () => {
  clock.at = 1000000;
  const { queues } = leased();
  const queue = await queues.change("chat", { messages: [] }, waiting);
  await queues.claim("chat", "a", "desktop:a", queue.revision, true);
  await queues.hold("chat");
  expect((await queues.get("chat")).claim).toBeDefined();
  clock.at += CLAIM_GRACE_MS + 1;
  expect(await queues.pending()).toEqual(["chat"]);
  expect((await queues.reapStale("chat")).claim).toBeUndefined();
  // A window that holds the lease and renews it for ever is believed up to the maximum.
  const owned = await queues.change(
    "held",
    { messages: [] },
    { messages: [message("x")], status: "active" },
  );
  const lease = await queues.acquire("held", "desktop:a");
  await queues.claim("held", "x", "desktop:a", lease.revision, false, {
    epoch: lease.drain!.epoch,
  });
  expect(owned.messages).toHaveLength(1);
  const step = QUEUE_LEASE_TTL_MS / 4;
  const keepAlive = async (ms: number) => {
    for (let waited = 0; waited < ms; waited += step) {
      clock.at += Math.min(step, ms - waited);
      await queues.renew("held", "desktop:a", lease.drain!.epoch);
    }
  };
  await keepAlive(CLAIM_MAX_MS - 1000);
  expect((await queues.reapStale("held")).claim).toBeDefined();
  await keepAlive(2000);
  expect(await queues.reapStale("held")).toMatchObject({ status: "paused", claim: undefined });
});
it("keeps an in-flight claim across a takeover for the grace", async () => {
  clock.at = 1000000;
  const { queues } = leased();
  await enqueue(queues, undefined);
  const first = await queues.acquire("chat", "desktop:a");
  const claimed = await queues.claim("chat", "a", "desktop:a", first.revision, false, {
    epoch: first.drain!.epoch,
  });
  const taken = await queues.acquire("chat", "desktop:b", true);
  expect(taken.drain).toMatchObject({ holder: "desktop:b", epoch: 2 });
  expect(taken.claim?.token).toBe(claimed.claim!.token);
  expect(taken.status).toBe("active");
  // The old holder still settles with its own epoch.
  const done = await queues.finish("chat", claimed.claim!.token, true, first.drain!.epoch);
  expect(done.messages).toHaveLength(1);
});
it("does not let an older client's ownership request take a live lease from an aware window", async () => {
  clock.at = 1000000;
  const { queues } = leased();
  await enqueue(queues);
  await queues.acquire("chat", "desktop:aware");
  const current = await queues.get("chat");
  const changed = await queues.change(
    "chat",
    current,
    { ...current, messages: [...current.messages, message("c")] },
    "desktop:old",
  );
  expect(changed.drain).toMatchObject({ holder: "desktop:aware", epoch: 1 });
  expect(changed.messages.map((row) => row.id)).toEqual(["a", "b", "c"]);
  // Once it ended, an older client owns the queue by asking, as ever.
  clock.at += QUEUE_LEASE_TTL_MS + 1;
  const legacy = await queues.change(
    "chat",
    changed,
    { ...changed, status: "paused" },
    "desktop:old",
  );
  expect(legacy.drain).toMatchObject({ holder: "desktop:old", legacy: true });
  const next = await queues.change("chat", legacy, { ...legacy, status: "active" }, "desktop:old2");
  expect(next.drain).toMatchObject({ holder: "desktop:old2" });
});
it("tells when the head of a queue could be sent, and lets the host take the lease from a holder", async () => {
  clock.at = 1000000;
  const { queues } = leased();
  const queue = await enqueue(queues);
  const lease = await queues.acquire("chat", "desktop:a");
  expect(await queues.sendable("chat")).toBe(true);
  // Being sent, being edited or in doubt is not "free to send".
  const claimed = await queues.claim("chat", "a", "desktop:a", lease.revision, false, {
    epoch: lease.drain!.epoch,
  });
  expect(await queues.sendable("chat")).toBe(false);
  await queues.finish("chat", claimed.claim!.token, false);
  expect(await queues.sendable("chat")).toBe(true);
  expect(queue.messages).toHaveLength(2);
  expect(await queues.sendable("nothing")).toBe(false);
  expect(await queues.release("chat", "desktop:other", lease.drain!.epoch)).toBeNull();
  expect(queues.live(await queues.get("chat"))).toBe(true);
  expect(await queues.release("chat", "desktop:a", lease.drain!.epoch + 1)).toBeNull();
  expect(queues.live(await queues.get("chat"))).toBe(true);
  expect(await queues.release("chat", "desktop:a", lease.drain!.epoch)).toBeNull();
  expect(queues.live(await queues.get("chat"))).toBe(false);
});
it("keeps the reason of a host hold until its owner resumes the queue", async () => {
  clock.at = 1000000;
  const { queues } = leased();
  await enqueue(queues);
  expect(await queues.hold("chat", "Provider failed")).toMatchObject({
    status: "paused",
    holdReason: "Provider failed",
  });
  const held = await queues.get("chat");
  const resumed = await queues.change("chat", held, { ...held, status: "active" });
  expect(resumed.status).toBe("active");
  expect(
    (
      resumed as {
        holdReason?: string;
      }
    ).holdReason,
  ).toBeUndefined();
});
it("gives a lease back on request of its holder and epoch only, and refuses an older client", async () => {
  clock.at = 1000000;
  const { queues } = leased();
  await enqueue(queues, "desktop:a");
  const call = async (clientId: string, params: Record<string, unknown>) =>
    await queues.serve("release", "chat", clientId, { leaseAware: true, ...params });
  await expect((async () => await call("remote:x", { epoch: 1 }))()).rejects.toThrow(/desktop/);
  expect(queues.live(await call("desktop:b", { epoch: 1 }))).toBe(true); // not its lease: nothing changes
  expect(queues.live(await call("desktop:a", { epoch: 9 }))).toBe(true); // not its epoch
  expect(queues.live(await call("desktop:a", { epoch: 1 }))).toBe(false);
  await expect(
    (async () => await queues.serve("release", "chat", "desktop:a", {}))(),
  ).rejects.toThrow(/desktop/);
});
