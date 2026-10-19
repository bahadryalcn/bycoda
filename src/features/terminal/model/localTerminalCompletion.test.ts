import { expect, it } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { localTerminalCompletion } from "./localTerminalCompletion";

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
