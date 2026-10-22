import { expect, it } from "vitest";
import { notePreviewBlocks, replacePreviewBlock } from "./previewBlocks";

it("edits only the chosen Markdown block, preserving fences, tables, whitespace and references", () => {
  const body =
    "# Plan\n\nFirst [link][ref].\n\n```ts\nconst x = 1;\n```\n\n| a | b |\n| - | - |\n| c | d |\n\n[ref]: https://example.com\n";
  const blocks = notePreviewBlocks(body);
  expect(blocks).toHaveLength(5);
  expect(blocks.at(-1)?.definition).toBe(true);
  const block = blocks[1];
  expect(replacePreviewBlock(body, block.from, block.to, "Edited **paragraph**.")).toBe(
    body.replace("First [link][ref].", "Edited **paragraph**."),
  );
  expect(blocks[2].text).toContain("const x = 1;");
  expect(blocks[3].text).toContain("| c | d |");
});

it("keeps nested lists and quotes together and handles blank notes", () => {
  expect(
    notePreviewBlocks("- one\n  - nested\n- two\n\n> a\n> b").map((block) => block.text),
  ).toEqual(["- one\n  - nested\n- two", "> a\n> b"]);
  expect(notePreviewBlocks("\n\n")).toEqual([]);
});
