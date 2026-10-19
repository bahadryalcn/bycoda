import { expect, it } from "vitest";
import type { Terminal } from "@xterm/xterm";
import {
  localTerminalCompletion,
  localTerminalPrefix,
  safeHistoryCommand,
} from "./localTerminalCompletion";

function terminal(
  line: string,
  options: { cursor?: number; wrapped?: boolean; alternate?: boolean; scrolled?: boolean } = {},
) {
  const cursorX = options.cursor ?? line.length;
  return {
    buffer: {
      active: {
        type: options.alternate ? "alternate" : "normal",
        baseY: 0,
        viewportY: options.scrolled ? 1 : 0,
        cursorY: 0,
        cursorX,
        getLine: () => ({
          isWrapped: options.wrapped,
          translateToString: (trim: boolean, start = 0, end = line.length) => {
            const value = line.slice(start, end);
            return trim ? value.trimEnd() : value;
          },
        }),
      },
    },
  } as unknown as Terminal;
}

it("completes echoed local shell prefixes, including decorated prompts", () => {
  for (const prompt of ["$ ", "PS C:\\repo> ", "user [12:34] ~/repo [main] exit:1 > ", "❯ "]) {
    expect(localTerminalCompletion(terminal(`${prompt}git s`))).toEqual({
      prefix: "git s",
      suggestions: ["git status", "git stash list"],
    });
  }
});

it("ignores password prompts, ordinary output, wrapped lines, alternate screens and cursor edits", () => {
  for (const value of ["Password: git s", "output git s", "$ ", "$ unknown"]) {
    expect(localTerminalCompletion(terminal(value))).toBeNull();
  }
  for (const options of [
    { wrapped: true },
    { alternate: true },
    { scrolled: true },
    { cursor: 5 },
  ]) {
    expect(localTerminalCompletion(terminal("$ git status", options))).toBeNull();
  }
});

it("ranks recent matching commands ahead of templates without adding duplicate or mismatched suffixes", () => {
  const term = terminal("$ git s");
  expect(
    localTerminalCompletion(term, [
      "git show HEAD",
      "git status",
      "git show HEAD",
      "docker ps",
      "git s",
      "git secret-token abc",
    ]),
  ).toEqual({
    prefix: "git s",
    suggestions: ["git show HEAD", "git status", "git stash list"],
  });
  expect(localTerminalPrefix(terminal("$ custom-tool --check"))).toBe("custom-tool --check");
});

it("keeps potentially sensitive and multiline values out of suggestions and session history", () => {
  for (const value of [
    "export KEY=value",
    "tool --token abc",
    "echo a\nb",
    "curl https://a:b@host",
    "cat .env",
    "tool \u001b[31m",
    "tool \u202ebad",
  ]) {
    expect(safeHistoryCommand(value)).toBe(false);
  }
  expect(safeHistoryCommand("custom-tool --check")).toBe(true);
});
