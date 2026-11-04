import type { Session } from "../../features/sessions/model/session";
import type { SessionRecovery } from "../../features/workspace/model/sessionRecovery";
import { collectWorkspaceSnapshot } from "../../features/workspace/model/workspaceSnapshot";
import { newTab } from "../../features/workspace/model/layout";
import { isRemoteProjectPath, sameProjectPath } from "../../features/projects/model/recents";

export type RetirementCandidates = {
  sessions: { sessionId: string; cwd: string }[];
  pending: boolean;
  receipt?: string | null;
};

function validate(value: RetirementCandidates): RetirementCandidates {
  if (
    !value ||
    typeof value.pending !== "boolean" ||
    (value.receipt != null && typeof value.receipt !== "string") ||
    !Array.isArray(value.sessions) ||
    value.sessions.some(
      (row) =>
        !row || typeof row.sessionId !== "string" || !row.sessionId || typeof row.cwd !== "string",
    )
  )
    throw new Error("Invalid conversation retirement response");
  return value;
}

/** Native proves physical retirement; this read only adds recovery references.
 * Recheck after loading so a new owner cannot be mistaken for an interrupted turn.
 * Never consume source rows or write a transcript during this refresh.
 */
export async function collectRetiredSessionRecovery(options: {
  read: () => Promise<RetirementCandidates>;
  load: (id: string) => Promise<Session | null>;
  current: () => SessionRecovery | null;
  isLocked: (cwd: string) => boolean;
}) {
  const first = validate(await options.read());
  const previous = options.current();
  const known = new Set([
    ...(previous?.workspace.sessions.map((session) => session.id) ?? []),
    ...(previous?.resolvedIds ?? []),
  ]);
  const candidates = first.sessions.filter(
    (row) =>
      !known.has(row.sessionId) && !options.isLocked(row.cwd) && !isRemoteProjectPath(row.cwd),
  );
  if (!candidates.length)
    return {
      workspace: null,
      pending: first.pending,
      ...(first.receipt ? { receipt: first.receipt } : {}),
    };
  const sessions: Session[] = [];
  // Keep full transcript hydration bounded for recovery after a large workspace crash.
  for (let offset = 0; offset < candidates.length; offset += 8) {
    const loaded = await Promise.all(
      candidates.slice(offset, offset + 8).map(async (row) => {
        const session = await options.load(row.sessionId);
        if (!session) throw new Error("An interrupted conversation could not be loaded");
        return sameProjectPath(session.cwd, row.cwd) ? session : null;
      }),
    );
    sessions.push(...loaded.filter((session): session is Session => !!session));
  }
  const latest = validate(await options.read());
  const confirmed = new Map(latest.sessions.map((row) => [row.sessionId, row.cwd]));
  const eligible = sessions.filter(
    (session) =>
      confirmed.has(session.id) &&
      sameProjectPath(confirmed.get(session.id)!, session.cwd) &&
      !options.isLocked(session.cwd) &&
      !session.inboxAsk &&
      !session.orchestrationLeadId,
  );
  const tabs = eligible.map((session) => newTab(session.id));
  return {
    pending: latest.pending,
    ...(latest.receipt ? { receipt: latest.receipt } : {}),
    workspace: eligible.length
      ? collectWorkspaceSnapshot(tabs, eligible, tabs[0].id, eligible[0].cwd, new Map())
      : null,
  };
}
