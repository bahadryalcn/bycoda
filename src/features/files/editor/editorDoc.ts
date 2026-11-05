import { Chunk, diff } from "@codemirror/merge";
import { Text, type Annotation, type ChangeSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const DOC_DIFF = { scanLimit: 5_000, timeout: 100 };

/**
 * CodeMirror documents are LF-only: `EditorView({ doc })` splits on any line
 * break. Anything diffed against or inserted into a document must match, or a
 * lone `\r` insert (CRLF disk content vs. an LF document) becomes an extra
 * line break, doubling every line.
 */
export function normalizeLineBreaks(value: string): string {
  return value.includes("\r") ? value.replace(/\r\n?/g, "\n") : value;
}

export type LineEnding = "\n" | "\r\n" | "\r";

/** Most common separator, with first occurrence breaking ties; no breaks defaults to LF. */
export function detectLineEnding(value: string): LineEnding {
  const counts = new Map<LineEnding, number>();
  for (const match of value.matchAll(/\r\n|\r|\n/g)) {
    const ending = match[0] as LineEnding;
    counts.set(ending, (counts.get(ending) ?? 0) + 1);
  }
  let best: LineEnding = "\n";
  let maximum = 0;
  for (const [ending, count] of counts)
    if (count > maximum) {
      best = ending;
      maximum = count;
    }
  return best;
}

/** Re-apply a uniform convention where no per-break source exists. */
export function restoreLineEnding(value: string, eol: LineEnding): string {
  return eol === "\n" ? value : value.replace(/\n/g, eol);
}

/** Preserve separators on unchanged characters; new separators use the source majority. */
export function restoreMixedLineEndings(
  value: string,
  original: string,
  fallback = detectLineEnding(original),
): string {
  const target = normalizeLineBreaks(value);
  const baseline = normalizeLineBreaks(original);
  if (target === baseline) return original;
  const originalBreaks = new Map<number, LineEnding>();
  let normalizedPosition = 0;
  for (let i = 0; i < original.length; i++, normalizedPosition++) {
    if (original[i] === "\r") {
      const ending: LineEnding = original[i + 1] === "\n" ? "\r\n" : "\r";
      originalBreaks.set(normalizedPosition, ending);
      if (ending === "\r\n") i++;
    } else if (original[i] === "\n") originalBreaks.set(normalizedPosition, "\n");
  }
  if (new Set(originalBreaks.values()).size <= 1) return restoreLineEnding(target, fallback);
  const mapped = new Map<number, LineEnding>();
  // Use deterministic limits for both passes: presentation chunks may expand changes.
  const preservationDiff = { scanLimit: 5_000 };
  const chunks = Chunk.build(
    Text.of(baseline.split("\n")),
    Text.of(target.split("\n")),
    preservationDiff,
  );
  if (chunks.some((chunk) => !chunk.precise)) {
    throw new Error(
      "Cannot safely preserve mixed line endings for this edit. Keep the draft and retry with smaller edits.",
    );
  }
  const changes = diff(baseline, target, preservationDiff);
  let oldPosition = 0;
  let newPosition = 0;
  for (const change of [
    ...changes,
    { fromA: baseline.length, toA: baseline.length, fromB: target.length, toB: target.length },
  ]) {
    for (let i = oldPosition; i < change.fromA; i++) {
      const ending = originalBreaks.get(i);
      if (ending) mapped.set(newPosition + i - oldPosition, ending);
    }
    // Diff can place an insertion before the old line break. Keep that break
    // attached to its original line rather than the newly inserted line.
    if (
      change.fromA === change.toA &&
      baseline[change.fromA] === "\n" &&
      target[change.fromB] === "\n" &&
      change.toB > change.fromB
    ) {
      const ending = originalBreaks.get(change.fromA);
      if (ending) {
        mapped.set(change.fromB, ending);
        originalBreaks.delete(change.fromA);
      }
    }
    oldPosition = change.toA;
    newPosition = change.toB;
  }
  let result = "";
  let start = 0;
  for (let i = 0; i < target.length; i++)
    if (target[i] === "\n") {
      result += target.slice(start, i) + (mapped.get(i) ?? fallback);
      start = i + 1;
    }
  return result + target.slice(start);
}

export function editorDocChanges(from: string, to: string): ChangeSpec[] {
  const target = normalizeLineBreaks(to);
  if (from === target) return [];
  return diff(from, target, DOC_DIFF).map((change) => ({
    from: change.fromA,
    to: change.toA,
    insert: target.slice(change.fromB, change.toB),
  }));
}

export function replaceEditorDoc(
  view: EditorView,
  next: string,
  options?: {
    selection?: { anchor: number; head?: number };
    annotations?: readonly Annotation<unknown>[];
    /** Set when something other than `view.scrollDOM` scrolls the editor. */
    scroller?: HTMLElement;
  },
): boolean {
  const prev = view.state.doc.toString();
  const target = normalizeLineBreaks(next);
  if (prev === target) return false;
  const changes = editorDocChanges(prev, target);
  // A scroll snapshot only knows the editor's own scroller.
  const outer = options?.scroller && options.scroller !== view.scrollDOM ? options.scroller : null;
  const outerTop = outer?.scrollTop ?? 0;
  view.dispatch({
    changes: changes.length > 0 ? changes : { from: 0, to: view.state.doc.length, insert: target },
    selection: options?.selection,
    annotations: options?.annotations,
    scrollIntoView: false,
    effects: outer ? [] : view.scrollSnapshot(),
  });
  if (view.state.doc.toString() !== target) return false;
  if (outer) outer.scrollTop = outerTop;
  return true;
}

/** Keep the caret at the same screen position across a layout-changing update. */
export function preserveEditorViewport(
  view: EditorView,
  mutate: () => void,
  scroller: HTMLElement = view.scrollDOM,
) {
  const head = view.state.selection.main.head;
  const before = view.coordsAtPos(head);
  const scrollerTop = scroller.getBoundingClientRect().top;
  const offsetY = before ? before.top - scrollerTop : null;
  const scrollTop = scroller.scrollTop;
  const scrollLeft = scroller.scrollLeft;

  mutate();

  const restore = () => {
    if (!view.dom.isConnected) return;
    if (offsetY == null) {
      scroller.scrollTop = scrollTop;
      scroller.scrollLeft = scrollLeft;
      return;
    }
    const after = view.coordsAtPos(view.state.selection.main.head);
    if (!after) return;
    scroller.scrollTop += after.top - scroller.getBoundingClientRect().top - offsetY;
  };
  restore();
  view.requestMeasure({
    key: preserveEditorViewport,
    read: () => true,
    write: restore,
  });
}

/** The document line at the top of what `scroller` currently shows. */
export function topVisibleLine(view: EditorView, scroller: HTMLElement): number {
  const block = view.lineBlockAtHeight(scroller.scrollTop);
  return view.state.doc.lineAt(block.from).number;
}

/** Scroll so `line` (clamped to the document) sits at the top of the view. */
export function scrollLineToTop(view: EditorView, line: number): void {
  const doc = view.state.doc;
  const clamped = Math.min(Math.max(1, line), doc.lines);
  view.dispatch({
    effects: EditorView.scrollIntoView(doc.line(clamped).from, {
      y: "start",
      yMargin: 0,
    }),
  });
}
