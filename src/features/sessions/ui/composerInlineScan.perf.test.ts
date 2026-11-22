import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { fullReparseInlineReferences } from "./composerInlineReferences.oracle";
import { buildDraft, inlineFixtureContext, seededRandom } from "./composerInlineReferences.fixture";
import { scanInlineReferences, updateInlineScan } from "./composerInlineScan";

function summarize(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)]!,
    p95: sorted[Math.floor(sorted.length * 0.95)]!,
  };
}

const format = ({ median, p95 }: { median: number; p95: number }) =>
  `median ${median.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms`;

/** Typing and deleting at spread-out positions of a draft, the way an edit stream arrives. */
describe.each([4, 64])("inline reference update on a %i KiB draft", (kib) => {
  it("is faster than reparsing the whole draft", () => {
    const context = inlineFixtureContext();
    const random = seededRandom(kib);
    let state = EditorState.create({ doc: buildDraft(kib * 1024, random) });
    let scan = scanInlineReferences(state.doc.toString(), context);
    const full: number[] = [];
    const incremental: number[] = [];
    const edits = 80;
    for (let index = -10; index < edits; index++) {
      const at = Math.floor(random() * state.doc.length);
      const transaction = state.update({
        changes:
          index % 4 === 3
            ? { from: at, to: Math.min(state.doc.length, at + 1) }
            : { from: at, insert: "x" },
      });
      state = transaction.state;
      let started = performance.now();
      const text = state.doc.toString();
      scan = updateInlineScan(scan, text, transaction.changes, context);
      const updated = performance.now() - started;
      started = performance.now();
      const expected = fullReparseInlineReferences(text, context);
      const reparsed = performance.now() - started;
      expect(scan.references).toEqual(expected);
      if (index >= 0) {
        incremental.push(updated);
        full.push(reparsed);
      }
    }
    const before = summarize(full);
    const after = summarize(incremental);
    console.info(
      `[inline references ${kib} KiB, ${scan.references.length} refs] full reparse: ${format(before)}; incremental: ${format(after)}`,
    );
    expect(after.median).toBeLessThan(before.median / 2);
  });
});
