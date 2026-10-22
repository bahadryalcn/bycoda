/**
 * Pure maths of the overview ruler: the strip beside a scrollbar that maps the
 * whole scrollable height onto the visible track and marks where the changes
 * are. Everything here is in pixels; callers supply real geometry (editor line
 * blocks, diff row offsets), never line-number ratios.
 */

export type RulerKind = "add" | "del" | "mod" | "conflict";

export type RulerMark = {
  kind: RulerKind;
  /** Scroll-content pixels, `top <= bottom`. */
  top: number;
  bottom: number;
  /** What the owner needs to reveal this mark (a document offset or a y). */
  pos: number;
};

/** A mark scaled onto the track; same shape, track pixels. */
export type RulerSpan = RulerMark;

export const RULER_MIN_SPAN = 3;
/** A span taller than this is a region, not a target: a press there drags. */
export const RULER_SNAP_MAX = 14;

const MERGE_GAP = 1;

/**
 * Scales marks onto a track of `trackHeight` pixels. Every span is at least
 * `minSpan` tall, and spans of one kind that touch or overlap are merged into
 * one (keeping the first one's `pos`), so thousands of changed lines cost one
 * rectangle per visible run.
 */
export function buildRulerSpans(
  marks: readonly RulerMark[],
  contentHeight: number,
  trackHeight: number,
  minSpan = RULER_MIN_SPAN,
): RulerSpan[] {
  if (!(contentHeight > 0) || !(trackHeight > 0) || marks.length === 0) {
    return [];
  }
  const scale = trackHeight / contentHeight;
  const scaled: RulerSpan[] = [];
  let sorted = true;
  for (const mark of marks) {
    let top = Math.min(trackHeight, Math.max(0, mark.top * scale));
    let bottom = Math.max(top + minSpan, mark.bottom * scale);
    if (bottom > trackHeight) {
      bottom = trackHeight;
      top = Math.max(0, bottom - minSpan);
    }
    if (sorted && scaled.length > 0 && top < scaled[scaled.length - 1].top) {
      sorted = false;
    }
    scaled.push({ kind: mark.kind, top, bottom, pos: mark.pos });
  }
  if (!sorted) scaled.sort((a, b) => a.top - b.top);

  const out: RulerSpan[] = [];
  const open = new Map<RulerKind, RulerSpan>();
  for (const span of scaled) {
    const current = open.get(span.kind);
    if (current && span.top <= current.bottom + MERGE_GAP) {
      current.bottom = Math.max(current.bottom, span.bottom);
    } else {
      out.push(span);
      open.set(span.kind, span);
    }
  }
  return out;
}

/** The scroll-content y that a pointer at `y` on the track stands for. */
export function trackToContentY(y: number, trackHeight: number, contentHeight: number): number {
  if (!(trackHeight > 0)) return 0;
  return Math.min(1, Math.max(0, y / trackHeight)) * Math.max(0, contentHeight);
}

/** The scrollTop that puts content y `contentY` in the middle of the viewport. */
export function scrollTopToCenter(
  contentY: number,
  contentHeight: number,
  viewportHeight: number,
): number {
  const max = Math.max(0, contentHeight - viewportHeight);
  return Math.min(max, Math.max(0, contentY - viewportHeight / 2));
}

/** The closest small span to `y` within `slop` pixels, if any. */
export function spanAtY(
  spans: readonly RulerSpan[],
  y: number,
  slop = 2,
  maxHeight = RULER_SNAP_MAX,
): RulerSpan | null {
  let best: RulerSpan | null = null;
  let bestDistance = slop + 1;
  for (const span of spans) {
    if (span.bottom - span.top > maxHeight) continue;
    const distance = y < span.top ? span.top - y : y > span.bottom ? y - span.bottom : 0;
    if (distance < bestDistance) {
      best = span;
      bestDistance = distance;
      if (distance === 0) break;
    }
  }
  return best;
}

/** The viewport as a band on the track; null when everything is visible. */
export function viewportBand(
  scrollTop: number,
  viewportHeight: number,
  contentHeight: number,
  trackHeight: number,
  minHeight = 6,
): { top: number; height: number } | null {
  if (!(trackHeight > 0) || !(viewportHeight > 0) || contentHeight <= viewportHeight) {
    return null;
  }
  const height = Math.min(
    trackHeight,
    Math.max(minHeight, (viewportHeight / contentHeight) * trackHeight),
  );
  const maxScroll = contentHeight - viewportHeight;
  const progress = Math.min(1, Math.max(0, scrollTop / maxScroll));
  return { top: progress * (trackHeight - height), height };
}
