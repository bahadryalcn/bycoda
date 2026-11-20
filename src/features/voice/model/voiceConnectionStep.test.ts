import { afterEach, expect, it, vi } from "vitest";
import { voiceConnectionStep } from "./voiceConnectionStep";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("turns a never-resolving step into a named error and a bounded warning", async () => {
  vi.useFakeTimers();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const stalled = voiceConnectionStep(
    "profile",
    "openai",
    new Promise<never>(() => {}),
    1_000,
    "Voice could not start: the assistant did not respond.",
  );
  const outcome = expect(stalled).rejects.toThrow(
    "Voice could not start: the assistant did not respond.",
  );
  await vi.advanceTimersByTimeAsync(1_000);
  await outcome;
  expect(warn).toHaveBeenCalledWith(
    "[voice.connection]",
    "openai",
    expect.objectContaining({
      kind: "step-timeout",
      step: "profile",
      elapsedMs: expect.any(Number),
    }),
  );
});

it("passes results and the original failure through untouched", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await expect(voiceConnectionStep("a", "xai", Promise.resolve(7), 1_000, "x")).resolves.toBe(7);
  const cause = new Error("denied");
  await expect(voiceConnectionStep("a", "xai", Promise.reject(cause), 1_000, "x")).rejects.toBe(
    cause,
  );
  expect(warn).not.toHaveBeenCalled();
});
