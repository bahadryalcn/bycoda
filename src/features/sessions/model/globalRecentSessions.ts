import { pathKey } from "../../../shared/lib/paths";
import { isUserConversation } from "../../../shared/model/host-contracts/delegation";
import { sessionActivityAt } from "./sessionActivity";
import { sessionNeedsInput, type Session } from "./session";
import { sessionIssue } from "./sessionIssue";
import { summaryFromSession } from "../data/sessionHistory";
import type { SessionSummary } from "../data/sessionStore";

export const GLOBAL_RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function identity(row: { cwd: string; id: string }): string {
  return JSON.stringify([pathKey(row.cwd), row.id]);
}

/**
 * Merge, filter and order every known row, independent of the clock: the seven-day cutoff is
 * applied separately by `withinGlobalRecentWindow`, so a tick never repeats this merge.
 * The caller supplies all known projects which pass its current privacy gates.
 */
export function mergeGlobalRecentSessions(
  stored: readonly SessionSummary[],
  history: readonly SessionSummary[],
  sessions: readonly Session[],
  allowedProjectKeys: ReadonlySet<string>,
): SessionSummary[] {
  const rows = new Map<string, SessionSummary>();
  const workerKeys = new Set(
    [...stored, ...history].flatMap((row) =>
      (row.orchestration?.tasks ?? []).map((task) =>
        identity({ cwd: row.cwd, id: task.sessionId }),
      ),
    ),
  );
  for (const row of [...stored, ...history]) {
    if (!isUserConversation(row)) continue;
    if (!allowedProjectKeys.has(pathKey(row.cwd))) continue;
    const key = identity(row);
    const previous = rows.get(key);
    if (!previous || row.updatedAt >= previous.updatedAt) rows.set(key, { ...previous, ...row });
  }
  for (const session of sessions) {
    if (!allowedProjectKeys.has(pathKey(session.cwd))) continue;
    const key = identity(session);
    if (
      session.inboxAsk ||
      session.orchestrationLeadId ||
      workerKeys.has(key) ||
      !isUserConversation(session)
    ) {
      rows.delete(key);
      continue;
    }
    const storedRow = rows.get(key);
    const sent = session.blocks.some((block) => block.role === "user" && !block.draft);
    if (!storedRow && !sent && !session.busy && !sessionNeedsInput(session)) continue;
    const live = summaryFromSession(session);
    rows.set(key, {
      ...live,
      ...storedRow,
      title: session.title,
      model: session.model,
      worktreeCwd: session.worktreeCwd ?? storedRow?.worktreeCwd,
      worktreeRemoved: session.worktreeRemoved ?? storedRow?.worktreeRemoved,
      branch: session.worktreeRemoved ? undefined : (session.branch ?? storedRow?.branch),
      issue: sessionIssue(session),
      interrupted:
        session.historyPartial || session.historyLoading
          ? storedRow?.interrupted
          : live.interrupted,
      draft: live.draft,
      // `live.providerHistory` already is `sessionProviderHistory(session)`; do not scan twice.
      providerHistory:
        session.historyPartial || session.historyLoading
          ? (storedRow?.providerHistory ?? live.providerHistory)
          : live.providerHistory,
      lastActivityAt: Math.max(
        storedRow?.lastActivityAt ?? storedRow?.updatedAt ?? 0,
        sessionActivityAt(session),
      ),
    });
  }
  return [...rows.values()]
    .filter((row) => !row.archived && !row.orchestrationLeadId && !workerKeys.has(identity(row)))
    .sort(
      (a, b) =>
        (b.lastActivityAt ?? b.updatedAt) - (a.lastActivityAt ?? a.updatedAt) ||
        identity(a).localeCompare(identity(b)),
    );
}

/** Keep the rows active within the window ending at `now`; the order is preserved. */
export function withinGlobalRecentWindow(
  rows: readonly SessionSummary[],
  now: number,
): SessionSummary[] {
  const cutoff = now - GLOBAL_RECENT_WINDOW_MS;
  return rows.filter((row) => (row.lastActivityAt ?? row.updatedAt) >= cutoff);
}

export function buildGlobalRecentSessions(
  stored: readonly SessionSummary[],
  history: readonly SessionSummary[],
  sessions: readonly Session[],
  allowedProjectKeys: ReadonlySet<string>,
  now: number,
): SessionSummary[] {
  return withinGlobalRecentWindow(
    mergeGlobalRecentSessions(stored, history, sessions, allowedProjectKeys),
    now,
  );
}
