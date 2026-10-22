import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { editorCodeSelection, formatEditorSelectionReference } from "./editorSelection";

describe("editorCodeSelection", () => {
  it.each([false, true])(
    "excludes the trailing unselected line in either direction (%s)",
    (backwards) => {
      const state = EditorState.create({
        doc: "first\nsecond\nthird",
        selection: { anchor: backwards ? 13 : 0, head: backwards ? 0 : 13 },
      });
      expect(editorCodeSelection(state, "src/value.ts")).toEqual({
        path: "src/value.ts",
        startLine: 1,
        endLine: 2,
      });
    },
  );

  it("ignores cursors, whitespace and disjoint selections", () => {
    expect(editorCodeSelection(EditorState.create({ doc: "code" }), "a.ts")).toBeNull();
    expect(
      editorCodeSelection(
        EditorState.create({
          doc: " \n ",
          selection: { anchor: 0, head: 3 },
        }),
        "a.ts",
      ),
    ).toBeNull();
    expect(
      editorCodeSelection(
        EditorState.create({
          doc: "first\nsecond",
          extensions: [EditorState.allowMultipleSelections.of(true)],
          selection: EditorSelection.create([
            EditorSelection.range(0, 2),
            EditorSelection.range(6, 8),
          ]),
        }),
        "a.ts",
      ),
    ).toBeNull();
  });
});

describe("formatEditorSelectionReference", () => {
  it("includes a mentionable file and line range without copying its contents", () => {
    expect(
      formatEditorSelectionReference({
        path: "src/FileEditor.tsx",
        startLine: 12,
        endLine: 13,
      }),
    ).toBe("@src/FileEditor.tsx (lines 12-13)");
  });

  it("uses a compact location for a single selected line", () => {
    expect(
      formatEditorSelectionReference({
        path: "src/value.ts",
        startLine: 7,
        endLine: 7,
      }),
    ).toBe("@src/value.ts (line 7)");
  });

  it("quotes paths that cannot be represented as composer mentions", () => {
    expect(
      formatEditorSelectionReference({
        path: "docs/read me.md",
        startLine: 3,
        endLine: 5,
      }),
    ).toBe("`docs/read me.md` (lines 3-5)");
  });
});
