/** Public correlation data for one source-owned approval request, never authority. */
export const APPROVAL_OCCURRENCE_CAPABILITY = "sessions.approvalOccurrence.v1";
export const APPROVAL_OCCURRENCE_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/;
export function isApprovalOccurrenceId(value: unknown): value is string {
  return (
    typeof value === "string" && value.length === 36 && APPROVAL_OCCURRENCE_PATTERN.test(value)
  );
}

export function createApprovalOccurrenceId(): string {
  const value = crypto.randomUUID();
  if (!isApprovalOccurrenceId(value))
    throw new Error("Approval occurrence identity is unavailable");
  return value;
}

const issued = new WeakMap<object, string>();
/** Legacy in-process events acquire an identity once at the source reducer.
 * Reapplying that same event keeps it; a different event never inherits by ID/text. */
export function approvalOccurrenceForEvent(event: { occurrenceId?: unknown }): string {
  if (event.occurrenceId !== undefined) {
    if (!isApprovalOccurrenceId(event.occurrenceId))
      throw new Error("Invalid approval occurrence identity");
    return event.occurrenceId;
  }
  const previous = issued.get(event);
  if (previous) return previous;
  const value = createApprovalOccurrenceId();
  issued.set(event, value);
  return value;
}
