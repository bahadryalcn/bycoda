import { afterEach, expect, it, vi } from "vitest";
import {
  HostSubscriptionHub,
  type HostStreamConsumer,
  type HostStreamTarget,
  type HostStreamLoadContext,
  type HostStreamSnapshot,
} from "./subscriptions";
import type { SubscriptionEvent, StreamCursor } from "../../../src/shared/model/host-contracts";

const hubs: HostSubscriptionHub[] = [];
afterEach(() => {
  for (const hub of hubs.splice(0)) hub.close();
});
const target: HostStreamTarget = { kind: "session", sessionId: "session" };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function settle() {
  for (let i = 0; i < 6; i++) await tick();
}
function client(connectionId: string, principalId = "device") {
  const events: SubscriptionEvent[] = [];
  const access = { allowed: true, writable: true };
  const owner: HostStreamConsumer = {
    connectionId,
    principalId,
    authorized: async () => access.allowed,
    send: (event) => {
      events.push(event);
      return access.writable;
    },
  };
  return { owner, events, access };
}
function fixture(options: Partial<ConstructorParameters<typeof HostSubscriptionHub>[0]> = {}) {
  let revision = 1;
  const load = vi.fn(async () => ({ revision, data: { revision } }));
  const hub = new HostSubscriptionHub({ environmentId: "environment", load, ...options });
  hubs.push(hub);
  return {
    hub,
    load,
    advance: () => {
      revision++;
      hub.invalidate();
    },
  };
}
const snapshots = (events: SubscriptionEvent[]) =>
  events.filter((event) => event.params.kind === "snapshot");
const cursor = (event: SubscriptionEvent): StreamCursor => event.params.cursor;
async function expectSnapshots(events: SubscriptionEvent[], count: number) {
  await vi.waitFor(() => expect(snapshots(events)).toHaveLength(count));
}
function subscribe(
  hub: HostSubscriptionHub,
  owner: HostStreamConsumer,
  id = "subscription",
  selected = target,
  resume?: StreamCursor,
) {
  const opened = hub.open(owner, {
    subscriptionId: id,
    target: selected,
    ...(resume ? { cursor: resume } : {}),
  });
  opened.activate();
  return opened;
}

it("does not load or send subscription events before transport activates the open response", async () => {
  const { hub, load } = fixture();
  const { owner, events } = client("one");
  const opened = hub.open(owner, { subscriptionId: "sub", target });
  await settle();
  expect(opened.result).toMatchObject({ subscriptionId: "sub", streamId: expect.any(String) });
  expect(load).not.toHaveBeenCalled();
  expect(events).toEqual([]);
  opened.activate();
  await expectSnapshots(events, 1);
  opened.activate();
  await settle();
  expect(load).toHaveBeenCalledTimes(1);
});

it("shares one principal/target stream across windows while isolating another principal", async () => {
  const { hub, load } = fixture();
  const first = client("one"),
    second = client("two"),
    other = client("three", "other-device");
  const a = subscribe(hub, first.owner),
    b = subscribe(hub, second.owner),
    c = subscribe(hub, other.owner);
  await expectSnapshots(first.events, 1);
  await expectSnapshots(second.events, 1);
  await expectSnapshots(other.events, 1);
  expect(a.result.streamId).toBe(b.result.streamId);
  expect(a.result.streamId).not.toBe(c.result.streamId);
  expect(load).toHaveBeenCalledTimes(2);
  expect(load.mock.calls.map((call) => call[1])).toEqual(
    expect.arrayContaining(["device", "other-device"]),
  );
  expect(hub.acknowledge("unrelated", "subscription", cursor(first.events[0]))).toBe(false);
});

it("requires application acknowledgements and rejects ahead, wrong-epoch and regressing cursors", async () => {
  const { hub, advance } = fixture({ limits: { maxUnacknowledgedEvents: 1 } });
  const slow = client("slow"),
    fast = client("fast");
  subscribe(hub, slow.owner);
  subscribe(hub, fast.owner);
  await expectSnapshots(slow.events, 1);
  await expectSnapshots(fast.events, 1);
  const initial = cursor(fast.events[0]);
  expect(() =>
    hub.acknowledge("fast", "subscription", { ...initial, sequence: initial.sequence + 1 }),
  ).toThrow("sent stream window");
  expect(() => hub.acknowledge("fast", "subscription", { ...initial, epoch: "wrong" })).toThrow(
    "sent stream window",
  );
  expect(hub.acknowledge("fast", "subscription", initial)).toBe(true);
  advance();
  await expectSnapshots(fast.events, 2);
  await vi.waitFor(() => expect(slow.events.at(-1)?.params.kind).toBe("resync-required"));
  expect(snapshots(slow.events)).toHaveLength(1); // Merely receiving data did not acknowledge it.
  const next = cursor(snapshots(fast.events)[1]);
  hub.acknowledge("fast", "subscription", next);
  expect(() => hub.acknowledge("fast", "subscription", initial)).toThrow("sent stream window");
  advance();
  await expectSnapshots(fast.events, 3);
});

it("replays only events after the last applied cursor without reloading the source", async () => {
  const { hub, load, advance } = fixture();
  const original = client("one");
  const opened = subscribe(hub, original.owner);
  await expectSnapshots(original.events, 1);
  const applied = cursor(original.events[0]);
  hub.acknowledge("one", "subscription", applied);
  advance();
  await expectSnapshots(original.events, 2);
  const pending = snapshots(original.events)[1];
  hub.detach("one");
  const resumed = client("two");
  const next = subscribe(hub, resumed.owner, "resumed", target, applied);
  await expectSnapshots(resumed.events, 1);
  expect(next.result.streamId).toBe(opened.result.streamId);
  expect(resumed.events[0].params).toMatchObject({
    cursor: pending.params.cursor,
    data: pending.params.data,
  });
  expect(load).toHaveBeenCalledTimes(2);
});

it("requires resync after a replay gap or expired disconnected stream", async () => {
  let now = 0;
  const { hub, advance } = fixture({
    now: () => now,
    limits: { maxReplayEvents: 1, maxReplayAgeMs: 100 },
  });
  const original = client("one");
  const opened = subscribe(hub, original.owner);
  await expectSnapshots(original.events, 1);
  const old = cursor(original.events[0]);
  hub.acknowledge("one", "subscription", old);
  advance();
  await expectSnapshots(original.events, 2);
  advance();
  await expectSnapshots(original.events, 3);
  hub.detach("one");
  const gap = client("gap");
  subscribe(hub, gap.owner, "gap", target, old);
  await expectSnapshots(gap.events, 1);
  expect(gap.events[0].params.kind).toBe("resync-required");
  const last = cursor(snapshots(gap.events)[0]);
  hub.detach("gap");
  now = 101;
  const expired = client("expired");
  const replacement = subscribe(hub, expired.owner, "expired", target, last);
  await expectSnapshots(expired.events, 1);
  expect(replacement.result.streamId).not.toBe(opened.result.streamId);
  expect(expired.events[0].params.kind).toBe("resync-required");
});

it("evicts retained data at host byte capacity and bounds disconnected stream identities", async () => {
  const { hub, load } = fixture({ limits: { maxHostReplayBytes: 1, maxSubscriptionsPerHost: 2 } });
  const a = client("a");
  subscribe(hub, a.owner);
  await expectSnapshots(a.events, 1);
  const last = cursor(a.events[0]);
  hub.detach("a");
  const b = client("b");
  subscribe(hub, b.owner, "resumed", target, { ...last, sequence: 0 });
  await expectSnapshots(b.events, 1);
  expect(b.events[0].params.kind).toBe("resync-required");
  expect(load).toHaveBeenCalledTimes(2);
  const c = client("c");
  subscribe(hub, c.owner, "other", { kind: "session", sessionId: "other" });
  await expectSnapshots(c.events, 1);
  expect(() =>
    subscribe(hub, client("d").owner, "third", { kind: "session", sessionId: "third" }),
  ).toThrow("capacity");
  hub.detach("b");
  hub.detach("c");
  const d = client("d");
  subscribe(hub, d.owner, "third", { kind: "session", sessionId: "third" });
  await expectSnapshots(d.events, 1); // An unused retained stream is evictable.
});

it("isolates send backpressure from other consumers of the same stream", async () => {
  const { hub, advance } = fixture();
  const slow = client("slow"),
    fast = client("fast");
  slow.access.writable = false;
  subscribe(hub, slow.owner);
  subscribe(hub, fast.owner);
  await expectSnapshots(fast.events, 1);
  expect(snapshots(slow.events)).toHaveLength(1);
  hub.acknowledge("fast", "subscription", cursor(fast.events[0]));
  advance();
  await expectSnapshots(fast.events, 2);
  expect(snapshots(slow.events)).toHaveLength(1);
});

it("committed deletion aborts in-flight hydration and an old result cannot revive data", async () => {
  const loading = deferred<{ revision: number; data: { secret: string } }>();
  let signal!: AbortSignal;
  const load = vi.fn(async (_target, _principal, selected: AbortSignal) => {
    signal = selected;
    return loading.promise;
  });
  const { hub } = fixture({ load });
  const watching = client("one");
  subscribe(hub, watching.owner);
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  hub.forget(target);
  expect(signal.aborted).toBe(true);
  expect(watching.events.at(-1)?.params.kind).toBe("closed");
  loading.resolve({ revision: 1, data: { secret: "deleted" } });
  await settle();
  expect(snapshots(watching.events)).toHaveLength(0);
  const reopened = client("two");
  subscribe(hub, reopened.owner);
  await vi.waitFor(() => expect(reopened.events.at(-1)?.params.kind).toBe("closed"));
  expect(load).toHaveBeenCalledTimes(1);
});

it("collection deletion invalidation retires old replay and in-flight reads without closing the project", async () => {
  const held = deferred<{ revision: number; data: { sessions: string[] } }>();
  let reads = 0;
  const { hub } = fixture({ load: async () => {
    reads++;
    if (reads === 1) return { revision: 1, data: { sessions: ["deleted"] } };
    if (reads === 2) return held.promise;
    return { revision: 2, data: { sessions: [] } };
  } });
  const watcher = client("one");
  const project = { kind: "project", projectId: "p" } as const;
  subscribe(hub, watcher.owner, "first", project);
  await expectSnapshots(watcher.events, 1);
  const previous = cursor(watcher.events[0]);
  const count = watcher.events.length;
  hub.invalidate(project);
  await vi.waitFor(() => expect(reads).toBe(2));
  hub.resnapshot(project);
  expect(watcher.events.at(-1)?.params.kind).toBe("resync-required");
  expect(watcher.events.at(-1)?.params.cursor.epoch).not.toBe(previous.epoch);
  hub.closeSubscription(watcher.owner.connectionId, "first");
  subscribe(hub, watcher.owner, "fresh", project, previous);
  await settle();
  expect(reads).toBe(2); // Non-cooperative old I/O still owns admission.
  held.resolve({ revision: 1, data: { sessions: ["deleted"] } });
  await expectSnapshots(watcher.events, 2);
  expect(watcher.events.at(-1)?.params.data).toEqual({ sessions: [] });
  expect(JSON.stringify(watcher.events.slice(count))).not.toContain("deleted");
  expect(watcher.events.some((event) => event.params.kind === "closed")).toBe(false);
});
it("revocation while loading prevents delivery of the late protected snapshot", async () => {
  const loading = deferred<{ data: { secret: string } }>();
  const load = vi.fn(async () => loading.promise);
  const { hub } = fixture({ load });
  const watching = client("one");
  subscribe(hub, watching.owner);
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  watching.access.allowed = false;
  loading.resolve({ data: { secret: "protected" } });
  await settle();
  expect(watching.events).toEqual([]);
  expect(hub.acknowledge("one", "subscription", { epoch: "old", sequence: 0 })).toBe(false);
});

it("keeps detached backend reads charged until actual completion before admitting another load", async () => {
  const first = deferred<{ data: { revision: number } }>();
  const load = vi.fn(async (selected: HostStreamTarget) =>
    selected.kind === "session" && selected.sessionId === "session"
      ? first.promise
      : { data: { revision: 2 } },
  );
  const { hub } = fixture({ load, maxConcurrentReads: 1 });
  const detached = client("one");
  subscribe(hub, detached.owner);
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  hub.detach("one");
  const next = client("two");
  subscribe(hub, next.owner, "other", { kind: "session", sessionId: "other" });
  await settle();
  expect(load).toHaveBeenCalledTimes(1);
  first.resolve({ data: { revision: 1 } });
  await expectSnapshots(next.events, 1);
  expect(load).toHaveBeenCalledTimes(2);
  expect(detached.events).toEqual([]);
});

it("close aborts reads, prevents late delivery and refuses new subscriptions", async () => {
  const loading = deferred<{ data: { revision: number } }>();
  let signal!: AbortSignal;
  const load = vi.fn(async (_target, _principal, selected: AbortSignal) => {
    signal = selected;
    return loading.promise;
  });
  const { hub } = fixture({ load });
  const watching = client("one");
  subscribe(hub, watching.owner);
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  hub.close();
  hub.close();
  expect(signal.aborted).toBe(true);
  loading.resolve({ data: { revision: 1 } });
  await settle();
  expect(watching.events).toEqual([]);
  expect(hub.closeSubscription("one", "subscription")).toBe(false);
  expect(() => subscribe(hub, client("two").owner)).toThrow("unavailable");
});

it("sends explicit resync instead of unbounded oversize snapshot data", async () => {
  const load = vi.fn(async () => ({ data: { text: "x".repeat(65_536) } }));
  const { hub } = fixture({ load });
  const watching = client("one");
  subscribe(hub, watching.owner);
  await vi.waitFor(() => expect(watching.events.at(-1)?.params.kind).toBe("resync-required"));
  expect(snapshots(watching.events)).toHaveLength(0);
  expect(Buffer.byteLength(JSON.stringify(watching.events[0]))).toBeLessThan(65_536);
});

it("publishes ordered deltas after a baseline and gives a fresh late consumer a full snapshot", async () => {
  let revision = 1;
  const load = vi.fn(
    async (
      _target: HostStreamTarget,
      _principal: string,
      _signal: AbortSignal,
      context: HostStreamLoadContext,
    ): Promise<HostStreamSnapshot> => {
      if (context.forceSnapshot) return { revision, data: { revision, baseline: true } };
      if (context.revision === revision) return { kind: "unchanged", revision };
      return {
        kind: "delta",
        revision,
        baseRevision: context.revision!,
        data: { changed: revision },
      };
    },
  );
  const { hub } = fixture({ load });
  const a = client("first");
  subscribe(hub, a.owner);
  await expectSnapshots(a.events, 1);
  const applied = cursor(a.events[0]);
  hub.acknowledge("first", "subscription", applied);
  revision = 2;
  hub.invalidate(target);
  await vi.waitFor(() => expect(a.events.at(-1)?.params.kind).toBe("delta"));
  expect(a.events.at(-1)?.params.baseRevision).toBe(1);
  hub.invalidate(target);
  await settle();
  expect(a.events).toHaveLength(2);
  const b = client("late");
  subscribe(hub, b.owner);
  await expectSnapshots(b.events, 1);
  expect(b.events[0].params.revision).toBe(2);
  expect(b.events.some((event) => event.params.kind === "delta")).toBe(false);
  const resumed = client("resumed");
  subscribe(hub, resumed.owner, "resume", target, applied);
  await vi.waitFor(() => expect(resumed.events).toHaveLength(2));
  expect(resumed.events.map((event) => event.params.kind)).toEqual(["delta", "snapshot"]);
});

it("does not send an in-flight delta to a consumer that has not received its baseline", async () => {
  const delta = deferred<HostStreamSnapshot>();
  let revision = 1;
  const load = vi.fn(
    async (
      _target: HostStreamTarget,
      _principal: string,
      _signal: AbortSignal,
      context: HostStreamLoadContext,
    ): Promise<HostStreamSnapshot> => {
      if (context.forceSnapshot) return { revision, data: { revision } };
      return await delta.promise;
    },
  );
  const { hub } = fixture({ load });
  const a = client("existing");
  subscribe(hub, a.owner);
  await expectSnapshots(a.events, 1);
  revision = 2;
  hub.invalidate(target);
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  const b = client("joining");
  subscribe(hub, b.owner);
  await settle();
  expect(b.events).toHaveLength(0);
  delta.resolve({ kind: "delta", revision: 2, baseRevision: 1, data: { changed: 2 } });
  await expectSnapshots(b.events, 1);
  expect(b.events.map((event) => event.params.kind)).toEqual(["snapshot"]);
  expect(b.events[0].params.revision).toBe(2);
});

it("makes progress during unrelated commits instead of repeatedly discarding pending reads", async () => {
  const first = deferred<HostStreamSnapshot>();
  let calls = 0;
  const load = vi.fn(async (): Promise<HostStreamSnapshot> =>
    ++calls === 1 ? await first.promise : { revision: 2, data: { revision: 2 } },
  );
  const { hub } = fixture({ load });
  const a = client("progress");
  subscribe(hub, a.owner);
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  for (let index = 0; index < 500; index++) hub.invalidate();
  first.resolve({ revision: 1, data: { revision: 1 } });
  await expectSnapshots(a.events, 2);
  expect(a.events.map((event) => event.params.revision)).toEqual([1, 2]);
  expect(load).toHaveBeenCalledTimes(2);
});
