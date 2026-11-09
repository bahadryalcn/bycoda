import { expect, it } from "vitest";
import {
  NotePreviewParser,
  notePreviewBlocks,
  notePreviewReferences,
  replacePreviewBlock,
} from "./previewBlocks";

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

it("incrementally reparses edits, inserted boundaries and fences with exact fresh-parser ranges", () => {
  const parser = new NotePreviewParser();
  const bodies = [
    "# Title\n\nFirst [link][ref].\n\nLast text.\n\n[ref]: https://example.org",
    "# Title\n\nEdited **text**.\n\nFirst [link][ref].\n\nLast text.\n\n[ref]: https://example.org",
    "# Title\n\n```js\nEdited **text**.\n\nFirst [link][ref].\n\nLast text.\n\n[ref]: https://example.org",
    "# Title\n\n```js\nEdited **text**.\n```\n\nFirst [link][ref].\n\nLast text.\n\n[ref]: https://example.org",
    "\n\n",
  ];
  for (const body of bodies) {
    expect(parser.parse(body).map(({ key: _key, ...block }) => block)).toEqual(
      notePreviewBlocks(body),
    );
  }
});

it("retains unaffected preview identities when the middle source range changes", () => {
  const parser = new NotePreviewParser();
  const before = parser.parse("First.\n\nMiddle.\n\nLast.");
  const after = parser.parse("First.\n\nA longer middle.\n\nLast.");
  expect(after[0]).toBe(before[0]);
  expect(after[2].key).toBe(before[2].key);
  expect(after[2].from).toBeGreaterThan(before[2].from);
  expect(parser.parse("First.\n\nA longer middle.\n\nLast.")).toBe(after);
});

it("shares only referenced ordinary definitions, preserving shortcuts, images, multiline labels and complex fallbacks", () => {
  const body = "Text\n\n[ref]: https://example.org\n\n[other]: /other\n\n[multi line]: /multi";
  const references = notePreviewReferences(notePreviewBlocks(body));
  expect(references("Unlinked plain text.")).toBe("");
  expect(references("[text][REF] and ![ref] and [ref][]")).toBe("[ref]: https://example.org");
  expect(references("[multi\n  line]")).toBe("[multi line]: /multi");
  expect(references("Escaped \\[ref]")).toContain("[other]: /other");
  const complex = notePreviewReferences(notePreviewBlocks("[a&amp;b]: /a\n\n[other]: /other"));
  expect(complex("[a&b]")).toContain("[a&amp;b]: /a");
  const unicode = notePreviewReferences(
    notePreviewBlocks("[a b]: /space\n\n[a\u00a0b]: /nbsp\n\n[ϴ]: /theta"),
  );
  expect(unicode("[a\u00a0b]")).toBe("[a\u00a0b]: /nbsp");
  expect(unicode("[θ]")).toBe("[ϴ]: /theta");
});
