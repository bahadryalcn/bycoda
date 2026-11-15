import type { HostSessionSummary } from "../../src/features/connections/model/protocol";

const RECENT_MS = 12 * 60 * 60_000;
const MAX_ROWS = 10;
/** Allowlisted metadata only. Never spread a summary into a push provider payload. */
export function widgetPushPayload(sessions: readonly HostSessionSummary[], now: number) {
  const rows = sessions
    .filter(
      (s) =>
        !s.archived &&
        !s.draft &&
        !s.delegationParent &&
        (s.status !== "idle" ||
          s.needsInput ||
          s.issue === "failed" ||
          Number.isFinite(s.widgetContext?.completedAt)),
    )
    .map((s) => ({
      id: s.id,
      projectId: s.projectId,
      kind: s.needsInput
        ? "question"
        : s.issue === "failed" || s.status === "interrupted"
          ? "failed"
          : s.status === "running"
            ? "running"
            : "done",
      status: s.status,
      updatedAt: s.updatedAt,
    }))
    .filter((s) => s.kind === "running" || s.kind === "question" || now - s.updatedAt <= RECENT_MS);
  const rank: Record<string, number> = { question: 0, failed: 1, running: 2, done: 3 };
  rows.sort(
    (a, b) => rank[a.kind] - rank[b.kind] || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
  );
  const counts = { running: 0, needsInput: 0, failed: 0 };
  for (const row of rows) {
    if (row.kind === "question") counts.needsInput++;
    else if (row.kind === "failed") counts.failed++;
    else if (row.kind === "running") counts.running++;
  }
  // IDs are bounded too, keeping the complete Expo envelope below the 4 KB provider limit.
  const selected = rows
    .slice(0, MAX_ROWS)
    .filter((row) => row.id.length <= 100 && row.projectId.length <= 100);
  while (Buffer.byteLength(JSON.stringify(selected), "utf8") > 2600) selected.pop();
  return { v: 1, at: now, counts, complete: selected.length === rows.length, sessions: selected };
}

/** Timing alone must not trigger pushes. Polling coalesces transitions within each four-second tick. */
export function widgetPushIdentity(payload: ReturnType<typeof widgetPushPayload>): string {
  return JSON.stringify({
    counts: payload.counts,
    complete: payload.complete,
    sessions: payload.sessions.map(({ updatedAt: _updatedAt, ...row }) => row),
  });
}
