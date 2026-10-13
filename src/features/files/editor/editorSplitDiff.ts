import { getChunks, MergeView } from "@codemirror/merge";
import { EditorState, type Extension, type Text } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { editorDocChanges } from "./editorDoc";
import {
  DIFF_CONFIG,
  diffLineStats,
  navigableChunkPositions,
  PLUS_SVG,
  revertChunkIn,
  stageChunkIn,
  UNDO_SVG,
  widgetPos,
  type GitStageHandler,
} from "./editorGit";

const REMOVED = "#f87171";
const ADDED = "#34d399";

const splitScroll = EditorView.domEventHandlers({
  wheel(event, view) {
    if (event.defaultPrevented || event.ctrlKey || event.shiftKey || !event.deltaY) return false;
    const scroller = view.dom.closest<HTMLElement>(".cm-mergeView");
    if (!scroller || scroller.scrollHeight <= scroller.clientHeight) return false;
    const lineHeight = parseFloat(getComputedStyle(view.scrollDOM).lineHeight) || 20;
    const scale =
      event.deltaMode === 1 ? lineHeight : event.deltaMode === 2 ? scroller.clientHeight : 1;
    // A pane is a horizontal scroll container even when its lines wrap. Route
    // vertical gestures explicitly so browsers cannot latch them to that pane.
    scroller.scrollTop = Math.max(
      0,
      Math.min(
        scroller.scrollHeight - scroller.clientHeight,
        scroller.scrollTop + event.deltaY * scale,
      ),
    );
    if (event.deltaX) {
      view.scrollDOM.scrollLeft +=
        event.deltaX * (event.deltaMode === 2 ? view.scrollDOM.clientWidth : scale);
    }
    event.preventDefault();
    return true;
  },
});

/**
 * Before/after panes with the same red and green as the inline layout. The
 * merge package's own colors are faint and tuned for a light page.
 */
const splitTheme = EditorView.theme({
  "&.cm-merge-a .cm-scroller, &.cm-merge-b .cm-scroller": {
    // The shared merge container owns vertical scrolling. The regular editor
    // theme's overscroll lock would trap wheel/touchpad gestures in each pane.
    overscrollBehaviorY: "auto",
  },
  "&.cm-merge-a .cm-changedLine": {
    backgroundColor: `color-mix(in srgb, ${REMOVED} 16%, transparent)`,
  },
  "&.cm-merge-b .cm-changedLine": {
    backgroundColor: `color-mix(in srgb, ${ADDED} 18%, transparent)`,
  },
  // The package styles these per color scheme with more specific selectors.
  "&.cm-merge-a .cm-changedText": {
    background: `color-mix(in srgb, ${REMOVED} 38%, transparent) !important`,
  },
  "&.cm-merge-b .cm-changedText": {
    background: `color-mix(in srgb, ${ADDED} 38%, transparent) !important`,
  },
  "&.cm-merge-a .cm-changedLineGutter": {
    background: `${REMOVED} !important`,
  },
  "&.cm-merge-b .cm-changedLineGutter": {
    background: `${ADDED} !important`,
  },
});

/**
 * Two editors side by side: `original` read-only on the left, the live
 * document on the right. Hunks are aligned with spacers and the pair scrolls
 * together as `split.dom`, not as either editor's own scroller.
 *
 * Edits to the right editor behave as in any other editor; this only adds the
 * left pane and the chunk bookkeeping.
 */
export function createSplitDiff(options: {
  parent: HTMLElement;
  original: string;
  doc: string | Text;
  /** Extensions for the editable right pane. */
  extensions: Extension;
  /** Extensions for the left pane, on top of its read-only setup. */
  originalExtensions: Extension;
  /**
   * Stages new index contents (LF, like the documents; the handler restores
   * the file's line endings). Read when a hunk is staged, so it can change
   * without rebuilding the view; undefined hides the stage control.
   */
  stage?: () => GitStageHandler | undefined;
}): MergeView {
  // `renderRevertControl` runs after construction, so `split` is set by then.
  const split: MergeView = new MergeView({
    a: {
      doc: options.original,
      extensions: [
        options.originalExtensions,
        EditorState.readOnly.of(true),
        EditorView.contentAttributes.of({ "aria-label": "Before (read-only)" }),
        splitTheme,
        splitScroll,
      ],
    },
    b: {
      doc: options.doc,
      extensions: [
        options.extensions,
        EditorView.contentAttributes.of({ "aria-label": "After" }),
        splitTheme,
        splitScroll,
      ],
    },
    diffConfig: DIFF_CONFIG,
    parent: options.parent,
    // One small control per hunk in the gutter between the panes. The merge
    // package would revert on mousedown by itself; these stop that and go
    // through editorGit instead, so the result matches the inline layout.
    revertControls: "a-to-b",
    renderRevertControl: () =>
      hunkControl((action, index) => {
        if (action === "revert") revertSplitChunk(split, index);
        // The editor's stage handler already reports failures.
        else void stageSplitChunk(split, index, options.stage?.()).catch(() => {});
      }),
  });
  setSplitCanStage(split, options.stage?.() !== undefined);
  split.dom.style.height = "100%";
  split.dom.style.overscrollBehavior = "none";
  const afterPane = split.b.dom.parentElement;
  if (afterPane) {
    afterPane.style.borderLeft =
      "1px solid color-mix(in srgb, var(--color-content) 12%, transparent)";
  }
  return split;
}

const HUNK_CONTROL_CLASS = "cm-split-hunk";

function hunkControl(
  onAction: (action: "revert" | "stage", chunkIndex: number) => void,
): HTMLElement {
  const bar = document.createElement("div");
  bar.className = HUNK_CONTROL_CLASS;
  const add = (action: "revert" | "stage", label: string, svg: string) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `${HUNK_CONTROL_CLASS}-${action}`;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = svg;
    // The merge package sets `data-chunk` on `bar` after rendering it.
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const index = Number(bar.dataset.chunk);
      if (Number.isInteger(index)) onAction(action, index);
    });
    bar.append(button);
  };
  add("revert", "Revert change", UNDO_SVG);
  add("stage", "Stage change", PLUS_SVG);
  return bar;
}

/** Show or hide the stage control on every hunk (CSS keys off this class). */
export function setSplitCanStage(split: MergeView, canStage: boolean) {
  split.dom.classList.toggle("cm-split-can-stage", canStage);
}

/** Put hunk `index` of the right pane back to the left pane's text. */
export function revertSplitChunk(split: MergeView, index: number): boolean {
  const chunk = split.chunks[index];
  if (!chunk) return false;
  return revertChunkIn(split.b, split.a.state.doc, widgetPos(split.b.state.doc, chunk));
}

/**
 * Stage hunk `index` of the right pane, then make the left pane show the
 * result so that hunk reads as unchanged right away. Whole hunks only: the
 * inline layout's "stage the selected lines" has no counterpart here.
 */
export async function stageSplitChunk(
  split: MergeView,
  index: number,
  onStage: GitStageHandler | undefined,
): Promise<boolean> {
  const chunk = split.chunks[index];
  if (!chunk || !onStage) return false;
  const contents = await stageChunkIn(
    split.b,
    split.a.state.doc,
    widgetPos(split.b.state.doc, chunk),
    onStage,
  );
  if (contents == null) return false;
  setSplitOriginal(split, contents);
  return true;
}

/** Where each hunk starts in the right pane, for next/previous navigation. */
export function splitNavigablePositions(split: MergeView): number[] {
  return navigableChunkPositions(split.b.state.doc, split.chunks, split.a.state.doc);
}

export function splitLineStats(split: MergeView): {
  additions: number;
  deletions: number;
} {
  return diffLineStats(split.b.state.doc, split.chunks, split.a.state.doc);
}

/** Whether an update to the right pane can change the change counter. */
export function splitNavUpdateRelevant(update: ViewUpdate): boolean {
  return (
    update.docChanged ||
    update.geometryChanged ||
    getChunks(update.state)?.chunks !== getChunks(update.startState)?.chunks
  );
}

/**
 * Point the left pane at new "before" text, as a minimal edit so the chunks
 * update incrementally and the viewport stays put. Returns whether it changed.
 */
export function setSplitOriginal(split: MergeView, original: string): boolean {
  const changes = editorDocChanges(split.a.state.doc.toString(), original);
  if (changes.length === 0) return false;
  split.a.dispatch({ changes });
  return true;
}
