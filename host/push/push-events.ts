import type { HostSessionSummary } from "../../src/features/connections/model/protocol";

/** The moments that reach a phone; the desktop uses the same three. */
export type PushEventKind = "finished" | "input" | "failed";

export const PUSH_EVENT_KINDS: readonly PushEventKind[] = ["finished", "input", "failed"];

export type PushEvent = { kind: PushEventKind; sessionId: string; projectId: string };

export type SessionPushState = {
  status: HostSessionSummary["status"];
  needsInput: boolean;
  failedTurn?: string;
};

export type PushSnapshot = Map<string, SessionPushState>;

/** Delegated children, drafts and archived rows never notify, as on the desktop. */
function notifies(session: HostSessionSummary): boolean {
  return !session.delegationParent && !session.draft && !session.archived;
}

function stateOf(session: HostSessionSummary): SessionPushState {
  return {
    status: session.status,
    needsInput: session.needsInput === true,
    ...(session.issue === "failed"
      ? { failedTurn: session.issueTurnId ?? `updated:${session.updatedAt}` }
      : {}),
  };
}

const IDLE: SessionPushState = { status: "idle", needsInput: false };

/**
 * Compares two list reads. Without a previous read the result is only a
 * baseline, so a Host restart or a new registration does not replay old state.
 * A session that appears between reads starts from idle. One read yields at
 * most one event per session: input outranks failure, failure outranks finish,
 * and a turn the user interrupted is neither.
 */
export function detectPushEvents(
  previous: PushSnapshot | undefined,
  sessions: readonly HostSessionSummary[],
): { events: PushEvent[]; next: PushSnapshot } {
  const next: PushSnapshot = new Map();
  const events: PushEvent[] = [];
  for (const session of sessions) {
    if (!notifies(session)) continue;
    const current = stateOf(session);
    next.set(session.id, current);
    if (!previous) continue;
    const before = previous.get(session.id) ?? IDLE;
    const kind: PushEventKind | undefined =
      current.needsInput && !before.needsInput
        ? "input"
        : current.failedTurn && current.failedTurn !== before.failedTurn
          ? "failed"
          : before.status === "running" && current.status === "idle" && !current.needsInput
            ? "finished"
            : undefined;
    if (kind) events.push({ kind, sessionId: session.id, projectId: session.projectId });
  }
  return { events, next };
}
