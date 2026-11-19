import { isUserConversation } from "../../../shared/model/host-contracts/delegation";
import { closeLeaf, leafIds, type WorkspaceTab } from "./layout";
import type { WorkspaceSnapshot } from "./workspaceSnapshot";

function withoutSessionPanes(tabs: WorkspaceTab[], hidden: ReadonlySet<string>): WorkspaceTab[] {
  let changed = false;
  const next = tabs.flatMap((tab) => {
    const ids = leafIds(tab.layout).filter((id) => hidden.has(id));
    if (!ids.length) return [tab];
    changed = true;
    const remaining = ids.reduce<WorkspaceTab | null>(
      (value, id) => value && closeLeaf(value, id),
      tab,
    );
    return remaining ? [remaining] : [];
  });
  return changed ? next : tabs;
}

/** Presentation only: canonical child sessions and their running work remain intact. */
export function withoutDelegatedTabs(
  tabs: WorkspaceTab[],
  sessions: readonly { id: string; modelSettings?: Record<string, string> }[],
): WorkspaceTab[] {
  return withoutHiddenSessionTabs(tabs, delegatedSessionIds(sessions));
}

/** The ids of sessions that are not user conversations (advisor, subagent and similar children). */
export function delegatedSessionIds(
  sessions: readonly { id: string; modelSettings?: Record<string, string> }[],
): string[] {
  return sessions.filter((session) => !isUserConversation(session)).map((session) => session.id);
}

/** `withoutDelegatedTabs` for a caller that already projected the hidden ids. */
export function withoutHiddenSessionTabs(
  tabs: WorkspaceTab[],
  hiddenIds: readonly string[],
): WorkspaceTab[] {
  return withoutSessionPanes(tabs, new Set(hiddenIds));
}

/** Covers legacy workspace snapshots as well as newly collected layouts. */
export function withoutInternalWorkspaceSessions(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const sessions = snapshot.sessions.filter(
    (session) => !session.inboxAsk && isUserConversation(session),
  );
  if (sessions.length === snapshot.sessions.length) return snapshot;
  const visible = new Set(sessions.map((session) => session.id));
  const hidden = new Set(
    snapshot.sessions.filter((session) => !visible.has(session.id)).map((session) => session.id),
  );
  const tabs = withoutSessionPanes(snapshot.tabs, hidden);
  return {
    ...snapshot,
    tabs,
    sessions,
    activeTabId: tabs.some((tab) => tab.id === snapshot.activeTabId)
      ? snapshot.activeTabId
      : (tabs[0]?.id ?? ""),
  };
}
