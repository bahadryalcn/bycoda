/**
 * Decision logic for the composer's reading mode: while the reader is away from
 * the end of the transcript and not working in the composer, the writing area
 * shrinks to its content so more of the conversation is visible.
 *
 * Two independent facts decide it, each with one owner:
 * - "reading history" comes from `useTranscriptFollow`, derived from the
 *   reader's scroll intent (it stops following the end) and latched, never from
 *   geometry the composer's own resize changes;
 * - "engaged" comes from `useComposerEngagement`: focus or an interaction
 *   inside the composer, including its portalled menus.
 */

/**
 * The reader must be at least this far from the end before reading mode starts.
 * Compacting grows the transcript viewport by up to this much, so a smaller
 * distance would let the grown viewport clamp the scroll position (content
 * jumping) or put the reader back at the end. Once started the mode is latched
 * until the reader returns to the end, so the resize cannot toggle it back.
 */
export const READING_ENTER_PX = 160;

/**
 * Next latched "reading history" value. `following` is the transcript's own
 * bottom-follow intent; `distance` is the remaining scroll distance to the end.
 */
export function nextReadingHistory(
  previous: boolean,
  { following, distance }: { following: boolean; distance: number },
): boolean {
  if (following) return false;
  return previous || distance >= READING_ENTER_PX;
}

/** True when the composer should present its compact reading geometry. */
export function composerReadingActive({
  readingHistory,
  engaged,
  blocked,
}: {
  readingHistory: boolean;
  engaged: boolean;
  /** Something in the composer needs the full layout (question, edit mode…). */
  blocked: boolean;
}): boolean {
  return readingHistory && !engaged && !blocked;
}
