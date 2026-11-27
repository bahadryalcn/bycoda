/**
 * Very long soft-wrapped lines can leave CodeMirror's caret outside the visible viewport.
 * Switch to the native field before the editor starts estimating gaps within the line.
 */
export const INLINE_LINE_LIMIT = 16_000;

/** A draft that left the editor returns once every line is well below the limit again. */
export const INLINE_LINE_REARM = 8_000;

/** True when some line holds at least `limit` characters. */
export function hasLongLine(text: string, limit: number) {
  if (text.length < limit) return false;
  let run = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 10 || code === 13) run = 0;
    else if (++run >= limit) return true;
  }
  return false;
}

/**
 * Whether the draft belongs in the native field. `demoted` is the previous answer: the editor
 * leaves at the limit and returns only below the rearm length, so a draft hovering around the
 * limit does not swap surfaces on every keystroke.
 */
export function keepsNativeField(text: string, demoted: boolean) {
  return hasLongLine(text, demoted ? INLINE_LINE_REARM : INLINE_LINE_LIMIT);
}
