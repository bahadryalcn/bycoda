import { afterEach, expect, it, vi } from "vitest";
import { createUiLogFile, type UiLogFileLine } from "./uiLogFile";

afterEach(() => vi.useRealTimers());

it("writes a repeated error after the full pending batch drains", async () => {
  vi.useFakeTimers();
  const write = vi.fn(async (_lines: UiLogFileLine[]) => {});
  const sink = createUiLogFile(write, () => 1_000_000);

  for (let index = 0; index < 50; index += 1) {
    sink("warn", "ui.console", `warning ${index}`);
  }
  sink("error", "ui.error", "batch overflow");
  await vi.advanceTimersByTimeAsync(2000);
  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0]?.[0]).toHaveLength(50);
  expect(write.mock.calls[0]?.[0].every((line) => line.level === "warn")).toBe(true);

  sink("error", "ui.error", "batch overflow");
  await vi.advanceTimersByTimeAsync(2000);
  expect(write).toHaveBeenCalledTimes(2);
  expect(write).toHaveBeenLastCalledWith([
    { level: "error", message: "[ui.error] batch overflow" },
  ]);
});
