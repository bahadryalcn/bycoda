import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { fullReparseInlineReferences } from "./composerInlineReferences.oracle";
import type { InlineReferenceContext } from "./composerInlineReferences";
import {
  buildDraft,
  INLINE_FIXTURE_PIECES,
  inlineFixtureContext,
  seededRandom,
} from "./composerInlineReferences.fixture";
import { createInlineScan, scanInlineReferences, updateInlineScan } from "./composerInlineScan";

const TYPED = [
  "x",
  " ",
  "\n",
  "`",
  "``",
  "```\n",
  "~~~\n",
  "[",
  "]",
  "(",
  ")",
  "@",
  "/",
  "$",
  ">",
  "\\",
];
const PASTED = [
  ...INLINE_FIXTURE_PIECES,
  "@App.tsx ",
  "```ts\nconst a = '[image1]';\n```",
  "line one\nline two\n\nline four https://example.com/x",
];

function contexts(): InlineReferenceContext[] {
  const base = inlineFixtureContext();
  return [
    base,
    inlineFixtureContext(5),
    { ...base, mcpTags: [{ token: "@github", server: { name: "GitHub" } } as never] },
  ];
}

type Edit = { from: number; to: number; insert: string };

/** Typing, paste, delete, fence open/close and reference insertion, one or two ranges at a time. */
function randomEdits(text: string, random: () => number): Edit[] {
  const at = () => Math.floor(random() * (text.length + 1));
  const pick = (list: readonly string[]) => list[Math.floor(random() * list.length)]!;
  const one = (): Edit => {
    const roll = random();
    const from = at();
    if (roll < 0.35) return { from, to: from, insert: pick(TYPED) };
    if (roll < 0.55) return { from, to: from, insert: pick(PASTED) };
    if (roll < 0.8) {
      const to = Math.min(text.length, from + Math.floor(random() * 12));
      return { from, to, insert: "" };
    }
    const to = Math.min(text.length, from + Math.floor(random() * 40));
    return { from, to, insert: random() < 0.5 ? pick(TYPED) : pick(PASTED) };
  };
  const first = one();
  if (random() < 0.8) return [first];
  const second = one();
  // Two edits in one transaction, in document order and not overlapping.
  const [a, b] = first.from <= second.from ? [first, second] : [second, first];
  return a.to < b.from ? [a, b] : [a];
}

function expectSame(actual: unknown, text: string, context: InlineReferenceContext, trail: string) {
  expect(actual, `${trail}\n${JSON.stringify(text)}`).toEqual(
    fullReparseInlineReferences(text, context),
  );
}

describe("incremental inline reference scan", () => {
  it("equals a full reparse after random edit sequences", () => {
    for (const [index, context] of contexts().entries()) {
      for (let seed = 1; seed <= 20; seed++) {
        const random = seededRandom(seed * 7919 + index);
        let state = EditorState.create({ doc: buildDraft(900, random) });
        let scan = scanInlineReferences(state.doc.toString(), context);
        expectSame(scan.references, state.doc.toString(), context, "initial");
        const trail: string[] = [];
        for (let step = 0; step < 40; step++) {
          const edits = randomEdits(state.doc.toString(), random);
          trail.push(JSON.stringify(edits));
          const transaction = state.update({ changes: edits });
          state = transaction.state;
          scan = updateInlineScan(scan, state.doc.toString(), transaction.changes, context);
          expectSame(
            scan.references,
            state.doc.toString(),
            context,
            `seed ${seed}: ${trail.join(" ")}`,
          );
        }
      }
    }
  });

  it("rescans when a code fence opens and closes far above later references", () => {
    const context = inlineFixtureContext();
    const draft =
      "intro\n\nsee [image1] and https://example.com/a\n\n[docs](https://example.org/d) @crews:backend-engineer\n";
    let state = EditorState.create({ doc: draft });
    let scan = createInlineScan(state, context);
    expect(scan.references.map((ref) => ref.kind)).toEqual(["attachment", "url", "url", "crew"]);
    for (const change of [
      { from: 0, insert: "```\n" },
      { from: 0, to: 4, insert: "" },
    ]) {
      const transaction = state.update({ changes: change });
      state = transaction.state;
      scan = updateInlineScan(scan, state.doc.toString(), transaction.changes, context);
      expectSame(scan.references, state.doc.toString(), context, JSON.stringify(change));
    }
    expect(scan.references).toHaveLength(4);
  });

  it("reuses an unchanged scan and follows a context change", () => {
    const [base, withMode] = contexts();
    const text = "/review check [image1]\n/plan next @App.tsx";
    const state = EditorState.create({ doc: text });
    let scan = scanInlineReferences(text, base!);
    const same = updateInlineScan(scan, text, state.update({}).changes, base!);
    expect(same).toBe(scan);
    scan = updateInlineScan(scan, text, state.update({}).changes, withMode!);
    expectSame(scan.references, text, withMode!, "mode");
  });
});
