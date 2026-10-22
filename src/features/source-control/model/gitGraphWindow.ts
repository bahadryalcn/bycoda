export type VisibleRange = {
  /** First rendered row. */
  start: number;
  /** One past the last rendered row. */
  end: number;
  /** Height of the spacer standing in for the rows above `start`. */
  padTop: number;
  /** Height of the spacer standing in for the rows from `end` on. */
  padBottom: number;
};

/**
 * Rows to mount for a fixed-height list: those intersecting the viewport plus
 * `overscan` on each side. The spacers keep the scroll height unchanged.
 */
export function visibleRange(
  scrollTop: number,
  viewportHeight: number,
  rowCount: number,
  rowHeight: number,
  overscan: number,
): VisibleRange {
  if (rowCount <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  }
  // A stale scrollTop (the list just shrank) must still land on real rows.
  const maxTop = Math.max(0, rowCount * rowHeight - viewportHeight);
  const top = Math.min(maxTop, Math.max(0, scrollTop));
  const first = Math.floor(top / rowHeight);
  const last = Math.ceil((top + Math.max(0, viewportHeight)) / rowHeight);
  const start = Math.min(rowCount, Math.max(0, first - overscan));
  const end = Math.min(rowCount, Math.max(start, last + overscan));
  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: (rowCount - end) * rowHeight,
  };
}
