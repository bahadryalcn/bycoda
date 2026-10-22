// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { conflictAnchors, mapLine } from "./conflictScrollSync";

let view: EditorView | undefined;
afterEach(() => view?.destroy());

describe("conflict scroll alignment", () => {
  it("anchors each conflict by its line span, including empty sides", () => {
    view = new EditorView({ doc: "a\nb\nc\nd\ne\n" });
    // "b\nc\n" is a two-line conflict; an empty side sits at the start of "e".
    expect(
      conflictAnchors(view, [
        { from: 2, to: 6 },
        { from: 8, to: 8 },
      ]),
    ).toEqual([1, 2, 4, 5, 5, 7]);
  });

  it("keeps shared context line-for-line and stretches conflicts between their bounds", () => {
    // Source: 10 context lines, a 2-line conflict, then context. Result: same with a 6-line conflict.
    const source = [1, 11, 13, 31];
    const result = [1, 11, 17, 35];
    expect(mapLine(5.5, source, result)).toBe(5.5);
    expect(mapLine(11, source, result)).toBe(11);
    expect(mapLine(12, source, result)).toBe(14);
    expect(mapLine(13, source, result)).toBe(17);
    expect(mapLine(20, source, result)).toBe(24);
  });

  it("falls back to proportional scrolling when conflict counts differ", () => {
    expect(mapLine(51, [1, 101], [1, 5, 9, 201])).toBe(101);
  });
});
