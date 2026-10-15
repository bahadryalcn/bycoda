import { sessionNeedsInput, type Session } from "../../sessions/model/session";
import { isTurnInterruptMessage } from "../../sessions/model/inFlight";
import { sessionIssue } from "../../sessions/model/sessionIssue";
import { closeLeaf, leafIds, type WorkspaceTab } from "./layout";
import { parseWorkspaceSnapshot, type WorkspaceSnapshot } from "./workspaceSnapshot";

export type SessionRecovery = {
  capturedAt: number;
  dismissed: boolean;
  /** Acknowledged entries stay out of recovery, without deleting history. */
  resolvedIds?: string[];
  workspace: WorkspaceSnapshot;
};

// Stored with the native workspace snapshot, never in browser preferences.
// All workspace writes (including quit) retain this journal.
let journal: SessionRecovery | null = null;
let initialized = false;
let heldIds = new Set<string>();
export function getSessionRecovery(): SessionRecovery | null {
  return journal;
}
export function hasInitializedSessionRecovery(): boolean {
  return initialized;
}
export function setSessionRecovery(value: SessionRecovery | null): void {
  journal = value;
  initialized = true;
  heldIds = new Set([
    ...(value?.workspace.sessions.map((session) => session.id) ?? []),
    ...(value?.resolvedIds ?? []),
  ]);
}
export function isRecoverySessionHeld(id: string): boolean {
  return heldIds.has(id);
}

export function parseSessionRecovery(raw: unknown): SessionRecovery | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<SessionRecovery>;
  if (typeof value.capturedAt !== "number" || !Number.isFinite(value.capturedAt)) return null;
  const workspace = parseWorkspaceSnapshot(value.workspace, true);
  return workspace
    ? {
        capturedAt: value.capturedAt,
        dismissed: value.dismissed === true,
        workspace,
        resolvedIds: Array.isArray(value.resolvedIds)
          ? value.resolvedIds.filter((id): id is string => typeof id === "string")
          : [],
      }
    : null;
}

/** Keep the original layout and closed recovery entries across another restart. */
export function captureSessionRecovery(
  previous: SessionRecovery | null,
  workspace: WorkspaceSnapshot,
  now = Date.now(),
): SessionRecovery | null {
  if (!workspace.sessions.length) return previous;
  if (!previous) return { capturedAt: now, dismissed: false, workspace };
  const known = new Set([
    ...previous.workspace.sessions.map((s) => s.id),
    ...(previous.resolvedIds ?? []),
  ]);
  const added = workspace.sessions.filter((s) => !known.has(s.id));
  if (!added.length) return previous;
  const addedIds = new Set(added.map((s) => s.id));
  const tabs = sessionRecoveryTabs(workspace.tabs, addedIds);
  const used = new Set(previous.workspace.tabs.map((tab) => tab.id));
  return {
    ...previous,
    dismissed: false,
    workspace: {
      ...previous.workspace,
      sessions: [...previous.workspace.sessions, ...added],
      tabs: [
        ...previous.workspace.tabs,
        ...tabs.map((tab) => ({ ...tab, id: used.has(tab.id) ? crypto.randomUUID() : tab.id })),
      ],
    },
  };
}

/** Remove only recovery references; history and running work remain intact. */
export function removeRecoverySessions(
  recovery: SessionRecovery,
  ids: readonly string[],
): SessionRecovery {
  const removed = new Set(ids.filter((id) => recovery.workspace.sessions.some((s) => s.id === id)));
  const sessions = recovery.workspace.sessions.filter((s) => !removed.has(s.id));
  const tabs = sessionRecoveryTabs(recovery.workspace.tabs, new Set(sessions.map((s) => s.id)));
  return {
    ...recovery,
    dismissed: sessions.length === 0 ? true : recovery.dismissed,
    resolvedIds: [...new Set([...(recovery.resolvedIds ?? []), ...removed])],
    workspace: {
      ...recovery.workspace,
      sessions,
      tabs,
      activeTabId: tabs.some((tab) => tab.id === recovery.workspace.activeTabId)
        ? recovery.workspace.activeTabId
        : (tabs[0]?.id ?? ""),
    },
  };
}

/** Only chat panes: stale terminals/editors are never recreated by recovery. */
export function sessionRecoveryTabs(
  tabs: WorkspaceTab[],
  wanted: ReadonlySet<string>,
): WorkspaceTab[] {
  return tabs.flatMap((tab) => {
    let next: WorkspaceTab | null = tab;
    for (const id of leafIds(tab.layout)) if (!wanted.has(id)) next = next && closeLeaf(next, id);
    return next ? [{ ...next, editorPanes: [], terminalPanes: [] }] : [];
  });
}

/** Move recovered chats into their old splits while retaining new work. */
export function mergeRecoveryTabs(
  current: WorkspaceTab[],
  recovered: WorkspaceTab[],
): WorkspaceTab[] {
  const ids = new Set(recovered.flatMap((tab) => leafIds(tab.layout)));
  const kept = current.flatMap((tab) => {
    let next: WorkspaceTab | null = tab;
    for (const id of leafIds(tab.layout)) if (ids.has(id)) next = next && closeLeaf(next, id);
    return next ? [next] : [];
  });
  const used = new Set(kept.map((tab) => tab.id));
  return [
    ...kept,
    ...recovered.map((tab) => ({ ...tab, id: used.has(tab.id) ? crypto.randomUUID() : tab.id })),
  ];
}

export type RecoveryStatus =
  | "working"
  | "input"
  | "interrupted"
  | "done"
  | "idle"
  | "unknown"
  | "unavailable"
  | "failed"
  | "retrying";
export function recoveryStatus(
  session: Session | undefined,
  remote: boolean,
  verified: boolean,
): RecoveryStatus {
  if (!session) return "unknown";
  if (remote && !verified) return "unknown";
  const issue = sessionIssue(session);
  if (issue) return issue;
  if (session.busy || session.continuingElsewhere) return "working";
  if (sessionNeedsInput(session)) return "input";
  // An interrupt remains meaningful through later status/metadata rows, but
  // never carries into a newer submitted user turn.
  for (let index = session.blocks.length - 1; index >= 0; index--) {
    const block = session.blocks[index];
    if (block.role === "user" && !block.draft) {
      if (session.historyLoading || session.historyLoadError) return "unknown";
      return block.durationMs !== undefined ? "done" : "unknown";
    }
    if (
      block.notice === "interrupt" ||
      (block.role === "system" && isTurnInterruptMessage(block.text))
    )
      return "interrupted";
  }
  return "idle";
}

export function recoveryNeedsAttention(status: RecoveryStatus): boolean {
  return status !== "done" && status !== "idle";
}

const recoveryOrder: RecoveryStatus[] = [
  "interrupted",
  "failed",
  "input",
  "retrying",
  "working",
  "unknown",
  "unavailable",
  "idle",
  "done",
];
export function recoveryStatusOrder(status: RecoveryStatus): number {
  return recoveryOrder.indexOf(status);
}
