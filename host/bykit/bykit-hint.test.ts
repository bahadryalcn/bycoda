import { beforeEach, expect, it, vi } from "vitest";
import { BYKIT_HINT, bykitAvailable, bykitHint, resetBykitCache } from "./bykit-hint";

beforeEach(() => {
  resetBykitCache();
  vi.useRealTimers();
});

it("adds the instruction block only when bykit resolves", async () => {
  expect(await bykitHint(async () => "/usr/bin/bykit")).toBe(BYKIT_HINT);
  expect(BYKIT_HINT).toContain("bykit edit");
  resetBykitCache();
  expect(await bykitHint(async () => undefined)).toBe("");
});

it("treats a lookup error as absent", async () => {
  expect(await bykitAvailable(() => Promise.reject(new Error("denied")))).toBe(false);
});

it("treats a hung lookup as absent after the deadline", async () => {
  vi.useFakeTimers();
  const pending = bykitAvailable(() => new Promise(() => {}));
  await vi.advanceTimersByTimeAsync(2_000);
  expect(await pending).toBe(false);
});

it("reuses the answer for a minute, then looks again", async () => {
  const lookup = vi.fn(async () => "bykit");
  let now = 1_000;
  await bykitAvailable(lookup, () => now);
  now += 30_000;
  await bykitAvailable(lookup, () => now);
  expect(lookup).toHaveBeenCalledTimes(1);
  now += 40_000;
  await bykitAvailable(lookup, () => now);
  expect(lookup).toHaveBeenCalledTimes(2);
});
