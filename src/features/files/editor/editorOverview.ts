import { getChunks, type Chunk, type MergeView } from "@codemirror/merge";
import { StateEffect, type EditorState, type Extension, type Text } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { conflictBlocks } from "./editorConflicts";
import { gitChunks } from "./editorGit";
import type { RulerMark } from "./overviewRuler";
import { OverviewRuler, scrollbarGutter } from "./overviewRulerView";

/**
 * Where the changes are, on the strip next to the scrollbar: hunks against the
 * diff base (added, modified, deleted) and unresolved conflict blocks. Marks
 * come from the editor's own line blocks, so wrapping, folds and the deleted
 * chunk widgets are part of the geometry.
 */

type Block = { top: number; bottom: number };
type BlockAt = (pos: number) => Block;

/** Offset of the last line a range touches (`end` excludes the line break). */
function lastLinePos(doc: Text, from: number, end: number) {
  return Math.max(from, Math.min(end, doc.length) - 1);
}

/** Hunks of the inline layout. A deletion has no lines here: a point mark. */
export function inlineChunkMarks(
  doc: Text,
  chunks: readonly Chunk[],
  blockAt: BlockAt,
): RulerMark[] {
  const marks: RulerMark[] = [];
  for (const chunk of chunks) {
    const insertion = chunk.fromB !== chunk.toB;
    const deletion = chunk.fromA !== chunk.toA;
    if (!insertion && !deletion) continue;
    const from = Math.min(Math.max(0, chunk.fromB), doc.length);
    const first = blockAt(from);
    const last = insertion ? blockAt(lastLinePos(doc, from, chunk.endB)) : first;
    marks.push({
      kind: insertion ? (deletion ? "mod" : "add") : "del",
      top: first.top,
      bottom: Math.max(first.top, last.bottom),
      pos: from,
    });
  }
  return marks;
}

export function conflictMarks(state: EditorState, blockAt: BlockAt): RulerMark[] {
  const doc = state.doc;
  return conflictBlocks(state).map((block) => {
    const from = Math.min(block.from, doc.length);
    const first = blockAt(from);
    const last = blockAt(lastLinePos(doc, from, block.to));
    return {
      kind: "conflict",
      top: first.top,
      bottom: Math.max(first.top, last.bottom),
      pos: from,
    };
  });
}

/**
 * Hunks of the side-by-side layout. The panes are aligned with spacers, so a
 * hunk occupies the same rows on both sides: a mark spans whichever side has
 * lines. Block functions return pixels in the shared scroller. `pos` is the
 * mark's middle, in the same pixels.
 */
export function splitChunkMarks(
  chunks: readonly Chunk[],
  docA: Text,
  docB: Text,
  blockA: BlockAt,
  blockB: BlockAt,
): RulerMark[] {
  const marks: RulerMark[] = [];
  for (const chunk of chunks) {
    const inA = chunk.fromA !== chunk.toA;
    const inB = chunk.fromB !== chunk.toB;
    if (!inA && !inB) continue;
    let top = Infinity;
    let bottom = -Infinity;
    const take = (first: Block, last: Block) => {
      top = Math.min(top, first.top);
      bottom = Math.max(bottom, last.bottom);
    };
    if (inA) {
      const from = Math.min(chunk.fromA, docA.length);
      take(blockA(from), blockA(lastLinePos(docA, from, chunk.endA)));
    }
    if (inB) {
      const from = Math.min(chunk.fromB, docB.length);
      take(blockB(from), blockB(lastLinePos(docB, from, chunk.endB)));
    }
    marks.push({
      kind: inA && inB ? "mod" : inB ? "add" : "del",
      top,
      bottom: Math.max(top, bottom),
      pos: (top + bottom) / 2,
    });
  }
  return marks;
}

/** Marks for one editor, in its scroller's content pixels. */
function editorMarks(view: EditorView): RulerMark[] {
  const pad = view.documentPadding.top;
  const blockAt: BlockAt = (pos) => {
    const block = view.lineBlockAt(pos);
    return { top: block.top + pad, bottom: block.bottom + pad };
  };
  const marks = [
    ...inlineChunkMarks(view.state.doc, gitChunks(view.state), blockAt),
    ...conflictMarks(view.state, blockAt),
  ];
  return marks.sort((a, b) => a.top - b.top);
}

function marksChanged(update: ViewUpdate) {
  return (
    update.docChanged ||
    update.geometryChanged ||
    gitChunks(update.state) !== gitChunks(update.startState) ||
    getChunks(update.state)?.chunks !== getChunks(update.startState)?.chunks
  );
}

const overviewPlugin = ViewPlugin.fromClass(
  class {
    readonly ruler: OverviewRuler;

    constructor(readonly view: EditorView) {
      const scroller = view.scrollDOM;
      this.ruler = new OverviewRuler(
        {
          marks: () => editorMarks(view),
          geometry: () => ({
            contentHeight: scroller.scrollHeight,
            viewportHeight: scroller.clientHeight,
            scrollTop: scroller.scrollTop,
          }),
          scrollTo: (top) => {
            scroller.scrollTop = top;
          },
          reveal: (pos) => revealPos(view, pos),
        },
        {
          // The editor's own rail owns the strip: it draws the thumb and takes
          // the presses, so this only paints ticks across it.
          interactive: false,
          band: false,
          padLeft: 3,
          padRight: 2,
          beforeDraw: () => {
            // The search panel pushes the scroller down; follow it like the rail.
            this.ruler.dom.style.top = `${scroller.offsetTop}px`;
            this.ruler.dom.style.height = `${scroller.offsetHeight}px`;
            this.ruler.dom.style.bottom = "auto";
          },
        },
      );
      const style = this.ruler.dom.style;
      style.right = "0";
      style.width = "var(--editor-scrollbar-width, 18px)";
      style.zIndex = "13";
      view.dom.appendChild(this.ruler.dom);
      scroller.addEventListener("scroll", this.onScroll, { passive: true });
      this.ruler.invalidate();
    }

    update(update: ViewUpdate) {
      if (marksChanged(update)) this.ruler.invalidate();
    }

    destroy() {
      this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
      this.ruler.destroy();
    }

    private readonly onScroll = () => this.ruler.schedule();
  },
);

function revealPos(view: EditorView, pos: number) {
  view.dispatch({
    effects: EditorView.scrollIntoView(Math.min(pos, view.state.doc.length), {
      y: "center",
    }),
  });
}

/**
 * Scrolls to the change drawn under a press on the strip. False when there is
 * none, so the scrollbar rail can treat the press as a plain track press.
 */
export function revealOverviewTick(view: EditorView, clientY: number): boolean {
  const tick = view.plugin(overviewPlugin)?.ruler.tickAt(clientY);
  if (!tick) return false;
  revealPos(view, tick.pos);
  return true;
}

export const editorOverview: Extension = overviewPlugin;

/**
 * The same marks for the side-by-side layout, on one strip beside the native
 * scrollbar of `split.dom` (the pair scrolls as a whole). The host element
 * must be positioned. Returns a cleanup function.
 */
export function attachSplitOverview(split: MergeView): () => void {
  const scroller = split.dom;
  const host = scroller.parentElement;
  if (!host) return () => {};
  const content = (view: EditorView): BlockAt => {
    // Pixels in the shared scroller, from live rects so a scroll of the pair
    // cancels out.
    const origin =
      view.contentDOM.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop +
      view.documentPadding.top;
    return (pos) => {
      const block = view.lineBlockAt(pos);
      return { top: block.top + origin, bottom: block.bottom + origin };
    };
  };
  const ruler = new OverviewRuler(
    {
      marks: () => {
        const chunks = getChunks(split.b.state)?.chunks ?? [];
        return splitChunkMarks(
          chunks,
          split.a.state.doc,
          split.b.state.doc,
          content(split.a),
          content(split.b),
        ).sort((a, b) => a.top - b.top);
      },
      geometry: () => ({
        contentHeight: scroller.scrollHeight,
        viewportHeight: scroller.clientHeight,
        scrollTop: scroller.scrollTop,
      }),
      scrollTo: (top) => {
        scroller.scrollTop = top;
      },
      reveal: (y) => {
        scroller.scrollTop = Math.max(0, y - scroller.clientHeight / 2);
      },
    },
    {
      interactive: true,
      band: true,
      beforeDraw: () => {
        // Sits left of the native scrollbar and never over it.
        ruler.dom.style.right = `${scrollbarGutter(scroller)}px`;
        ruler.dom.style.top = `${scroller.offsetTop}px`;
      },
    },
  );
  const style = ruler.dom.style;
  style.width = "10px";
  style.zIndex = "30";
  host.appendChild(ruler.dom);

  const onScroll = () => ruler.schedule();
  scroller.addEventListener("scroll", onScroll, { passive: true });
  const invalidate = EditorView.updateListener.of((update) => {
    if (marksChanged(update)) ruler.invalidate();
  });
  for (const view of [split.a, split.b]) {
    view.dispatch({ effects: StateEffect.appendConfig.of(invalidate) });
  }
  ruler.invalidate();
  return () => {
    scroller.removeEventListener("scroll", onScroll);
    ruler.destroy();
  };
}
