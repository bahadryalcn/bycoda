import { useEffect, useLayoutEffect, useRef } from "react";
import { remotePendingWorktree, remoteSessionFor } from "../../../features/connections/model/connections";
import { composerDraftsLoaded } from "../../../features/sessions/data/composerDraftStore";
import { listSessionsByProject } from "../../../features/sessions/data/sessionStore";
import { hasUnsentComposerDraft } from "../../../features/sessions/model/draftCache";
import type { Session } from "../../../features/sessions/model/session";
import {
  emptyForeignTabIds,
  unlistedTabIds,
} from "../../../features/workspace/model/idleTabs";
import { leafIds, type WorkspaceTab } from "../../../features/workspace/model/layout";
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
 * One cleanup pass. A candidate must pass the local emptiness rules and must
 * also be absent from its project's saved conversation list (which holds only
 * sessions with a user message). Any failed listing aborts the pass, because
 * an unreadable list cannot prove a chat was never used.
 */
async function closeForeignEmptyTabs(read: () => ForeignEmptyTabsInput): Promise<void> {
  const first = read();
  if (!composerDraftsLoaded() || first.movingTabIds.size > 0) return;
  const tabById = new Map(first.tabs.map((tab) => [tab.id, tab]));
  const candidates = emptyForeignTabIds(
    { ...first, hasComposerDraft: hasUnsentComposerDraft },
    first.projectCwd,
  ).filter((id) => {
    const tab = tabById.get(id);
    return (
      tab !== undefined &&
      !leafIds(tab.layout).some((sessionId) => remoteSessionFor(sessionId) || remotePendingWorktree(sessionId))
    );
  });
  if (candidates.length === 0) return;

  const projects = new Set<string>();
  for (const id of candidates) {
    const cwd = workspaceTabCwd(tabById.get(id)!, first.sessions);
    if (cwd) projects.add(cwd);
  }
  const listed = new Set<string>();
  try {
    for (const project of projects) {
      for (const row of await listSessionsByProject(project)) listed.add(row.id);
    }
  } catch {
    return;
  }
  const confirmed = unlistedTabIds(candidates, first.tabs, listed);
  if (confirmed.length === 0) return;

  // The awaits may have spanned an edit or a switch, so decide again on the current state.
  const now = read();
  if (now.movingTabIds.size > 0) return;
  const still = new Set(
    emptyForeignTabIds({ ...now, hasComposerDraft: hasUnsentComposerDraft }, now.projectCwd),
  );
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
