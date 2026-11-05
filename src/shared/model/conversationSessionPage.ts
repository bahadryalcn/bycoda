export type ConversationSessionSummary = {
  id: string;
  title: string;
  busy: boolean;
  lastActivityAt?: number | null;
  updatedAt?: number | null;
};

/** Bound before link resolution or serialization. Unknown activity stays unknown. */
export function conversationSessionPage<T extends ConversationSessionSummary>(
  sessions: T[],
  input: Record<string, unknown>,
) {
  const limit = input.limit ?? 30;
  const state = input.state ?? "all";
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100)
    throw new Error("Session limit must be between 1 and 100.");
  if (!["all", "running", "idle"].includes(String(state)))
    throw new Error("Invalid session state filter.");
  if (
    input.cursor !== undefined &&
    (typeof input.cursor !== "string" || !input.cursor || input.cursor.length > 300)
  )
    throw new Error("Invalid session cursor.");
  const rows = sessions
    .filter((session) => state === "all" || session.busy === (state === "running"))
    .sort(
      (a, b) =>
        (b.lastActivityAt ?? b.updatedAt ?? 0) - (a.lastActivityAt ?? a.updatedAt ?? 0) ||
        a.id.localeCompare(b.id),
    );
  const previous =
    input.cursor === undefined ? -1 : rows.findIndex((row) => row.id === input.cursor);
  if (input.cursor !== undefined && previous < 0)
    throw new Error("Session cursor changed; restart the list.");
  const page = rows.slice(previous + 1, previous + 1 + Number(limit));
  return {
    sessions: page,
    total: rows.length,
    nextCursor: previous + 1 + page.length < rows.length ? page[page.length - 1]!.id : null,
    state,
  };
}
