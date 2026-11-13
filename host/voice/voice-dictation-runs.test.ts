import { expect, it, vi } from "vitest";
import { DictationCleanupRuns } from "./voice-dictation-runs";
const id = "12c8ebd4-5098-471e-bf5a-8121b1ada525";
it("aborts only the matching owner run and tombstones cancellation before start", async () => {
  const runs = new DictationCleanupRuns();
  let signal!: AbortSignal;
  const run = vi.fn((_input: unknown, value: AbortSignal) => {
    signal = value;
    return new Promise<{ text: string }>((_, reject) =>
      value.addEventListener("abort", () => reject(new Error("cancelled"))),
    );
  });
  const pending = runs.process("owner-a", id, {}, run);
  await vi.waitFor(() => expect(signal).toBeDefined());
  runs.cancel("owner-b", id);
  expect(signal.aborted).toBe(false);
  runs.cancel("owner-a", id);
  expect(signal.aborted).toBe(true);
  await expect(pending).rejects.toThrow("cancelled");
  await expect(runs.process("owner-a", id, {}, run)).rejects.toThrow("cancelled");
  expect(run).toHaveBeenCalledTimes(1);
});
it("rejects malformed owner run IDs", () => {
  expect(() => new DictationCleanupRuns().cancel("owner", "invalid")).toThrow();
});
it("blocks a process request that arrives after its cancellation and expires tombstones", async () => {
  vi.useFakeTimers();
  try {
    const runs = new DictationCleanupRuns();
    const run = vi.fn(async () => ({ text: "ok" }));
    runs.cancel("owner", id);
    await expect(runs.process("owner", id, {}, run)).rejects.toThrow("cancelled");
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5 * 60_000 + 1);
    await expect(runs.process("owner", id, {}, run)).resolves.toEqual({ text: "ok" });
  } finally {
    vi.useRealTimers();
  }
});
