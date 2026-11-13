/** Bounded owner history request; omitted pagination keeps the existing default view. */
export function crewHistoryQuery(
  input: Record<string, unknown>,
): { cursor?: string; limit: number } | undefined {
  if (input.historyLimit === undefined && input.historyCursor === undefined) return undefined;
  const limit = Number(input.historyLimit);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (input.historyCursor !== undefined &&
      (typeof input.historyCursor !== "string" || input.historyCursor.length > 1024))
  )
    throw new Error("Provide bounded Crew history pagination");
  return { cursor: input.historyCursor as string | undefined, limit };
}
