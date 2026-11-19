import type { SelectionGeometry } from "./selectionGeometry";

export const SELECTABLE_AGENT_RESPONSE_ATTR = "data-selectable-agent-response";

/** Read from the live response only when an action needs it, never on every selection change. */
export type TranscriptSelectionSource = {
  /** Non-overlapping matches of the selected text before it, as `selectedTextOffset` expects. */
  occurrence: number;
  responseText: string;
};

export type TranscriptSelection = {
  text: string;
  rect: DOMRect;
  /**
   * Re-reads the selection's position from its live range. Returns null once the selected text
   * is gone. Without it the captured `rect` goes stale on scroll, so the menu dismisses instead.
   */
  measure?: () => SelectionGeometry | null;
  /**
   * Reads the occurrence and response text from the live range. Null once the selected text is
   * gone. Live state never holds these, so response text is not copied on every selection change.
   */
  resolveSource?: () => TranscriptSelectionSource | null;
  responseId?: string;
  /** Set only on a copy from `resolveTranscriptSelection`, which an action keeps. */
  occurrence?: number;
  /** Set only on a copy from `resolveTranscriptSelection`, which an action keeps. */
  responseText?: string;
};

export type TranscriptSelectionCandidate = {
  text: string;
  collapsed: boolean;
  anchorResponseId: string | null;
  focusResponseId: string | null;
};

export function validateTranscriptSelection(
  candidate: TranscriptSelectionCandidate,
): string | null {
  const text = candidate.text.trim();
  if (!text || candidate.collapsed) return null;
  if (!candidate.anchorResponseId || !candidate.focusResponseId) return null;
  if (candidate.anchorResponseId !== candidate.focusResponseId) return null;
  return text;
}

/**
 * Index of the selected match among non-overlapping matches of `text` in `before`, the text
 * preceding it. Same walk as `selectedTextOffset`, so the pair round-trips.
 */
export function selectedOccurrence(before: string, text: string): number {
  // shortcut: a non-empty text is guaranteed by validateTranscriptSelection; an empty needle would loop forever.
  if (!text) return 0;
  let count = 0;
  for (
    let index = before.indexOf(text);
    index >= 0;
    index = before.indexOf(text, index + text.length)
  )
    count += 1;
  return count;
}

/**
 * Copies the selection with its occurrence and response text read now. Null when the selected
 * text is gone, so the action refuses instead of acting on a stale location.
 */
export function resolveTranscriptSelection(
  selection: TranscriptSelection,
): TranscriptSelection | null {
  if (!selection.resolveSource) return selection;
  const source = selection.resolveSource();
  return source ? { ...selection, ...source } : null;
}
