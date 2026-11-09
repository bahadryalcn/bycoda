import { describe, expect, it, vi } from "vitest";
import {
  SubscriptionRegistry,
  subscriptionScopeKey,
  type SubscriptionScope,
} from "./subscriptions";

const scope: SubscriptionScope = {
  environmentId: "home-host",
  principalId: "phone-owner",
  accessEpoch: "unlocked-1",
  streamId: "session-a",
  filterKey: "history",
};
const cursor = (sequence: number, epoch = "host-start-1") => ({ epoch, sequence });

describe("scoped subscription application", () => {
  it("interrupts an in-flight application without losing the last committed cursor", async () => {
    const registry = new SubscriptionRegistry();
    registry.setGeneration(1);
    const lease = registry.retain(scope);
    await registry.applySnapshot(lease, 1, cursor(5), () => {});
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let current!: () => boolean;
    const applying = registry.applyDelta(lease, 1, cursor(6), async (input) => {
      current = input.isCurrent;
      await held;
    });
    registry.interrupt(lease);
    expect(current()).toBe(false);
    expect(registry.appliedCursor(lease)).toEqual(cursor(5));
    release();
    expect(await applying).toEqual({ status: "stale" });
    expect(registry.appliedCursor(lease)).toEqual(cursor(5));
    expect(await registry.applyDelta(lease, 1, cursor(6), () => {})).toEqual({
      status: "resync-required",
      reason: "snapshot-required",
    });
    expect(await registry.applySnapshot(lease, 1, cursor(8), () => {})).toEqual({
      status: "applied",
    });
    expect(registry.appliedCursor(lease)).toEqual(cursor(8));
  });
  it("shares logical demand while preserving each consumer's applied cursor", async () => {
    const registry = new SubscriptionRegistry();
    registry.setGeneration(1);
    const first = registry.retain(scope);
    const second = registry.retain(scope);
    expect(registry.demands()).toMatchObject([{ consumers: 2 }]);
    expect(await registry.applySnapshot(first, 1, cursor(5), () => {})).toEqual({
      status: "applied",
    });
    expect(registry.appliedCursor(first)).toEqual(cursor(5));
    expect(registry.appliedCursor(second)).toBeUndefined();
    first.release();
    first.release();
    expect(registry.demands()).toMatchObject([{ consumers: 1 }]);
    second.release();
    expect(registry.demands()).toEqual([]);
  });

  it("isolates principals, authorization epochs and collision-prone scope names", () => {
    const registry = new SubscriptionRegistry();
    registry.retain(scope);
    registry.retain({ ...scope, principalId: "other-user" });
    registry.retain({ ...scope, accessEpoch: "unlocked-2" });
    expect(registry.demands()).toHaveLength(3);
    expect(subscriptionScopeKey({ ...scope, environmentId: "a:b", principalId: "c" })).not.toBe(
      subscriptionScopeKey({ ...scope, environmentId: "a", principalId: "b:c" }),
    );
  });

  it("does not apply duplicates and requires a snapshot after a gap or changed epoch", async () => {
    const registry = new SubscriptionRegistry();
    registry.setGeneration(1);
    const lease = registry.retain(scope);
    const commit = vi.fn();
    await registry.applySnapshot(lease, 1, cursor(10), commit);
    expect(await registry.applyDelta(lease, 1, cursor(11), commit)).toEqual({ status: "applied" });
    expect(await registry.applyDelta(lease, 1, cursor(11), commit)).toEqual({
      status: "duplicate",
    });
    expect(commit).toHaveBeenCalledTimes(2);
    expect(await registry.applyDelta(lease, 1, cursor(13), commit)).toEqual({
      status: "resync-required",
      reason: "cursor-gap",
    });
    expect(registry.appliedCursor(lease)).toEqual(cursor(11));
    expect(await registry.applyDelta(lease, 1, cursor(12), commit)).toEqual({
      status: "resync-required",
      reason: "snapshot-required",
    });
    await registry.applySnapshot(lease, 1, cursor(30), commit);
    expect(await registry.applyDelta(lease, 1, cursor(31, "host-start-2"), commit)).toEqual({
      status: "resync-required",
      reason: "cursor-gap",
    });
  });

  it("keeps the last applied cursor when a state/cache transaction fails", async () => {
    const registry = new SubscriptionRegistry();
    registry.setGeneration(1);
    const lease = registry.retain(scope);
    await registry.applySnapshot(lease, 1, cursor(1), () => {});
    const error = new Error("cache transaction failed");
    expect(
      await registry.applyDelta(lease, 1, cursor(2), () => {
        throw error;
      }),
    ).toEqual({ status: "resync-required", reason: "application-failed", error });
    expect(registry.appliedCursor(lease)).toEqual(cursor(1));
  });

  it("does not acknowledge unfinished application after reconnect", async () => {
    const registry = new SubscriptionRegistry();
    registry.setGeneration(1);
    const lease = registry.retain(scope);
    await registry.applySnapshot(lease, 1, cursor(1), () => {});
    let release!: () => void;
    let current!: () => boolean;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const old = registry.applyDelta(lease, 1, cursor(2), async (context) => {
      current = context.isCurrent;
      await waiting;
    });
    registry.setGeneration(2);
    expect(current()).toBe(false);
    await registry.applySnapshot(lease, 2, cursor(4), () => {});
    release();
    expect(await old).toEqual({ status: "stale" });
    expect(registry.appliedCursor(lease)).toEqual(cursor(4));
    expect(await registry.applyDelta(lease, 1, cursor(5), vi.fn())).toEqual({ status: "stale" });
  });

  it("releases cancelled registration and rejects its late application", async () => {
    const registry = new SubscriptionRegistry();
    registry.setGeneration(1);
    const lease = registry.retain(scope);
    let finish!: () => void;
    let current!: () => boolean;
    const wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const applying = registry.applySnapshot(lease, 1, cursor(1), async (context) => {
      current = context.isCurrent;
      await wait;
    });
    lease.release();
    expect(current()).toBe(false);
    finish();
    expect(await applying).toEqual({ status: "stale" });
    expect(registry.demands()).toEqual([]);
  });

  it("forces resync instead of silently dropping overlapping applications", async () => {
    const registry = new SubscriptionRegistry();
    registry.setGeneration(1);
    const lease = registry.retain(scope);
    let finish!: () => void;
    const wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const first = registry.applySnapshot(lease, 1, cursor(1), () => wait);
    expect(await registry.applyDelta(lease, 1, cursor(2), vi.fn())).toEqual({
      status: "resync-required",
      reason: "overlap",
    });
    finish();
    expect(await first).toEqual({ status: "stale" });
    expect(registry.appliedCursor(lease)).toBeUndefined();
    expect(await registry.applySnapshot(lease, 1, cursor(3), () => {})).toEqual({
      status: "applied",
    });
  });

  it("invalidates retained replay state and stops demand on privacy/deletion", async () => {
    const registry = new SubscriptionRegistry();
    registry.setGeneration(1);
    const lease = registry.retain(scope);
    await registry.applySnapshot(lease, 1, cursor(1), () => {});
    registry.invalidate(scope);
    expect(registry.appliedCursor(lease)).toBeUndefined();
    expect(registry.demands()).toEqual([]);
    expect(await registry.applyDelta(lease, 1, cursor(2), vi.fn())).toEqual({ status: "closed" });
    expect(() => registry.retain(scope)).toThrow(/invalidated/);
    lease.release();
    expect(registry.retain({ ...scope, accessEpoch: "new-grant" })).toBeDefined();
  });

  it("bounds retained consumers and releases capacity without a new connection", () => {
    const registry = new SubscriptionRegistry(1);
    const lease = registry.retain(scope);
    expect(() => registry.retain(scope)).toThrow(/limit/);
    lease.release();
    expect(registry.retain(scope)).toBeDefined();
  });
});
