const EVENT_MARKER = /[ \t]*<!--\s*assistant-event:[^>]*-->/g;

/**
 * Removes the `<!-- assistant-event:<id> -->` dedupe markers that the Host appends to
 * daily notes. Storage keeps them; display surfaces call this before showing note text.
 */
export function stripAssistantEventMarkers(text: string): string {
  return text.replace(EVENT_MARKER, "");
}
