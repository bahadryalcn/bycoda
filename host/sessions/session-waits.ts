import type {
  HostSession,
  HostSessionSummary,
} from "../../src/features/connections/model/protocol";
import { sessionNeedsInput } from "../../src/features/sessions/model/session";
import {
  backgroundWait,
  delegatedWait,
  type SessionWakeSource,
} from "../../src/features/sessions/model/sessionWaitRules";

/** Summary field for a Host-run turn the agent yielded while background work still runs. */
export function hostTurnWait(
  value: Pick<HostSession, "status" | "session">,
): Pick<HostSessionSummary, "waiting"> {
  if (
    value.status !== "running" ||
    value.session.worktreeRemoved ||
    sessionNeedsInput(value.session)
  )
    return {};
  const waiting = backgroundWait(value.session);
  return waiting ? { waiting } : {};
}

/**
 * Stamps a project's list rows with their pending wake sources and, for an idle
 * parent, its running delegated children. Rows without either keep their identity.
 */
export function withSessionWaits(
  rows: readonly HostSessionSummary[],
  wakeSources: ReadonlyMap<string, readonly SessionWakeSource[]>,
): HostSessionSummary[] {
  const children = new Map<string, HostSessionSummary[]>();
  for (const row of rows) {
    const parentId = row.delegationParent?.parentSessionId;
    if (!parentId) continue;
    const list = children.get(parentId);
    if (list) list.push(row);
    else children.set(parentId, [row]);
  }
  return rows.map((row) => {
    const sources = wakeSources.get(row.id);
    const delegated =
      row.status === "running" || row.needsInput
        ? null
        : delegatedWait(
            (children.get(row.id) ?? []).map((child) => ({
              running: child.status === "running",
              startedAt: child.delegationParent?.startedAt,
            })),
          );
    if (!sources?.length && !delegated) return row;
    return {
      ...row,
      ...(delegated ? { waiting: delegated } : {}),
      ...(sources?.length ? { wakeSources: [...sources] } : {}),
    };
  });
}
