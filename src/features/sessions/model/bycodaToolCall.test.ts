import { describe, expect, it } from "vitest";
import type { Block } from "./session";
import { bycodaToolCall, bycodaWorkSummary } from "./bycodaToolCall";

function shell(text: string): Block {
  return { id: text, role: "tool", text, tool: { kind: "shell" } };
}

describe("Bycoda CLI tool calls", () => {
  it("recognizes app actions with absolute, quoted, or bare executables", () => {
    expect(
      bycodaToolCall(
        shell("/repo/target/debug/Bycoda.app/Contents/MacOS/bycoda app notes.list --json '{}'"),
      )?.label,
    ).toBe("List notes");
    expect(
      bycodaToolCall(shell("'/Applications/Bycoda App/bycoda' app folders.move --input -"))?.label,
    ).toBe("Move a session");
    expect(
      bycodaToolCall(shell('"C:\\Program Files\\Bycoda\\bycoda.exe" app notes.list'))?.label,
    ).toBe("List notes");
    expect(bycodaToolCall(shell("bycoda app --help"))?.label).toBe("View CLI commands");
    expect(bycodaToolCall(shell("bycoda app sessions.read --json '{}'"))?.label).toBe(
      "Read a session",
    );
    expect(bycodaToolCall(shell("bycoda app sessions.send --json '{}'"))?.label).toBe(
      "Continue a session",
    );
    expect(bycodaToolCall(shell("bycoda app sessions.draft --json '{}'"))?.label).toBe(
      "Save a draft",
    );
    expect(bycodaToolCall(shell("bycoda app notes.write --input -"))?.label).toBe("Write a note");
    expect(
      bycodaToolCall({
        id: "generic",
        role: "tool",
        text: "Run command:",
        tool: { kind: "other", title: "bycoda app sessions.start" },
      })?.label,
    ).toBe("Start a session");
    expect(
      bycodaToolCall({
        id: "codex-action",
        role: "tool",
        text: "List",
        tool: {
          kind: "execute",
          preview: { kind: "shell", title: "bycoda app notes.list" },
        },
      })?.label,
    ).toBe("List notes");
  });

  it("does not restyle unrelated commands or text mentioning the CLI", () => {
    expect(bycodaToolCall(shell("echo bycoda app notes.list"))).toBeUndefined();
    expect(bycodaToolCall(shell("bycoda control list"))).toBeUndefined();
    expect(
      bycodaToolCall({
        id: "prose",
        role: "assistant",
        text: "bycoda app notes.list",
      }),
    ).toBeUndefined();
  });

  it("does not compact compound shell commands or hide a longer shell preview", () => {
    for (const command of [
      "bycoda app notes.list && echo extra",
      "bycoda app notes.list; echo extra",
      "bycoda app notes.list | cat",
      "bycoda app notes.list\necho extra",
      'bycoda app notes.list --json "$(echo extra)"',
    ]) {
      expect(bycodaToolCall(shell(command))).toBeUndefined();
    }
    expect(
      bycodaToolCall({
        id: "short-title",
        role: "tool",
        text: "bycoda app notes.list",
        tool: {
          kind: "shell",
          title: "bycoda app notes.list",
          preview: {
            kind: "shell",
            title: "bycoda app notes.list && echo extra",
          },
        },
      }),
    ).toBeUndefined();
    expect(
      bycodaToolCall(shell('bycoda app sessions.send --json \'{"prompt":"a; b"}\''))?.command,
    ).toBe('bycoda app sessions.send --json \'{"prompt":"a; b"}\'');
  });

  it("names a group only when all its tool calls use Bycoda", () => {
    const calls = [shell("bycoda app --help"), shell("bycoda app notes.list")];
    expect(bycodaWorkSummary(calls, true)).toBe("Using bycoda");
    expect(bycodaWorkSummary(calls, false)).toBe("Used bycoda");
    expect(bycodaWorkSummary([...calls, shell("git status")], true)).toBeUndefined();
  });
});
