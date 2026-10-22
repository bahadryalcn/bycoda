import { useEffect, useLayoutEffect, useRef } from "react";
import { remoteShellState } from "../../../features/connections/model/remoteShellState";
import { composerDraftsLoaded } from "../../../features/sessions/data/composerDraftStore";
import { listSessionsByProject } from "../../../features/sessions/data/sessionStore";
import { hasUnsentComposerDraft } from "../../../features/sessions/model/draftCache";
import type { Session } from "../../../features/sessions/model/session";
import { isRemoteProjectPath } from "../../../features/projects/model/recents";
import {
  emptyForeignTabIds,
  unlistedTabIds,
} from "../../../features/workspace/model/idleTabs";
import { isUnsentRemoteChat } from "../../../features/workspace/model/remoteEmptyChats";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";
import { workspaceTabCwd } from "../../../features/workspace/model/workspaceTabGroups";

export type ForeignEmptyTabsInput = {
  projectCwd: string;
  tabs: readonly WorkspaceTab[];
  sessions: readonly Session[];
  activeTabId: string;
  busySessionIds: ReadonlySet<string>;
  unseenFinishedIds: ReadonlySet<string>;
  dirtyFileIds: ReadonlySet<string>;
  movingTabIds: ReadonlySet<string>;
  /** False for transfer windows: their state and drafts arrive with the payload, so no launch pass. */
  restoredWorkspace: boolean;
  onCloseTabs: (ids: string[], fallbackId: string) => void;
};

/**
 * A remote chat is unsent only when this app holds no host binding, no queued
 * command and no draft for it. Decided locally: the host keeps no record of a
 * chat that never got a turn, and a bound chat is never closed here.
 */
function remoteSessionUnsent(session: Session): boolean {
  return isUnsentRemoteChat(
    session,
    remoteShellState(session, { hasDraft: hasUnsentComposerDraft(session.id) }),
  );
}

function candidatesOf(input: ForeignEmptyTabsInput): string[] {
  return emptyForeignTabIds(
    { ...input, hasComposerDraft: hasUnsentComposerDraft },
    input.projectCwd,
    remoteSessionUnsent,
  );
}

/**
 * One cleanup pass. A local candidate must pass the local emptiness rules and
 * must also be absent from its project's saved conversation list (which holds
 * only sessions with a user message). Any failed local listing aborts the pass,
 * because an unreadable list cannot prove a chat was never used. Remote
 * candidates need no listing: their unbound state is checked locally.
 */
async function closeForeignEmptyTabs(read: () => ForeignEmptyTabsInput): Promise<void> {
  const first = read();
  if (!composerDraftsLoaded() || first.movingTabIds.size > 0) return;
  const tabById = new Map(first.tabs.map((tab) => [tab.id, tab]));
  const cwdOf = (id: string) => workspaceTabCwd(tabById.get(id)!, first.sessions) ?? "";
  const candidates = candidatesOf(first);
  if (candidates.length === 0) return;

  const localIds = candidates.filter((id) => !isRemoteProjectPath(cwdOf(id)));
  const confirmedRemote = candidates.filter((id) => isRemoteProjectPath(cwdOf(id)));

  let confirmedLocal: string[] = [];
  if (localIds.length > 0) {
    const projects = new Set(localIds.map(cwdOf).filter(Boolean));
    const listed = new Set<string>();
    try {
      for (const project of projects) {
        for (const row of await listSessionsByProject(project)) listed.add(row.id);
      }
    } catch {
      return;
    }
    confirmedLocal = unlistedTabIds(localIds, first.tabs, listed);
  }
  const confirmed = [...confirmedLocal, ...confirmedRemote];
  if (confirmed.length === 0) return;

  // The awaits may have spanned an edit or a switch, so decide again on the current state.
  const now = read();
  if (now.movingTabIds.size > 0) return;
  const still = new Set(candidatesOf(now));
  const ids = confirmed.filter((id) => still.has(id));
  if (ids.length > 0) now.onCloseTabs(ids, now.activeTabId);
}

/**
 * Closes other projects' tabs that hold only empty, never-typed chats. Runs on
 * launch of the restored window and whenever the current project changes.
 * Best effort: any doubt, such as drafts not loaded or a failed listing, keeps the tab.
 */
export function useCloseForeignEmptyTabs(input: ForeignEmptyTabsInput): void {
  const latest = useRef(input);
  const started = useRef(false);
  // Declared before the effect so it reads this commit's values.
  useLayoutEffect(() => {
    latest.current = input;
  });

  useEffect(() => {
    const launch = !started.current;
    started.current = true;
    if (launch && !latest.current.restoredWorkspace) return;
    void closeForeignEmptyTabs(() => latest.current).catch(() => undefined);
  }, [input.projectCwd]);
}
