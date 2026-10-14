import { describe, expect, it } from "vitest";
import type { Block } from "./session";
import {
  SHELL_OUTPUT_LIMIT,
  clipShellOutput,
  finishShellBlock,
  parseShellCommand,
  pendingShellRuns,
  shellBlock,
  withShellContext,
} from "./shellRun";
import { isActivityBlock } from "./transcriptActivity";

const user = (id: string, extra: Partial<Block> = {}): Block => ({
  id,
  role: "user",
  text: id,
  ...extra,
});
const ran = (id: string, output: string, exitCode = 0): Block =>
  finishShellBlock(shellBlock(id, id), { output, exitCode, timedOut: false });

describe("parseShellCommand", () => {
  it("reads the command after a leading !", () => {
    expect(parseShellCommand("!git status")).toBe("git status");
    expect(parseShellCommand("  ! npm test  ")).toBe("npm test");
  });

  it("leaves prompts, bare marks and Markdown images alone", () => {
    expect(parseShellCommand("fix this!")).toBeUndefined();
    expect(parseShellCommand("!")).toBeUndefined();
    expect(parseShellCommand("![diagram](a.png) explain")).toBeUndefined();
  });
});

describe("shell blocks", () => {
  it("start running and end with the output and exit code", () => {
    const started = shellBlock("b", "ls");
    expect(started).toMatchObject({
      role: "system",
      shell: { command: "ls", running: true, exitCode: null },
    });
    expect(
      finishShellBlock(started, { output: "a\r\nb", exitCode: 2, timedOut: false }).shell,
    ).toEqual({
      command: "ls",
      output: "a\nb",
      exitCode: 2,
    });
  });

  it("drop terminal color codes", () => {
    expect(ran("b", "\u001b[31mred\u001b[0m").shell?.output).toBe("red");
  });

  it("keep both ends of output past the limit", () => {
    const clipped = clipShellOutput(`START${"x".repeat(SHELL_OUTPUT_LIMIT)}END`);
    expect(clipped.truncated).toBe(true);
    expect(clipped.output.startsWith("START")).toBe(true);
    expect(clipped.output.endsWith("END")).toBe(true);
    expect(clipped.output).toContain("characters omitted");
    expect(clipped.output.length).toBeLessThan(SHELL_OUTPUT_LIMIT + 100);
  });

  it("keep their own transcript row instead of folding into the agent's work", () => {
    expect(isActivityBlock(shellBlock("b", "ls"))).toBe(false);
    expect(isActivityBlock({ id: "s", role: "system", text: "status" })).toBe(true);
  });
});

describe("pendingShellRuns", () => {
  it("lists the runs since the last sent message", () => {
    const blocks = [
      ran("old", "old output"),
      user("first"),
      { id: "a", role: "assistant", text: "answer" } as Block,
      ran("one", "1"),
      ran("two", "2"),
    ];
    expect(pendingShellRuns(blocks).map((run) => run.command)).toEqual(["one", "two"]);
    expect(pendingShellRuns([...blocks, user("next")])).toEqual([]);
  });

  it("looks past an unsent draft", () => {
    const blocks = [user("first"), ran("one", "1"), user("draft", { draft: true })];
    expect(pendingShellRuns(blocks).map((run) => run.command)).toEqual(["one"]);
  });
});

describe("withShellContext", () => {
  it("leaves a prompt with no runs untouched", () => {
    expect(withShellContext([], "Hello")).toBe("Hello");
  });

  it("puts each command, its output and how it ended before the prompt", () => {
    const text = withShellContext(
      [
        ran("npm test", "1 failed\n", 1).shell!,
        ran("git status", "clean").shell!,
        shellBlock("x", "sleep 5").shell!,
      ],
      "Fix it",
    );
    expect(text).toContain("$ npm test\n1 failed\n[exit code 1]");
    expect(text).toContain("$ git status\nclean\n\n$ sleep 5\n[still running]");
    expect(text.endsWith("</user-shell-commands>\n\nFix it")).toBe(true);
  });
});
