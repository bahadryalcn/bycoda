import { EditorState } from "@codemirror/state";
import { expect, it } from "vitest";
import { nextDocumentBytes, utf8ByteLength } from "./noteTextBytes";

const encoder = new TextEncoder();
const exact = (text: string) => encoder.encode(text).byteLength;

it("counts UTF-8 bytes exactly as TextEncoder does, lone surrogates included", () => {
  for (const text of [
    "",
    "plain ascii",
    "é漢",
    "🦀",
    "a\uD83Db",
    "\uDE80\uD83E",
    "🦀\uD83E",
    "x\u0000߿ࠀ￿",
  ])
    expect(utf8ByteLength(text)).toBe(exact(text));
});

function editedBytes(before: string, from: number, to: number, insert: string) {
  const state = EditorState.create({ doc: before });
  const transaction = state.update({ changes: { from, to, insert } });
  const startBytes = exact(state.doc.toString());
  return {
    incremental: nextDocumentBytes(state.doc, transaction.changes, startBytes),
    exact: exact(transaction.newDoc.toString()),
  };
}

it("tracks one edit without recounting the document, including edits that split a surrogate pair", () => {
  const cases: [string, number, number, string][] = [
    ["hello", 5, 5, " world"],
    ["hello", 0, 5, ""],
    ["a🦀b", 2, 2, "x"],
    ["a🦀b", 1, 2, ""],
    ["a🦀b", 2, 3, ""],
    ["a🦀b", 1, 3, "\uD83E"],
    ["a\uD83E", 2, 2, "\uDD80"],
    ["\uDD80b", 0, 0, "\uD83E"],
    ["🦀", 1, 1, "🦀"],
    ["\uD83Ex\uDD80", 1, 2, ""],
    ["漢字\nline", 1, 4, "é\r\n🦀"],
  ];
  for (const [before, from, to, insert] of cases) {
    const result = editedBytes(before, from, to, insert);
    expect(result.incremental, JSON.stringify([before, from, to, insert])).toBe(result.exact);
  }
});

it("keeps a randomized edit sequence equal to a full encode", () => {
  const alphabet = ["a", "é", "漢", "🦀", "\uD83E", "\uDD80", "\n"];
  let seed = 7;
  const random = (limit: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % limit;
  };
  let state = EditorState.create({ doc: "start🦀" });
  let bytes = exact(state.doc.toString());
  for (let step = 0; step < 400; step += 1) {
    const length = state.doc.length;
    const from = random(length + 1);
    const to = Math.min(length, from + random(4));
    const insert = Array.from({ length: random(4) }, () => alphabet[random(alphabet.length)]).join(
      "",
    );
    const transaction = state.update({ changes: { from, to, insert } });
    const next = nextDocumentBytes(state.doc, transaction.changes, bytes);
    expect(next).not.toBeNull();
    bytes = next!;
    state = transaction.state;
    expect(bytes).toBe(exact(state.doc.toString()));
  }
});

it("leaves a multi-range edit to the caller's full count", () => {
  const state = EditorState.create({ doc: "one two" });
  const transaction = state.update({
    changes: [
      { from: 0, to: 3, insert: "1" },
      { from: 4, to: 7, insert: "2" },
    ],
  });
  expect(nextDocumentBytes(state.doc, transaction.changes, 7)).toBeNull();
  expect(nextDocumentBytes(state.doc, state.update({}).changes, 7)).toBe(7);
});
