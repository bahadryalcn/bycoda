import { expect, it } from "vitest";
import { TurnNotReadyError } from "../../core/types";
import { ClaudeQueryFence } from "./claudeQueryFence";

it("holds a stopped query until its own terminal result drains", () => {
  const fence = new ClaudeQueryFence();
  const original = fence.begin();
  fence.interrupt(original);
  expect(() => fence.begin()).toThrow("still settling");
  expect(fence.terminal()).toEqual({ generation: original, interrupted: true });
  expect(fence.begin()).not.toBe(original);
});

it("holds a query whose write failed for explicit recovery, and consumes stray results", () => {
  const failed = new ClaudeQueryFence();
  const generation = failed.begin();
  failed.writeFailed(generation);
  failed.terminal();
  expect(() => failed.begin()).toThrow("still settling");
  // A stray result has no outstanding query to settle: it is consumed and does not latch.
  const stray = new ClaudeQueryFence();
  stray.begin();
  stray.terminal();
  expect(stray.terminal()).toBeNull();
  expect(() => stray.begin()).not.toThrow();
});

it("refuses a fenced send with TurnNotReadyError and admits it again once the provider settles", () => {
  const fence = new ClaudeQueryFence();
  fence.hold();
  expect(() => fence.begin()).toThrow(TurnNotReadyError);
  fence.settle();
  expect(() => fence.begin()).not.toThrow();
});
