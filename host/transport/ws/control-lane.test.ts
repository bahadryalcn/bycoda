import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlLane, ControlLaneBusy, ControlLease } from "./control-lane";

afterEach(() => {
  vi.useRealTimers();
});

const live = () => new AbortController();

describe("ControlLane", () => {
  it("holds up to the slots at once and queues the rest in arrival order", async () => {
    const lane = new ControlLane(2, 3);
    const leases = Array.from({ length: 5 }, () => lane.reserve()!);
    expect(leases.every(Boolean)).toBe(true);
    expect(lane.outstanding).toBe(5);
    const signal = live().signal;
    const granted: number[] = [];
    const waits = leases.map((lease, index) =>
      lease.held(signal, 1_000).then(() => granted.push(index)),
    );
    await waits[0];
    await waits[1];
    expect(granted).toEqual([0, 1]);
    leases[0].release();
    await waits[2];
    leases[1].release();
    await waits[3];
    leases[2].release();
    await waits[4];
    expect(granted).toEqual([0, 1, 2, 3, 4]);
  });

  it("refuses only when the slots and the queue are both full, before anything runs", () => {
    const lane = new ControlLane(1, 1);
    const first = lane.reserve()!;
    expect(lane.reserve()).toBeDefined();
    expect(lane.reserve()).toBeUndefined();
    first.release();
    // A released place is reusable; the queued lease moved up into the slot.
    expect(lane.reserve()).toBeDefined();
    expect(lane.reserve()).toBeUndefined();
  });

  it("fails a queued wait after its admission time and frees the place for later arrivals", async () => {
    vi.useFakeTimers();
    const lane = new ControlLane(1, 2);
    const running = lane.reserve()!;
    const expired = lane.reserve()!;
    const behind = lane.reserve()!;
    const signal = live().signal;
    const failed = expired.held(signal, 500).catch((error: unknown) => error);
    const waiting = behind.held(signal, 5_000);
    await vi.advanceTimersByTimeAsync(500);
    expect(await failed).toBeInstanceOf(ControlLaneBusy);
    expect(lane.outstanding).toBe(2);
    running.release();
    await waiting;
    behind.release();
    expect(lane.outstanding).toBe(0);
  });

  it("gives a queued place back when the request is cancelled or expires first", async () => {
    const lane = new ControlLane(1, 1);
    const running = lane.reserve()!;
    const queued = lane.reserve()!;
    const controller = live();
    const wait = queued.held(controller.signal, 1_000).catch((error: unknown) => error);
    const reason = new Error("request deadline");
    controller.abort(reason);
    expect(await wait).toBe(reason);
    expect(lane.outstanding).toBe(1);
    expect(lane.reserve()).toBeDefined();
    running.release();
  });

  it("rejects at once for an already aborted request without taking a slot", async () => {
    const lane = new ControlLane(1, 1);
    const controller = live();
    const reason = new Error("closed");
    controller.abort(reason);
    const lease = lane.reserve()!;
    await expect(lease.held(controller.signal, 1_000)).rejects.toBe(reason);
    lease.release();
    expect(lane.outstanding).toBe(0);
  });

  it("releases exactly once", () => {
    const lane = new ControlLane(1, 1);
    const first = lane.reserve()!;
    const second = lane.reserve()!;
    first.release();
    first.release();
    expect(lane.outstanding).toBe(1);
    second.release();
    expect(lane.outstanding).toBe(0);
    expect(lane.reserve()).toBeDefined();
    expect(lane.reserve()).toBeDefined();
    expect(lane.reserve()).toBeUndefined();
  });

  it("lets effects run only after every earlier arrival has finished", async () => {
    const lane = new ControlLane(3, 0);
    const [open, ack, close] = [lane.reserve()!, lane.reserve()!, lane.reserve()!];
    const signal = live().signal;
    const effects: string[] = [];
    // The later requests finish their checks first; their effects still wait their turn.
    const closeRan = close.ordered(signal).then(() => effects.push("close"));
    const ackRan = ack.ordered(signal).then(() => {
      effects.push("ack");
      ack.release();
    });
    await Promise.resolve();
    expect(effects).toEqual([]);
    await open.ordered(signal);
    effects.push("open");
    open.release();
    await ackRan;
    close.release();
    await closeRan;
    expect(effects).toEqual(["open", "ack", "close"]);
  });

  it("does not hold later effects behind an earlier request that was abandoned", async () => {
    const lane = new ControlLane(2, 0);
    const first = lane.reserve()!;
    const second = lane.reserve()!;
    const turn = second.ordered(live().signal);
    first.release();
    await turn;
    second.release();
    expect(lane.outstanding).toBe(0);
  });

  it("abandons a wait for an earlier effect when the request is cancelled", async () => {
    const lane = new ControlLane(2, 0);
    lane.reserve();
    const second = lane.reserve()!;
    const controller = live();
    const wait = second.ordered(controller.signal).catch((error: unknown) => error);
    const reason = new Error("expired");
    controller.abort(reason);
    expect(await wait).toBe(reason);
  });

  it("rejects invalid limits", () => {
    expect(() => new ControlLane(0, 1)).toThrow();
    expect(() => new ControlLane(1, -1)).toThrow();
  });

  it("rejects an ordered wait when its predecessor fails and detaches the abort listener", async () => {
    const reason = new Error("previous turn failed");
    const lease = new ControlLease(new ControlLane(1, 0), Promise.reject(reason));
    const { signal } = live();
    const removeListener = vi.spyOn(signal, "removeEventListener");
    await expect(lease.ordered(signal)).rejects.toBe(reason);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
