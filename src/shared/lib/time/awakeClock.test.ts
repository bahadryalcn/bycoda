import { afterEach, describe, expect, it, vi } from "vitest";
import { AWAKE_SUSPEND_GAP_MS, AWAKE_TICK_MS, AwakeClock } from "./awakeClock";

describe("AwakeClock", () => {
  afterEach(() => vi.useRealTimers());

  it("is the plain wall clock until it is started", () => {
    let wall = 1_000;
    const clock = new AwakeClock(() => wall);
    wall += 3_600_000;
    expect(clock.now()).toBe(3_601_000);
    expect(clock.sleptMs).toBe(0);
  });

  it("counts ordinary silence and tick jitter as awake time", () => {
    vi.useFakeTimers();
    let wall = 1_000;
    const clock = new AwakeClock(() => wall);
    clock.start();
    wall += AWAKE_TICK_MS + AWAKE_SUSPEND_GAP_MS;
    expect(clock.now()).toBe(wall);
    expect(clock.sleptMs).toBe(0);
    clock.stop();
  });

  it("leaves out a span the process was suspended and keeps earlier stamps comparable", () => {
    vi.useFakeTimers();
    let wall = 1_000;
    const clock = new AwakeClock(() => wall);
    clock.start();
    const stamp = clock.now();
    wall += 10 * 60_000;
    // The reader runs before the interval timer after waking and still sees the corrected time.
    const after = clock.now();
    expect(after - stamp).toBe(AWAKE_TICK_MS);
    expect(clock.sleptMs).toBe(10 * 60_000 - AWAKE_TICK_MS);
    // A second reader is not discounted again.
    expect(clock.now()).toBe(after);
    // Silence past the window after the wake-up still counts in full.
    for (let elapsed = 0; elapsed < 25_000; elapsed += AWAKE_TICK_MS) {
      wall += AWAKE_TICK_MS;
      vi.advanceTimersByTime(AWAKE_TICK_MS);
    }
    expect(clock.now() - stamp).toBe(AWAKE_TICK_MS + 25_000);
    expect(clock.toWall(stamp)).toBe(stamp + clock.sleptMs);
    clock.stop();
  });

  it("samples on its own interval and stops sampling when stopped", () => {
    vi.useFakeTimers();
    let wall = 0;
    const clock = new AwakeClock(() => wall);
    clock.start();
    wall = 120_000;
    vi.advanceTimersByTime(AWAKE_TICK_MS);
    expect(clock.sleptMs).toBe(120_000 - AWAKE_TICK_MS);
    clock.stop();
    wall = 600_000;
    vi.advanceTimersByTime(AWAKE_TICK_MS * 4);
    expect(clock.sleptMs).toBe(120_000 - AWAKE_TICK_MS);
  });
});
