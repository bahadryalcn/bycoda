import { normalizeSelectedText } from "./quoteDraft";

const pending = new Map<string, string>();
const listeners = new Map<string, (text: string) => boolean>();
const MAX_SELECTION = 32_768;

/** Explicitly shares a selection with one composer, including while that pane mounts. */
export function requestSessionQuote(sessionId: string, text: string): void {
  const selection = normalizeSelectedText(text);
  if (!selection) return;
  const previous = pending.get(sessionId);
  // An SSH excerpt is literal text, including links that look like internal citations.
  const literal = selection.replace(/\]\(bycoda-citation:/g, "]\\(bycoda-citation:");
  const current = previous ? `${previous}\n\n${literal}` : literal;
  if (current.length > MAX_SELECTION) throw new Error("Select a shorter terminal excerpt.");
  if (listeners.get(sessionId)?.(current)) pending.delete(sessionId);
  else pending.set(sessionId, current);
}

export function receiveSessionQuotes(sessionId: string, receive: (text: string) => boolean) {
  listeners.set(sessionId, receive);
  flushSessionQuotes(sessionId);
  return () => {
    if (listeners.get(sessionId) === receive) listeners.delete(sessionId);
  };
}

export function flushSessionQuotes(sessionId: string): void {
  const text = pending.get(sessionId);
  if (text && listeners.get(sessionId)?.(text)) pending.delete(sessionId);
}
