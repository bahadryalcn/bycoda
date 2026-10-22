import type { EditorView } from "@codemirror/view";

/** Line anchors per conflict: [start, end) line numbers. Context between conflicts
 * is shared text, so piecewise-linear mapping keeps matching conflicts aligned. */
export type ConflictRange = { from: number; to: number };
type Pane = { view: EditorView; ranges: () => readonly ConflictRange[] };

const INPUT_WINDOW_MS = 800;

export function conflictAnchors(view: EditorView, ranges: readonly ConflictRange[]) {
  const doc = view.state.doc;
  const anchors = [1];
  for (const { from, to } of ranges) {
    const start = doc.lineAt(Math.min(from, doc.length)).number;
    const end =
      from === to ? start : doc.lineAt(Math.min(Math.max(from, to - 1), doc.length)).number + 1;
    anchors.push(start, end);
  }
  anchors.push(doc.lines + 1);
  return anchors;
}

/** Maps a fractional line between two anchor lists of equal length. */
export function mapLine(line: number, from: readonly number[], to: readonly number[]) {
  if (from.length !== to.length || from.length < 2) {
    const ratio = (line - 1) / Math.max(1, from[from.length - 1] - 1);
    return 1 + ratio * (to[to.length - 1] - 1);
  }
  for (let i = 0; i < from.length - 1; i++) {
    if (line < from[i + 1] || i === from.length - 2) {
      const span = from[i + 1] - from[i];
      const ratio = span > 0 ? Math.min(1, Math.max(0, (line - from[i]) / span)) : 0;
      return to[i] + ratio * (to[i + 1] - to[i]);
    }
  }
  return line;
}

function topLine(view: EditorView) {
  const scroller = view.scrollDOM;
  const documentTop = view.documentTop - scroller.getBoundingClientRect().top + scroller.scrollTop;
  const height = Math.max(0, scroller.scrollTop - documentTop);
  const block = view.lineBlockAtHeight(height);
  const line = view.state.doc.lineAt(block.from).number;
  return line + (block.height > 0 ? Math.min(1, (height - block.top) / block.height) : 0);
}

function scrollToLine(view: EditorView, line: number) {
  const doc = view.state.doc;
  const whole = Math.min(doc.lines, Math.max(1, Math.floor(line)));
  const block = view.lineBlockAt(doc.line(whole).from);
  const scroller = view.scrollDOM;
  const documentTop = view.documentTop - scroller.getBoundingClientRect().top + scroller.scrollTop;
  scroller.scrollTop = documentTop + block.top + Math.min(1, line - whole) * block.height;
}

/** Follows only the pane the user is driving, so programmatic scrolls (including the
 * followers' own) never feed back into the group. */
export class ConflictScrollSync {
  enabled = true;
  private panes = new Map<string, Pane>();
  private leader: string | null = null;
  private leaderUntil = 0;
  private holding = false;

  register(key: string, view: EditorView, ranges: () => readonly ConflictRange[]) {
    const pane = { view, ranges };
    this.panes.set(key, pane);
    const scroller = view.scrollDOM;
    const lead = () => {
      this.leader = key;
      this.leaderUntil = Date.now() + INPUT_WINDOW_MS;
    };
    const press = () => {
      lead();
      this.holding = true;
    };
    const release = () => {
      this.holding = false;
      if (this.leader === key) this.leaderUntil = Date.now() + INPUT_WINDOW_MS;
    };
    const scroll = () => {
      if (this.leader !== key || (!this.holding && Date.now() > this.leaderUntil)) return;
      this.follow(key);
    };
    scroller.addEventListener("wheel", lead, { passive: true });
    scroller.addEventListener("touchstart", press, { passive: true });
    scroller.addEventListener("pointerdown", press);
    scroller.addEventListener("keydown", lead);
    scroller.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("pointerup", release);
    window.addEventListener("touchend", release);
    return () => {
      if (this.panes.get(key) === pane) this.panes.delete(key);
      scroller.removeEventListener("wheel", lead);
      scroller.removeEventListener("touchstart", press);
      scroller.removeEventListener("pointerdown", press);
      scroller.removeEventListener("keydown", lead);
      scroller.removeEventListener("scroll", scroll);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("touchend", release);
    };
  }

  follow(key: string) {
    const leader = this.panes.get(key);
    if (!this.enabled || !leader) return;
    const line = topLine(leader.view);
    const from = conflictAnchors(leader.view, leader.ranges());
    for (const [other, pane] of this.panes) {
      // Hidden panes (Result only layout) have no geometry to align.
      if (other === key || !pane.view.scrollDOM.offsetParent) continue;
      scrollToLine(pane.view, mapLine(line, from, conflictAnchors(pane.view, pane.ranges())));
    }
  }
}
