import { diff } from "@codemirror/merge";
import type { Annotation, ChangeSpec } from "@codemirror/state";
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

export type LineEndings = {
  /** The convention a save restores: the majority ending, LF when there is none. */
  eol: LineEnding;
  /** The file uses more than one convention; `restoreLineEnding` alone would
   * rewrite the minority breaks, so saves go through `restoreLineEndings`. */
  mixed: boolean;
};

/** The breaks of `value` in order, each as the sequence found on disk. */
function lineBreaksOf(value: string): LineEnding[] {
  const breaks: LineEnding[] = [];
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 13) {
      if (value.charCodeAt(i + 1) === 10) {
        breaks.push("\r\n");
        i++;
      } else breaks.push("\r");
    } else if (code === 10) breaks.push("\n");
  }
  return breaks;
}

/**
 * The convention a file used before normalization. Only a strict majority of
 * the breaks (more than half) decides; a tie, a mere plurality or a file without
 * breaks reports LF. A single bare CR in an LF file, or one CRLF line in an LF
 * script, therefore never turns a save into a whole-file rewrite.
 */
export function detectLineEndings(value: string): LineEndings {
  if (!value.includes("\r")) return { eol: "\n", mixed: false };
  const counts = { "\n": 0, "\r\n": 0, "\r": 0 };
  for (const sequence of lineBreaksOf(value)) counts[sequence]++;
  const total = counts["\n"] + counts["\r\n"] + counts["\r"];
  const mixed = [counts["\n"], counts["\r\n"], counts["\r"]].filter((n) => n > 0).length > 1;
  const eol: LineEnding =
    counts["\r\n"] * 2 > total ? "\r\n" : counts["\r"] * 2 > total ? "\r" : "\n";
  return { eol, mixed };
}

/** The majority convention of `value`; see `detectLineEndings`. */
export function detectLineEnding(value: string): LineEnding {
  return detectLineEndings(value).eol;
}

/** Re-apply a file's own line-ending convention to LF document text. */
export function restoreLineEnding(value: string, eol: LineEnding): string {
  return eol === "\n" ? value : value.replace(/\n/g, eol);
}

/**
 * Serialize LF document text for a file whose disk content was `original`.
 * A file with one convention gets that convention back. A mixed file keeps the
 * exact break each unchanged line had on disk; only breaks inside edited spans
 * take the majority convention. Unchanged text therefore round-trips
 * byte-identically instead of being normalized by every save.
 */
export function restoreLineEndings(value: string, original: string): string {
  const { eol, mixed } = detectLineEndings(original);
  if (!mixed) return restoreLineEnding(value, eol);
  const breaks = lineBreaksOf(original);
  const normalized = normalizeLineBreaks(original);
  let out = "";
  let a = 0; // cursor in `normalized`
  let b = 0; // cursor in `value`
  let next = 0; // index of the next break of `normalized`
  const copyUnchanged = (length: number) => {
    for (let i = b; i < b + length; i++) {
      const char = value[i];
      out += char === "\n" ? (breaks[next++] ?? eol) : char;
    }
    b += length;
    a += length;
  };
  for (const change of diff(normalized, value, DOC_DIFF)) {
    // Text between two changes is identical on both sides, so its breaks map
    // one-to-one onto the breaks the file had there.
    copyUnchanged(change.fromA - a);
    for (let i = a; i < change.toA; i++) if (normalized.charCodeAt(i) === 10) next++;
    out += restoreLineEnding(value.slice(b, change.toB), eol);
    a = change.toA;
    b = change.toB;
  }
  copyUnchanged(value.length - b);
  return out;
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
