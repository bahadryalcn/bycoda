import { expect, it } from "vitest";
import { createNativeBufferHeartbeat, reportIdentity } from "./native-buffer-heartbeat";

const owners = [{ ownerId: "window", updatedAt: 1 }];
const identity = reportIdentity(owners);
const ack = { acknowledged: true };
const stale = { acknowledged: false, reason: "stale" };

function fixture() {
  let clock = 0;
  const refreshed = new Set<string>();
  const stored = new Map<string, { processId: number; receivedAt: number; retiredAt?: number }>();
  const beats = createNativeBufferHeartbeat<string, string>({
    now: () => clock,
    refreshed,
    mutate: (_owner, action) => action(),
    authenticate: async () => "device",
    captureOwner: (capability) => capability,
    current: async (id) => {
      const value = stored.get(id);
      return value ? { value } : null;
    },
    reportKey: ({ clientId, instanceId }) => `${clientId}/${instanceId}`,
    identity: () => {},
  });
  const key = (instance: string) => `client/${instance}`;
  return {
    refreshed,
    stored,
    beats,
    key,
    advance: (ms: number) => {
      clock += ms;
    },
    enroll(instance: string) {
      stored.set(key(instance), { processId: 7, receivedAt: clock });
      beats.remember(key(instance), owners, clock);
    },
    beat: (instance: string) =>
      beats.heartbeat(
        { clientId: "client", instanceId: instance, processId: 7, reportIdentity: identity },
        "owner",
      ),
  };
}

it("keeps a heartbeating client alive while lapsed neighbours are pruned", async () => {
  const f = fixture();
  f.enroll("active");
  f.enroll("gone");
  for (let round = 0; round < 3; round += 1) {
    f.advance(30_000);
    expect(await f.beat("active")).toEqual(ack);
  }
  // "gone" last proved life at t=0, so it lapsed; "active" beat at t=90 s.
  f.enroll("next");
  expect(f.refreshed.has(f.key("active"))).toBe(true);
  expect(f.refreshed.has(f.key("gone"))).toBe(false);
  expect(await f.beat("active")).toEqual(ack);
  expect(await f.beat("gone")).toEqual(stale);
});

it("bounds lease state across many client launches", async () => {
  const f = fixture();
  for (let launch = 0; launch < 50; launch += 1) {
    f.enroll(`launch-${launch}`);
    f.advance(46_000);
  }
  // Every earlier launch lapsed before the next one was remembered.
  expect(f.refreshed.size).toBe(1);
  expect(f.refreshed.has(f.key("launch-49"))).toBe(true);
  expect(await f.beat("launch-0")).toEqual(stale);
});

it("forgets a retired report so its heartbeat state is released", async () => {
  const f = fixture();
  f.enroll("retired");
  expect(await f.beat("retired")).toEqual(ack);
  f.stored.set(f.key("retired"), { ...f.stored.get(f.key("retired"))!, retiredAt: 1 });
  f.beats.retire(f.key("retired"));
  expect(f.refreshed.has(f.key("retired"))).toBe(false);
  expect(await f.beat("retired")).toEqual(stale);
});

it("leaves a lapsed report on the full path and keeps its stored freshness", async () => {
  const f = fixture();
  f.enroll("lapsed");
  f.advance(46_000);
  expect(await f.beat("lapsed")).toEqual(stale);
  // Freshness never moves backwards: a pruned lease reports only the stored proof of life.
  f.enroll("other");
  expect(f.beats.fresh(f.key("lapsed"), 0)).toBe(0);
  expect(await f.beat("lapsed")).toEqual(stale);
});
