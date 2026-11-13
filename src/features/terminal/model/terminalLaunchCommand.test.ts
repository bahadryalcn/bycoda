import { expect, it, vi } from "vitest";
import {
  discardTerminalRun,
  queueTerminalCommand,
  queueTerminalRun,
  takeTerminalCommand,
  takeTerminalRun,
} from "./terminalLaunchCommand";

it("consumes command runs once and preserves ordinary queued project actions", () => {
  const run = {
    command: "echo hi",
    shellKind: "posix" as const,
    onOutput: vi.fn(),
    onExit: vi.fn(),
    onError: vi.fn(),
  };
  queueTerminalRun("run-once", run);
  expect(() => queueTerminalRun("run-once", run)).toThrow("already queued");
  queueTerminalCommand("action", "pnpm dev");
  expect(takeTerminalRun("run-once")).toBe(run);
  expect(takeTerminalRun("run-once")).toBeUndefined();
  expect(takeTerminalCommand("action")).toBe("pnpm dev");
  expect(takeTerminalCommand("action")).toBeUndefined();
});

it("discards a refused terminal launch without notifying completion", () => {
  const run = {
    command: "echo hi",
    shellKind: "posix" as const,
    onOutput: vi.fn(),
    onExit: vi.fn(),
    onError: vi.fn(),
  };
  queueTerminalRun("refused", run);
  discardTerminalRun("refused");
  expect(takeTerminalRun("refused")).toBeUndefined();
  expect(run.onExit).not.toHaveBeenCalled();
});
