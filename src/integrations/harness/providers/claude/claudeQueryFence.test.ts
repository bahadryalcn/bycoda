import { expect, it } from "vitest";
import { ClaudeQueryFence } from "./claudeQueryFence";

it("holds a stopped query until its own terminal result drains", () => {
  const fence = new ClaudeQueryFence();
  const original = fence.begin();
  fence.interrupt(original);
  expect(() => fence.begin()).toThrow("still settling");
  expect(fence.terminal()).toEqual({ generation: original, interrupted: true });
  expect(fence.begin()).not.toBe(original);
});

it("holds uncertain writes and unexpected terminal results for explicit recovery", () => {
  const failed = new ClaudeQueryFence();
  const generation = failed.begin();
  failed.writeFailed(generation);
  failed.terminal();
  expect(() => failed.begin()).toThrow("still settling");
  const duplicate = new ClaudeQueryFence();
  duplicate.begin();
  duplicate.terminal();
  expect(duplicate.terminal()).toBeNull();
  expect(() => duplicate.begin()).toThrow("still settling");
});
