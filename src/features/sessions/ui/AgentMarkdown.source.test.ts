import { expect, it, vi } from "vitest";
import { MarkdownSource } from "./markdownSource";

it("matches full joins across tail edits, sealed blocks, rewrites and empty parses", () => {
  const source = new MarkdownSource();
  for (const blocks of [
    ["first\n\n", "tail"],
    ["first\n\n", "tail grows"],
    ["first\n\n", "tail grows\n\n", "next"],
    ["first\n\n", "tail grows\n\n", "next", "more"],
    ["first\n\n", "tail grows\n\n", "next", "more"],
    ["rewritten", "tail"],
    ["rewritten"],
    [],
    ["restart"],
  ]) {
    expect(source.read(blocks)).toBe(blocks.join(""));
    expect(source.read(blocks)).toBe(blocks.join(""));
  }
});

it("does not rejoin sealed text on a small tail update", () => {
  const source = new MarkdownSource();
  const prefix = "settled ".repeat(10000);
  source.read([prefix, "tail"]);
  const join = vi.spyOn(Array.prototype, "join");
  try {
    expect(source.read([prefix, "tail delta"])).toBe(prefix + "tail delta");
    expect(
      join.mock.contexts.every((parts) => (parts as string[]).every((part) => part.length <= 10)),
    ).toBe(true);
  } finally {
    join.mockRestore();
  }
});
