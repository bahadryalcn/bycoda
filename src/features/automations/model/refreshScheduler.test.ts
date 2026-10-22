import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRefreshScheduler } from "./refreshScheduler";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("refresh scheduler", () => {
  it("plans the next refresh after the previous one finishes, never overlapping", async () => {
    let active = 0;
    let peak = 0;
    const gates: Array<ReturnType<typeof deferred>> = [];
    const run = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      const gate = deferred();
      gates.push(gate);
      await gate.promise;
      active--;
    });
    const scheduler = createRefreshScheduler({
      run,
      intervalMs: 15_000,
      hiddenIntervalMs: 60_000,
      isHidden: () => false,
    });
    scheduler.start();
    // A slow reply: several intervals pass while the first refresh is out.
    await vi.advanceTimersByTimeAsync(45_000);
    expect(run).toHaveBeenCalledTimes(1);
    gates[0].resolve();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(peak).toBe(1);
    scheduler.stop();
  });

  it("drops the result of a refresh superseded by a manual one and runs it once more", async () => {
    const published: string[] = [];
    const gates: Array<ReturnType<typeof deferred>> = [];
    let n = 0;
    const scheduler = createRefreshScheduler({
      run: async (isCurrent) => {
        const mine = `run-${++n}`;
        const gate = deferred();
        gates.push(gate);
        await gate.promise;
        if (isCurrent()) published.push(mine);
      },
      intervalMs: 15_000,
      hiddenIntervalMs: 60_000,
      isHidden: () => false,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    const manual = scheduler.refresh();
    const again = scheduler.refresh();
    expect(again).toBe(manual);
    gates[0].resolve();
    await vi.advanceTimersByTimeAsync(0);
    gates[1].resolve();
    await manual;
    // Only one trailing run, and the first, older reply never published.
    expect(n).toBe(2);
    expect(published).toEqual(["run-2"]);
    scheduler.stop();
  });

  it("never publishes after stop", async () => {
    const gate = deferred();
    const published = vi.fn();
    const scheduler = createRefreshScheduler({
      run: async (isCurrent) => {
        await gate.promise;
        if (isCurrent()) published();
      },
      intervalMs: 15_000,
      hiddenIntervalMs: 60_000,
      isHidden: () => false,
    });
    scheduler.start();
    scheduler.stop();
    gate.resolve();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(published).not.toHaveBeenCalled();
  });

  it("slows down while hidden and refreshes at once when shown again", async () => {
    let hidden = true;
    const run = vi.fn(async () => {});
    const scheduler = createRefreshScheduler({
      run,
      intervalMs: 15_000,
      hiddenIntervalMs: 60_000,
      isHidden: () => hidden,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(2);
    hidden = false;
    scheduler.visibilityChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(4);
    scheduler.stop();
  });
});
