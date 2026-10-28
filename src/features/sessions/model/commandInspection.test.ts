import { describe, expect, it } from "vitest";
import type { Block } from "./session";
import {
  commandCopyText,
  commandText,
  emptyOutputReason,
  inspectCommand,
  reconcileToolText,
} from "./commandInspection";

function command(tool: Partial<NonNullable<Block["tool"]>> = {}, patch: Partial<Block> = {}): Block {
  return {
    id: "c1",
    role: "tool",
    text: "Run tests",
    tool: { callId: "call", kind: "execute", status: "in_progress", ...tool },
    ...patch,
  };
}

describe("reconcileToolText", () => {
  it("drops repeats and texts contained in a fuller one", () => {
    expect(reconcileToolText(["a", "a b", " a b ", undefined, ""])).toEqual(["a b"]);
  });
  it("keeps distinct texts in priority order", () => {
    expect(reconcileToolText(["3 passed", "Tests passed"])).toEqual(["3 passed", "Tests passed"]);
  });
  it("lets a fuller canonical text replace a stale preview in its slot", () => {
    expect(reconcileToolText(["tail", "head\ntail"])).toEqual(["head\ntail"]);
  });
});

describe("commandText", () => {
  it("prefers the retained exact command over the display title", () => {
    const block = command({
      preview: {
        kind: "shell",
        title: "Run tests",
        inspection: { kind: "command", text: "pnpm test --run", truncated: true },
      },
    });
    expect(commandText(block)).toEqual({ text: "pnpm test --run", exact: true, truncated: true });
  });
  it("falls back to titles and says it is not exact", () => {
    expect(commandText(command({ preview: { kind: "shell", title: "Run tests" } }))).toEqual({
      text: "Run tests",
      exact: false,
      truncated: false,
    });
  });
});

describe("inspectCommand", () => {
  it("keeps the fuller canonical output over a stale preview", () => {
    const block = command(
      { status: "completed", output: "line 1\nline 2", preview: { kind: "shell", output: "line 2" } },
      {},
    );
    expect(inspectCommand(block, true).output).toBe("line 1\nline 2");
  });
  it("reports the failure once and keeps it out of the output", () => {
    const block = command({ status: "failed", detail: "exit 1", preview: { kind: "shell", output: "exit 1" } });
    const result = inspectCommand(block, false);
    expect(result.error).toBe("exit 1");
    expect(result.output).toBe("");
    expect(result.lifecycle).toBe("failed");
  });
  it("carries the truncation flag and remote summary", () => {
    const block = command(
      { status: "completed", detail: "x", outputTruncated: true },
      { remoteContent: { revision: 4, bytes: 9000 } },
    );
    const result = inspectCommand(block, false);
    expect(result.outputTruncated).toBe(true);
    expect(result.remote).toEqual({ revision: 4, bytes: 9000 });
  });
});

describe("emptyOutputReason", () => {
  it("separates running, finished, interrupted and stopped silence", () => {
    expect(emptyOutputReason(inspectCommand(command(), true))).toBe("running");
    expect(emptyOutputReason(inspectCommand(command(), false))).toBe("interrupted");
    expect(emptyOutputReason(inspectCommand(command({ status: "completed" }), false))).toBe("done");
    expect(emptyOutputReason(inspectCommand(command({ status: "stopped" }), false))).toBe("stopped");
    expect(emptyOutputReason(inspectCommand(command({ detail: "out" }), true))).toBeNull();
  });
  it("does not read the shell text to claim silence", () => {
    const silent = command({}, { text: "gh run watch >/dev/null 2>&1" });
    expect(emptyOutputReason(inspectCommand(silent, true))).toBe("running");
  });
});

describe("commandCopyText", () => {
  it("copies the exact command, status, error and output", () => {
    const block = command({
      status: "failed",
      detail: "boom",
      preview: { kind: "shell", inspection: { kind: "command", text: "make" } },
    });
    expect(commandCopyText(inspectCommand(block, false), "Failed")).toBe("make\n\nFailed\n\nboom");
  });
});
