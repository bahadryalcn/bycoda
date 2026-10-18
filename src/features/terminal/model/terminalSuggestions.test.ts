import { describe, expect, it } from "vitest";
import { isSingleLineCommand, terminalSuggestions } from "./terminalSuggestions";

describe("terminal command assistance", () => {
  it("completes command prefixes without changing custom arguments", () => {
    expect(terminalSuggestions("PNPM b")).toEqual(["pnpm build"]);
    expect(terminalSuggestions("git diff")).toEqual(["git diff --staged"]);
    expect(terminalSuggestions("my-custom-tool --flag")).toEqual([]);
    expect(terminalSuggestions("")).toHaveLength(6);
  });
  it("allows shell syntax but rejects multiline and terminal-control injection", () => {
    expect(isSingleLineCommand('git diff -- "a b.txt"')).toBe(true);
    expect(isSingleLineCommand("pnpm test && pnpm build")).toBe(true);
    for (const value of [
      "",
      "  ",
      "ls\r",
      "ls\nwhoami",
      "\x1b[200~foo",
      "a\t",
      "a\u0085",
      "a\u2028b",
    ]) {
      expect(isSingleLineCommand(value)).toBe(false);
    }
  });
});
