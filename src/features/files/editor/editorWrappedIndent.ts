import { StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

type LineRange = { from: number; to: number };

/** Wrapped continuation lines hang under their line's indentation. Shared by every code
 * surface that wraps (the file editor and the merge panes). */
export const editorWrappedIndent = StateField.define<DecorationSet>({
  create(state) {
    return Decoration.set(indentDecorations(state, [{ from: 0, to: state.doc.length }]), true);
  },
  update(decorations, transaction) {
    if (!transaction.docChanged) return decorations;
    const ranges: LineRange[] = [];
    transaction.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      const from = transaction.state.doc.lineAt(fromB).from;
      const to = transaction.state.doc.lineAt(toB).to;
      ranges.push({ from, to });
    });
    const changedLines = mergeLineRanges(ranges);
    return decorations.map(transaction.changes).update({
      filter: (from) => !changedLines.some((range) => from >= range.from && from <= range.to),
      add: indentDecorations(transaction.state, changedLines),
      sort: true,
    });
  },
  provide: (field) => EditorView.decorations.from(field),
});

function indentDecorations(state: EditorState, ranges: LineRange[]) {
  const decorations = [];
  for (const range of ranges) {
    let line = state.doc.lineAt(range.from);
    while (line.from <= range.to) {
      const columns = leadingIndentColumns(line.text, state.tabSize);
      if (columns > 0) {
        const indent = Math.min(columns, 40);
        decorations.push(
          Decoration.line({
            attributes: {
              class: "cm-wrapped-indent",
              style: `padding-left: calc(${indent}ch + 6px); text-indent: -${indent}ch`,
            },
          }).range(line.from),
        );
      }
      if (line.number >= state.doc.lines) break;
      line = state.doc.line(line.number + 1);
    }
  }
  return decorations;
}

function leadingIndentColumns(text: string, tabSize: number): number {
  let columns = 0;
  for (const character of text) {
    if (character === " ") {
      columns += 1;
    } else if (character === "\t") {
      columns += tabSize - (columns % tabSize);
    } else {
      break;
    }
  }
  return columns;
}

function mergeLineRanges(ranges: LineRange[]): LineRange[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const merged: LineRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.from <= previous.to + 1) {
      previous.to = Math.max(previous.to, range.to);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}
