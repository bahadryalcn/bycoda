import { readNormalizedJsonWire } from "../normalized-wire";
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
  const { hub } = fixture({
    load: async () => {
      reads++;
      if (reads === 1) return { revision: 1, data: { sessions: ["deleted"] } };
      if (reads === 2) return held.promise;
      return { revision: 2, data: { sessions: [] } };
    },
  });
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

it("coalesces targeted invalidations for at least 250ms without loading another stream", async () => {
  const { hub, load } = fixture();
  const a = client("coalesced"),
    b = client("unrelated");
  subscribe(hub, a.owner);
  subscribe(hub, b.owner, "other", { kind: "session", sessionId: "other" });
  await expectSnapshots(a.events, 1);
  await expectSnapshots(b.events, 1);
  load.mockClear();
  const authorize = vi.spyOn(a.owner, "authorized");
  for (let i = 0; i < 100; i++) hub.invalidate(target);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(load).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  expect(load.mock.calls[0][0]).toEqual(target);
  expect(authorize).toHaveBeenCalledTimes(1);
});

it("limits one connection without blocking another connection's physical read", async () => {
  const pending = deferred<HostStreamSnapshot | null>();
  const load = vi.fn((_target: HostStreamTarget) => pending.promise);
  const { hub } = fixture({ load, maxConcurrentReads: 2, maxConcurrentReadsPerConnection: 1 });
  const noisy = client("noisy");
  const other = client("other");
  for (let index = 0; index < 4; index++)
    subscribe(hub, noisy.owner, `noisy-${index}`, { kind: "session", sessionId: `noisy-${index}` });
  subscribe(hub, other.owner, "other", { kind: "session", sessionId: "other" });
  await settle();
  expect(load).toHaveBeenCalledTimes(2);
  expect(load.mock.calls.map((args) => args[0])).toContainEqual({
    kind: "session",
    sessionId: "other",
  });
  pending.resolve({ data: { settled: true } });
});

it("aborts a detached reader but holds its physical slot until the original work settles", async () => {
  const pending = deferred<HostStreamSnapshot | null>();
  let originalSignal!: AbortSignal;
  const load = vi.fn(
    (
      _target: HostStreamTarget,
      _principal: string,
      signal: AbortSignal,
    ): Promise<HostStreamSnapshot | null> => {
      originalSignal ??= signal;
      return load.mock.calls.length === 1
        ? pending.promise
        : Promise.resolve({ data: { fresh: true } });
    },
  );
  const { hub } = fixture({ load, maxConcurrentReads: 1 });
  const first = client("first");
  const next = client("next");
  subscribe(hub, first.owner, "first", { kind: "session", sessionId: "first" });
  await settle();
  hub.detach("first");
  subscribe(hub, next.owner, "next", { kind: "session", sessionId: "next" });
  await settle();
  expect(originalSignal.aborted).toBe(true);
  expect(load).toHaveBeenCalledTimes(1);
  pending.resolve({ data: { stale: true } });
  await settle();
  expect(load).toHaveBeenCalledTimes(2);
  expect(snapshots(first.events)).toHaveLength(0);
  expect(snapshots(next.events)).toHaveLength(1);
});

it("rotates queued streams before rereading an earlier invalidated stream", async () => {
  const reads = [
    deferred<HostStreamSnapshot | null>(),
    deferred<HostStreamSnapshot | null>(),
    deferred<HostStreamSnapshot | null>(),
  ];
  const selected: HostStreamTarget[] = [];
  const load = vi.fn((target: HostStreamTarget) => {
    selected.push(target);
    return reads[selected.length - 1]?.promise ?? Promise.resolve({ data: {} });
  });
  const { hub } = fixture({ load, maxConcurrentReads: 1 });
  const owner = client("owner");
  const targets: HostStreamTarget[] = ["first", "second", "third"].map((sessionId) => ({
    kind: "session",
    sessionId,
  }));
  targets.forEach((target, index) => subscribe(hub, owner.owner, `sub-${index}`, target));
  await settle();
  hub.invalidate(targets[0]);
  reads[0].resolve({ data: { first: true } });
  await settle();
  reads[1].resolve({ data: { second: true } });
  await settle();
  expect(selected).toEqual(targets);
  reads[2].resolve({ data: { third: true } });
});

it("does not cache a canceled snapshot while its final authorization check is pending", async () => {
  const authorization = deferred<boolean>();
  const first = client("first");
  let checks = 0;
  first.owner.authorized = () => (++checks === 2 ? authorization.promise : Promise.resolve(true));
  const load = vi.fn(async (): Promise<HostStreamSnapshot> => ({
    data: { read: load.mock.calls.length },
  }));
  const { hub } = fixture({ load });
  subscribe(hub, first.owner);
  await settle();
  expect(checks).toBe(2);
  hub.detach("first");
  const next = client("next");
  subscribe(hub, next.owner);
  authorization.resolve(true);
  await vi.waitFor(() => expect(snapshots(next.events)).toHaveLength(1));
  expect(snapshots(next.events)[0].params.data).toEqual({ read: 2 });
  expect(snapshots(first.events)).toHaveLength(0);
});

it("encodes one data snapshot across consumers and keeps legacy consumer mutations isolated", async () => {
  const payload = "雪".repeat(1000);
  const f = fixture({ load: async () => ({ revision: 1, data: { payload } }) });
  const first = client("first");
  const second = client("second");
  first.owner.send = (event) => {
    first.events.push(event);
    if (event.params.data && typeof event.params.data === "object")
      (event.params.data as Record<string, unknown>).payload = "mutated consumer";
    return true;
  };
  const encoded: string[] = [];
  second.owner.sendNormalized = (capture) => {
    const wire = readNormalizedJsonWire(capture);
    expect(JSON.parse(wire.serialized)).toEqual(wire.wire);
    expect(wire.byteLength).toBe(Buffer.byteLength(wire.serialized));
    encoded.push(wire.serialized);
    return true;
  };
  const stringify = vi.spyOn(JSON, "stringify");
  try {
    subscribe(f.hub, first.owner, "first-sub");
    subscribe(f.hub, second.owner, "second-sub");
    await settle();
    expect(encoded).toHaveLength(1);
    expect(JSON.parse(encoded[0]).params.data).toEqual({ payload });
    expect(
      stringify.mock.calls.filter(
        ([value]) =>
          value &&
          typeof value === "object" &&
          (value as Record<string, unknown>).payload === payload,
      ),
    ).toHaveLength(1);
  } finally {
    stringify.mockRestore();
  }
});
