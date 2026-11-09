/**
 * The one description/error id contract for label - control - help - error fields. Field, Input,
 * Textarea and TagInput all derive their message ids and `aria-describedby` from here, so the error
 * is described first and the help second wherever the pieces are rendered.
 */
export type FieldMessageParts = { description?: string; error?: string };

/** Ids a field owner must give its control so the error is described first and the help second. */
export function fieldMessageIds(id: string, parts: FieldMessageParts) {
  return {
    description: parts.description ? `${id}-description` : undefined,
    error: parts.error ? `${id}-error` : undefined,
  };
}

/** `aria-describedby` for a control inside a field: caller ids, then error, then help. */
export function fieldDescribedBy(id: string, parts: FieldMessageParts, extra?: string) {
  const ids = fieldMessageIds(id, parts);
  return [extra, ids.error, ids.description].filter(Boolean).join(" ") || undefined;
}
