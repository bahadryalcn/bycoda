import { describe, expect, it } from "vitest";
import {
  resolveTranscriptSelection,
  selectedOccurrence,
  validateTranscriptSelection,
  type TranscriptSelection,
} from "./transcriptSelection";
import { selectedTextOffset } from "./translationHistory";

describe("selectedOccurrence", () => {
  it("counts non-overlapping matches before the selection", () => {
    expect(selectedOccurrence("", "a")).toBe(0);
    expect(selectedOccurrence("a a a", "a")).toBe(3);
    expect(selectedOccurrence("aaaa", "aa")).toBe(2);
  });

  it("returns 0 for an empty needle instead of looping", () => {
    expect(selectedOccurrence("abc", "")).toBe(0);
  });

  it.each([
    ["Same and Same", "Same", 9],
    ["Same. Same. Same.", "Same", 12],
    ["xx one xx one", "one", 10],
  ])("round-trips with selectedTextOffset for %j", (value, text, start) => {
    const occurrence = selectedOccurrence(value.slice(0, start), text);
    expect(selectedTextOffset(value, text, occurrence)).toBe(start);
  });
});

describe("resolveTranscriptSelection", () => {
  const base = { text: "Same", rect: new DOMRect(0, 0, 1, 1), responseId: "answer" };

  it("returns the selection unchanged when it carries no live source", () => {
    const copy: TranscriptSelection = { ...base, occurrence: 0, responseText: "Same" };
    expect(resolveTranscriptSelection(copy)).toBe(copy);
  });

  it("copies the occurrence and response text read now, keeping the live handle", () => {
    const resolveSource = () => ({ occurrence: 2, responseText: "Same Same Same" });
    const resolved = resolveTranscriptSelection({ ...base, resolveSource });
    expect(resolved).toMatchObject({
      text: "Same",
      occurrence: 2,
      responseText: "Same Same Same",
      resolveSource,
    });
  });

  it("refuses when the selected text is gone", () => {
    expect(resolveTranscriptSelection({ ...base, resolveSource: () => null })).toBeNull();
  });
});

describe("validateTranscriptSelection", () => {
  it("accepts non-empty text within one settled response", () => {
    expect(
      validateTranscriptSelection({
        text: " selected ",
        collapsed: false,
        anchorResponseId: "response-1",
        focusResponseId: "response-1",
      }),
    ).toBe("selected");
  });

  it.each([
    [true, "response-1", "response-1"],
    [false, null, "response-1"],
    [false, "response-1", null],
    [false, "response-1", "response-2"],
  ])("rejects an invalid selection %#", (collapsed, anchor, focus) => {
    expect(
      validateTranscriptSelection({
        text: "selected",
        collapsed,
        anchorResponseId: anchor,
        focusResponseId: focus,
      }),
    ).toBeNull();
  });
});
