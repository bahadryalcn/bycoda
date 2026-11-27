import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createUiLogFile, type UiLogFileLine } from "./uiLogFile";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("writes redacted lines in one batch and skips a repeat inside the window", async () => {
  const batches: UiLogFileLine[][] = [];
  let at = 1_000_000;
  const sink = createUiLogFile(
    async (lines) => {
      batches.push(lines);
    },
    () => at,
  );
  sink("warn", "ui.console", "Desktop live beat failed Authorization: Bearer abcdefgh12345678");
  sink("warn", "ui.console", "Desktop live beat failed Authorization: Bearer abcdefgh12345678");
  sink("error", "ui.error", "boom");
  await vi.advanceTimersByTimeAsync(2000);
  expect(batches).toHaveLength(1);
  expect(batches[0]!.map((line) => line.level)).toEqual(["warn", "error"]);
  expect(batches[0]![0]!.message).toContain("[ui.console] Desktop live beat failed");
  expect(batches[0]![0]!.message).not.toContain("abcdefgh12345678");

  at += 5 * 60_000;
  sink("error", "ui.error", "boom");
  await vi.advanceTimersByTimeAsync(2000);
  expect(batches).toHaveLength(2);
});

it("writes a repeat again when its batch failed to persist", async () => {
  let fail = true;
  const write = vi.fn(async (_lines: UiLogFileLine[]) => {
    if (fail) throw new Error("native unavailable");
  });
  const sink = createUiLogFile(write, () => 1_000_000);
  sink("error", "ui.error", "boom");
  await vi.advanceTimersByTimeAsync(2000);
  fail = false;
  sink("error", "ui.error", "boom");
  await vi.advanceTimersByTimeAsync(2000);
  expect(write).toHaveBeenCalledTimes(2);
  expect(write.mock.calls[1]![0]).toEqual([{ level: "error", message: "[ui.error] boom" }]);
});

it("does not remember a line dropped by the per-minute limit", async () => {
  const write = vi.fn(async (_lines: UiLogFileLine[]) => {});
  let at = 1_000_000;
  const sink = createUiLogFile(write, () => at);
  for (let index = 0; index < 60; index += 1) {
    sink("warn", "ui.console", `line ${index}`);
    if (index % 40 === 39) await vi.advanceTimersByTimeAsync(2000);
  }
  sink("error", "ui.error", "late");
  await vi.advanceTimersByTimeAsync(2000);
  at += 60_000;
  sink("error", "ui.error", "late");
  await vi.advanceTimersByTimeAsync(2000);
  expect(write.mock.calls.at(-1)![0]).toEqual([{ level: "error", message: "[ui.error] late" }]);
});

it("stops at the per-minute limit and survives a failed write", async () => {
  const write = vi.fn(async (_lines: UiLogFileLine[]) => {
    throw new Error("native unavailable");
  });
  let at = 1_000_000;
  const sink = createUiLogFile(write, () => at);
  for (let index = 0; index < 200; index += 1) {
    sink("warn", "ui.console", `line ${index}`);
    if (index % 40 === 39) await vi.advanceTimersByTimeAsync(2000);
  }
  await vi.advanceTimersByTimeAsync(2000);
  expect(write.mock.calls.flatMap(([lines]) => lines)).toHaveLength(60);
  at += 60_000;
  sink("warn", "ui.console", "after the minute");
  await vi.advanceTimersByTimeAsync(2000);
  expect(write.mock.calls.at(-1)![0]).toEqual([
    { level: "warn", message: "[ui.console] after the minute" },
  ]);
});
