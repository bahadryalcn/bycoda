import { isolateHistory } from "@codemirror/commands";
import {
  StateField,
  type EditorState,
  type Extension,
  type Range,
  type Text,
  type Transaction,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import {
  conflictReplacement,
  findConflictBlocks,
  type ConflictBlock,
  type ConflictSide,
} from "../../source-control/model/conflictMarkers";

/**
 * Git conflict blocks in the open document: both sides tinted, the markers and
 * any diff3 base dimmed, and an action bar above each block. Parsing is
 * `findConflictBlocks`; this file only draws it and applies one block at a time.
 *
 * The document is LF-only (see editorDoc.ts), so a block's offsets are document
 * positions and its replacement is LF text; the file's own line endings come
 * back when it is saved.
 */

type ConflictState = {
  blocks: readonly ConflictBlock[];
  decorations: DecorationSet;
};

const lineClass = {
  marker: Decoration.line({ class: "cm-conflictMarker" }),
  oursMarker: Decoration.line({ class: "cm-conflictMarker cm-conflictOursMarker" }),
  theirsMarker: Decoration.line({
    class: "cm-conflictMarker cm-conflictTheirsMarker",
  }),
  ours: Decoration.line({ class: "cm-conflictOurs" }),
  base: Decoration.line({ class: "cm-conflictBase" }),
  theirs: Decoration.line({ class: "cm-conflictTheirs" }),
};

const LABEL_LIMIT = 28;

function labelSuffix(label: string): string {
  if (!label) return "";
  const text = label.length > LABEL_LIMIT ? `${label.slice(0, LABEL_LIMIT - 1)}…` : label;
  return ` (${text})`;
}

class ConflictActionsWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly oursLabel: string,
    readonly theirsLabel: string,
  ) {
    super();
  }

  eq(other: ConflictActionsWidget) {
    return (
      other.from === this.from &&
      other.oursLabel === this.oursLabel &&
      other.theirsLabel === this.theirsLabel
    );
  }

  toDOM(view: EditorView) {
    const bar = document.createElement("div");
    bar.className = "cm-conflictActions";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Resolve merge conflict");
    const actions: [ConflictSide, string, string][] = [
      ["ours", `Accept Current${labelSuffix(this.oursLabel)}`, this.oursLabel],
      ["theirs", `Accept Incoming${labelSuffix(this.theirsLabel)}`, this.theirsLabel],
      ["both", "Accept Both", ""],
    ];
    for (const [side, text, title] of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `cm-conflictAction cm-conflictAction-${side}`;
      button.textContent = text;
      if (title) button.title = title;
      // Keep the caret where it is; the click is handled below.
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        resolveConflict(view, this.from, side);
        view.focus();
      });
      bar.append(button);
    }
    return bar;
  }

  ignoreEvent() {
    return true;
  }
}

function buildConflicts(state: EditorState): ConflictState {
  const blocks = findConflictBlocks(state.doc.toString());
  if (blocks.length === 0) return { blocks, decorations: Decoration.none };

  const ranges: Range<Decoration>[] = [];
  const doc = state.doc;
  const mark = (line: number, deco: Decoration) => ranges.push(deco.range(doc.line(line).from));
  const section = (
    { startLine, endLine }: { startLine: number; endLine: number },
    deco: Decoration,
  ) => {
    for (let line = startLine; line <= endLine; line += 1) mark(line, deco);
  };
  for (const block of blocks) {
    ranges.push(
      Decoration.widget({
        widget: new ConflictActionsWidget(block.from, block.oursLabel, block.theirsLabel),
        block: true,
        side: -1,
      }).range(block.from),
    );
    mark(block.markerLines.ours, lineClass.oursMarker);
    section(block.ours, lineClass.ours);
    if (block.base && block.markerLines.base !== null) {
      mark(block.markerLines.base, lineClass.marker);
      section(block.base, lineClass.base);
    }
    mark(block.markerLines.split, lineClass.marker);
    section(block.theirs, lineClass.theirs);
    mark(block.markerLines.theirs, lineClass.theirsMarker);
  }
  return { blocks, decorations: Decoration.set(ranges, true) };
}

// Same line shapes as conflictMarkers.ts (`findConflictBlocks`), tested one line
// at a time so a keystroke does not need the whole document as a string.
const MARKER_LINE = [/^<{7}( |$)/, /^\|{7}( |$)/, /^={7}$/, /^>{7}( |$)/];

function isMarkerLine(text: string): boolean {
  const first = text.charCodeAt(0);
  // `<` `=` `>` `|`: most lines are rejected here without trimming.
  if (first !== 60 && first !== 61 && first !== 62 && first !== 124) return false;
  const marker = text.trimEnd();
  return MARKER_LINE.some((pattern) => pattern.test(marker));
}

function rangeHasMarkerLine(doc: Text, from: number, to: number): boolean {
  const last = doc.lineAt(to).number;
  for (let n = doc.lineAt(from).number; n <= last; n += 1) {
    if (isMarkerLine(doc.line(n).text)) return true;
  }
  return false;
}

/**
 * Whether the transaction added, removed or edited a conflict-marker line:
 * any touched line that is a marker in the old or the new document. When the
 * document had no conflict blocks and no marker line was touched, the marker
 * lines are exactly what they were, so it still has none. A marker completed
 * by joining text lies on a touched line, so it is caught.
 */
export function touchesConflictMarker(tr: Transaction): boolean {
  let found = false;
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    found ||=
      rangeHasMarkerLine(tr.newDoc, fromB, toB) ||
      rangeHasMarkerLine(tr.startState.doc, fromA, toA);
  });
  return found;
}

const conflictField = StateField.define<ConflictState>({
  create: buildConflicts,
  update(value, tr) {
    if (!tr.docChanged) return value;
    // Existing blocks can shift or break with any edit; rebuild those. Without
    // blocks, only an edit touching a marker line can produce one.
    if (value.blocks.length === 0 && !touchesConflictMarker(tr)) return value;
    return buildConflicts(tr.state);
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

export function conflictBlocks(state: EditorState): readonly ConflictBlock[] {
  return state.field(conflictField).blocks;
}

/**
 * Replace the block that starts at `from` with one side, as an ordinary edit:
 * undoable on its own, and dirty like any other change.
 */
export function resolveConflict(view: EditorView, from: number, side: ConflictSide): boolean {
  const block = conflictBlocks(view.state).find((entry) => entry.from === from);
  if (!block) return false;
  view.dispatch({
    changes: {
      from: block.from,
      to: block.to,
      insert: conflictReplacement(view.state.doc.toString(), block, side),
    },
    annotations: isolateHistory.of("full"),
    userEvent: "conflict.resolve",
  });
  return true;
}

/** Move the caret to the next or previous block, wrapping around. */
export function stepConflict(view: EditorView, delta: 1 | -1): boolean {
  const blocks = conflictBlocks(view.state);
  if (blocks.length === 0) return false;
  const head = view.state.selection.main.head;
  let target: ConflictBlock;
  if (delta > 0) {
    target = blocks.find((block) => block.from > head) ?? blocks[0];
  } else {
    // Starts on the last block: the wrap, when none lies before the caret.
    target = blocks[blocks.length - 1];
    for (const block of blocks) if (block.to <= head) target = block;
  }
  view.dispatch({
    selection: { anchor: target.from },
    effects: EditorView.scrollIntoView(target.from, { y: "center" }),
  });
  return true;
}

const conflictTheme = EditorView.theme({
  ".cm-conflictOurs, .cm-line.cm-gitInsertedLine.cm-conflictOurs": {
    backgroundColor: "color-mix(in srgb, #14b8a6 17%, transparent)",
    boxShadow: "inset 3px 0 0 #14b8a6",
  },
  ".cm-conflictTheirs, .cm-line.cm-gitInsertedLine.cm-conflictTheirs": {
    backgroundColor: "color-mix(in srgb, #3b82f6 17%, transparent)",
    boxShadow: "inset 3px 0 0 #3b82f6",
  },
  ".cm-conflictBase, .cm-line.cm-gitInsertedLine.cm-conflictBase": {
    backgroundColor: "color-mix(in srgb, var(--color-content) 5%, transparent)",
    boxShadow: "inset 3px 0 0 color-mix(in srgb, var(--color-content) 25%, transparent)",
    color: "color-mix(in srgb, var(--color-content) 60%, transparent)",
  },
  ".cm-conflictMarker, .cm-line.cm-gitInsertedLine.cm-conflictMarker": {
    color: "color-mix(in srgb, var(--color-content) 45%, transparent)",
    backgroundColor: "color-mix(in srgb, var(--color-content) 7%, transparent)",
    boxShadow: "inset 3px 0 0 color-mix(in srgb, var(--color-content) 25%, transparent)",
  },
  ".cm-conflictOursMarker, .cm-line.cm-gitInsertedLine.cm-conflictOursMarker": {
    boxShadow: "inset 3px 0 0 #14b8a6",
  },
  ".cm-conflictTheirsMarker, .cm-line.cm-gitInsertedLine.cm-conflictTheirsMarker": {
    boxShadow: "inset 3px 0 0 #3b82f6",
  },
  ".cm-conflictActions": {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px",
    padding: "3px 6px",
    fontFamily: "var(--font-sans, sans-serif)",
    fontSize: "11px",
    lineHeight: "1.4",
  },
  ".cm-conflictAction": {
    cursor: "pointer",
    padding: "1px 7px",
    borderRadius: "4px",
    border: "1px solid color-mix(in srgb, var(--color-content) 14%, transparent)",
    backgroundColor: "color-mix(in srgb, var(--color-content) 6%, transparent)",
    color: "color-mix(in srgb, var(--color-content) 80%, transparent)",
    font: "inherit",
  },
  ".cm-conflictAction:hover": {
    backgroundColor: "color-mix(in srgb, var(--color-content) 14%, transparent)",
    color: "var(--color-content)",
  },
  ".cm-conflictAction:focus-visible": {
    outline: "1px solid var(--color-accent)",
  },
  ".cm-conflictAction-ours": {
    borderColor: "color-mix(in srgb, #14b8a6 55%, transparent)",
  },
  ".cm-conflictAction-theirs": {
    borderColor: "color-mix(in srgb, #3b82f6 55%, transparent)",
  },
});

export const editorConflicts: Extension = [conflictField, conflictTheme];
