import { describe, expect, it } from "vitest";
import { RunLeases } from "./run-lease";
import {
  isLeaseHeld,
  leaseHeldText,
  LeaseHeldError,
  LeaseLostError,
  RUN_LEASE_TTL_MS,
} from "../src/features/sync/model/runLease";

const clock = () => {
  const time = { now: 1_000_000 };
  return { time, leases: new RunLeases(() => time.now) };
};

describe("RunLeases", () => {
  it("grants one holder at a time and refuses the other with LEASE_HELD", () => {
    const { leases } = clock();
    const mine = leases.acquire("chat", "desktop:a");
    expect(leases.holder("chat")).toEqual(mine);
    expect(() => leases.acquire("chat", "desktop:b")).toThrow(LeaseHeldError);
    expect(() => leases.acquire("chat", "desktop:b")).toThrow(/LEASE_HELD/);
    // Asking again as the holder is a renewal: same epoch.
    expect(leases.acquire("chat", "desktop:a").epoch).toBe(mine.epoch);
    // Another conversation is independent.
    expect(leases.acquire("other", "desktop:b").holder).toBe("desktop:b");
  });

  it("is refused while the host or an older app runs the conversation", () => {
    const { leases } = clock();
    expect(() => leases.acquire("chat", "desktop:a", () => "host")).toThrow(/LEASE_HELD/);
    expect(leases.holder("chat")).toBeUndefined();
  });

  it("lives on the holder's heartbeat and ends without it", () => {
    const { leases, time } = clock();
    leases.acquire("chat", "desktop:a");
    time.now += RUN_LEASE_TTL_MS - 1_000;
    expect(leases.renew("chat", "desktop:a")).toBeDefined();
    time.now += RUN_LEASE_TTL_MS - 1_000;
    expect(leases.holder("chat")?.holder).toBe("desktop:a");
    // Only the holder's beat extends it.
    expect(leases.renew("chat", "desktop:b")).toBeUndefined();
    time.now += RUN_LEASE_TTL_MS;
    expect(leases.holder("chat")).toBeUndefined();
    // The next window may take it; its epoch is newer.
    const next = leases.acquire("chat", "desktop:b");
    expect(next.holder).toBe("desktop:b");
  });

  it("fences a holder that returns after the lease moved on", () => {
    const { leases, time } = clock();
    const first = leases.acquire("chat", "desktop:a");
    time.now += RUN_LEASE_TTL_MS + 1;
    const second = leases.acquire("chat", "desktop:b");
    expect(second.epoch).toBeGreaterThan(first.epoch);
    expect(() => leases.release("chat", "desktop:a", first.epoch)).toThrow(LeaseLostError);
    expect(leases.holder("chat")?.holder).toBe("desktop:b");
    expect(leases.release("chat", "desktop:b", second.epoch)).toBe(true);
    expect(leases.holder("chat")).toBeUndefined();
    // Nothing held: a late release is a no-op, not an error.
    expect(leases.release("chat", "desktop:a")).toBe(false);
  });

  it("keeps epochs growing across a restart of the host", () => {
    const time = { now: 5_000_000 };
    const before = new RunLeases(() => time.now).acquire("chat", "desktop:a");
    time.now += 60_000;
    const after = new RunLeases(() => time.now).acquire("chat", "desktop:a");
    expect(after.epoch).toBeGreaterThan(before.epoch);
  });

  it("names the earliest expiry and forgets the ended ones", () => {
    const { leases, time } = clock();
    expect(leases.nextExpiry()).toBeUndefined();
    leases.acquire("a", "desktop:x");
    time.now += 5_000;
    leases.acquire("b", "desktop:x");
    expect(leases.nextExpiry()).toBe(1_000_000 + RUN_LEASE_TTL_MS);
    time.now = 1_000_000 + RUN_LEASE_TTL_MS;
    expect(leases.takeExpired()).toEqual(["a"]);
    expect(leases.holder("b")?.holder).toBe("desktop:x");
  });

  it("drops a lease only for the window that held it", () => {
    const { leases } = clock();
    leases.acquire("chat", "desktop:a");
    expect(leases.drop("chat", "desktop:b")).toBe(false);
    expect(leases.drop("chat", "desktop:a")).toBe(true);
    expect(leases.holder("chat")).toBeUndefined();
  });
});

describe("LEASE_HELD on the wire", () => {
  it("is recognised after the host's text crossed the bridge", () => {
    const error = new LeaseHeldError("desktop:a");
    expect(isLeaseHeld(error)).toBe(true);
    expect(isLeaseHeld(`Host rejected request: ${error.message}`)).toBe(true);
    expect(isLeaseHeld("Error: Host rejected request: LEASE_HELD: busy")).toBe(true);
    expect(isLeaseHeld("Host rejected request: Queued message content changed.")).toBe(false);
    expect(isLeaseHeld("NOT_LEASE_HELD")).toBe(false);
    expect(isLeaseHeld(undefined)).toBe(false);
    expect(leaseHeldText(`Host rejected request: ${error.message}`)).toMatch(/^This session is/);
  });
});

describe("RunLeases fencing and bounds", () => {
  it("renews only the epoch the holder names", () => {
    const { leases } = clock();
    const mine = leases.acquire("chat", "desktop:a");
    expect(leases.renew("chat", "desktop:a", mine.epoch + 1)).toBeUndefined();
    expect(leases.renew("chat", "desktop:a", mine.epoch)?.epoch).toBe(mine.epoch);
    expect(leases.renew("chat", "desktop:a")?.epoch).toBe(mine.epoch);
  });

  it("outlives the longest gap between a throttled hidden window's beats", () => {
    const { leases, time } = clock();
    leases.acquire("chat", "desktop:a");
    time.now += 60_000;
    expect(leases.holder("chat")?.holder).toBe("desktop:a");
    expect(() => leases.acquire("chat", "desktop:b")).toThrow(/LEASE_HELD/);
  });

  it("holds a bounded number of conversations and forgets the ended ones first", () => {
    const { leases, time } = clock();
    for (let i = 0; i < RunLeases.MAX; i++) leases.acquire(`s${i}`, "desktop:a");
    expect(() => leases.acquire("one-more", "desktop:a")).toThrow(/Too many/);
    time.now += RUN_LEASE_TTL_MS + 1;
    expect(leases.acquire("one-more", "desktop:a").holder).toBe("desktop:a");
  });
});

describe("RunLeases ending a turn", () => {
  it("drops the lease a turn ended with, but not one granted for a newer turn after its last busy beat", () => {
    const { leases, time } = clock();
    leases.acquire("chat", "desktop:a");
    const lastBusy = time.now;
    // The next turn took its lease (the window released and acquired again) before the idle beat arrived.
    time.now += 500;
    leases.release("chat", "desktop:a");
    const fresh = leases.acquire("chat", "desktop:a");
    time.now += 500;
    expect(leases.drop("chat", "desktop:a", lastBusy)).toBe(false);
    expect(leases.holder("chat")).toEqual(fresh);
    // A lease the busy beat itself saw is dropped when the turn ends.
    expect(leases.drop("chat", "desktop:a", time.now)).toBe(true);
    expect(leases.holder("chat")).toBeUndefined();
    // Without a time, the holder's lease goes whatever it was granted for.
    leases.acquire("other", "desktop:a");
    expect(leases.drop("other", "desktop:a")).toBe(true);
  });
});
