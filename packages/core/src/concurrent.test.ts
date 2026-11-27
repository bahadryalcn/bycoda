import { describe, expect, it } from "vitest";
import { forEachConcurrent } from "./concurrent";

describe("forEachConcurrent", () => {
  it("bounds in-flight work and visits every item", async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];

    await forEachConcurrent([0, 1, 2, 3, 4, 5], 2, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      seen.push(item);
      active -= 1;
    });

    expect(peak).toBe(2);
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("stops assigning new work after cancellation", async () => {
    let running = true;
    const seen: number[] = [];

    await forEachConcurrent(
      [0, 1, 2, 3],
      1,
      async (item) => {
        seen.push(item);
        running = false;
      },
      () => running,
    );

    expect(seen).toEqual([0]);
  });

  it("stops assigning work after a failure and rejects once in-flight work settles", async () => {
    const started: number[] = [];
    const settled: number[] = [];
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const error = await forEachConcurrent([0, 1, 2, 3, 4], 2, async (item) => {
      started.push(item);
      if (item === 0) throw new Error("boom");
      await delay(20);
      settled.push(item);
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("boom");
    // Sibling 1 was in flight when 0 failed: it finished before rejection; 2..4 never started.
    expect(settled).toEqual([1]);
    expect(started).toEqual([0, 1]);
  });

  it("rethrows the first failure even when a sibling also fails", async () => {
    const error = await forEachConcurrent([0, 1], 2, async (item) => {
      throw new Error(`fail ${item}`);
    }).catch((reason: unknown) => reason);

    expect((error as Error).message).toBe("fail 0");
  });

  it("surfaces a throwing shouldContinue after in-flight work settles", async () => {
    const settled: number[] = [];
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let calls = 0;

    const error = await forEachConcurrent(
      [0, 1, 2],
      2,
      async (item) => {
        await delay(10);
        settled.push(item);
      },
      () => {
        calls += 1;
        if (calls === 3) throw new Error("guard");
        return true;
      },
    ).catch((reason: unknown) => reason);

    expect((error as Error).message).toBe("guard");
    expect(settled.sort((a, b) => a - b)).toEqual([0, 1]);
  });
});
