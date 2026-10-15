import {
  closeLeaf,
  focusedFileTab,
  firstLeafId,
  leaf,
  leafIds,
  movePane,
  newEditorPane,
  placeLayout,
  placePane,
  replacePaneWithLayout,
  replaceLeafId,
  selectPaneTab,
  splitPane,
  type PaneEdge,
  type PaneTabDropPosition,
  type WorkspaceTab,
} from "./layout";
import { layoutFromLeafIds } from "./layoutPresets";
import { projectName } from "../../../shared/lib/paths";
import { isRemoteProjectPath, sameProjectPath } from "../../projects/model/recents";
import { sessionWorkCwd, type Session } from "../../sessions/model/session";

export function workspaceTabCwd(
  tab: WorkspaceTab,
  sessions: readonly Pick<Session, "id" | "cwd">[],
): string | null {
  for (const id of leafIds(tab.layout)) {
    const session = sessions.find((entry) => entry.id === id);
    if (session?.cwd && session.cwd !== "~") return session.cwd;
  }

  const file = focusedFileTab(tab);
  if (file?.external) return null;
  const cwd = file?.projectCwd ?? file?.cwd;
  if (cwd && cwd !== "~") return cwd;

  return null;
}

/** Working copy a tab runs in: its first session's worktree, else the folder
 * its focused file was opened from. Null when the tab has neither. */
export function workspaceTabWorktree(
  tab: WorkspaceTab,
  sessions: readonly Pick<Session, "id" | "cwd" | "worktreeCwd">[],
): string | null {
  for (const id of leafIds(tab.layout)) {
    const session = sessions.find((entry) => entry.id === id);
    if (session?.cwd && session.cwd !== "~") return sessionWorkCwd(session);
  }
  const file = focusedFileTab(tab);
  const cwd = file?.external ? null : file?.cwd;
  return cwd && cwd !== "~" ? cwd : null;
}

/** Tabs without a working copy show in every worktree. */
export function tabInWorktree(
  tab: WorkspaceTab,
  sessions: readonly Pick<Session, "id" | "cwd" | "worktreeCwd">[],
  worktree: string,
): boolean {
  const cwd = workspaceTabWorktree(tab, sessions);
  return !cwd || sameProjectPath(cwd, worktree);
}

/** Whether a tab is saved for the next launch. The app reopens each project
 * on its default workspace, so tabs of other worktrees close with it, unless
 * closing one would orphan an unsent draft or queued message. */
export function keepsWorkspaceTab(
  tab: WorkspaceTab,
  sessions: readonly Pick<Session, "id" | "cwd">[],
  workspace: string | null,
  hasUnsentWork: (sessionId: string) => boolean,
): boolean {
  const project = workspaceTabCwd(tab, sessions);
  if (!project || isRemoteProjectPath(project)) return true;
  if (!workspace || sameProjectPath(workspace, project)) return true;
  return leafIds(tab.layout).some(hasUnsentWork);
}

export function focusedWorkspaceTabCwd(
  tab: WorkspaceTab,
  sessions: readonly Pick<Session, "id" | "cwd">[],
): string | null {
  const session = sessions.find((entry) => entry.id === tab.focusedId);
  const file = focusedFileTab(tab);
  if (!session && file?.external) return workspaceTabCwd(tab, sessions);
  return session?.cwd ?? file?.projectCwd ?? file?.cwd ?? workspaceTabCwd(tab, sessions);
}

/** Standalone documents stay visible beside the selected project's tabs. */
export function isExternalFileWorkspaceTab(tab: WorkspaceTab): boolean {
  return (
    tab.editorPanes.length > 0 &&
    (tab.terminalPanes ?? []).length === 0 &&
    leafIds(tab.layout).every((id) => tab.editorPanes.some((pane) => pane.id === id)) &&
    tab.editorPanes.every((pane) => pane.files.length > 0 && pane.files.every((file) => file.external))
  );
}

export function workspaceTabProject(tab: WorkspaceTab, sessions: Session[]): string | null {
  const cwd = workspaceTabCwd(tab, sessions);
  if (!cwd) return null;
  const name = projectName(cwd);
  return name === "~" ? null : name;
}

export function findTabForProject(
  tabs: WorkspaceTab[],
  sessions: Session[],
  path: string,
): WorkspaceTab | undefined {
  return tabs.find((tab) => {
    const cwd = workspaceTabCwd(tab, sessions);
    return cwd ? sameProjectPath(cwd, path) : false;
  });
}

/** A tab is only openable as a chat when its session object is also mounted. */
export function findOpenSessionTab(
  tabs: readonly WorkspaceTab[],
  sessions: readonly Pick<Session, "id">[],
  sessionId: string,
): WorkspaceTab | undefined {
  if (!sessions.some((session) => session.id === sessionId)) return undefined;
  return tabs.find((tab) => leafIds(tab.layout).includes(sessionId));
}

/** Show another session in the focused pane without changing the active tab. */
export function switchSessionInTab(
  tabs: readonly WorkspaceTab[],
  activeTabId: string,
  currentSessionId: string,
  targetSessionId: string,
): WorkspaceTab[] | null {
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  if (!activeTab || activeTab.diffFocused) return null;
  if (activeTab.focusedId !== currentSessionId) return null;
  if (!leafIds(activeTab.layout).includes(currentSessionId)) return null;
  if (currentSessionId === targetSessionId) return null;

  const targetTab = tabs.find((tab) => leafIds(tab.layout).includes(targetSessionId));
  if (targetTab?.id === activeTabId) {
    return tabs.map((tab) =>
      tab.id === activeTabId ? { ...tab, focusedId: targetSessionId, diffFocused: false } : tab,
    );
  }

  return tabs.map((tab) => {
    if (tab.id === activeTabId) {
      return {
        ...tab,
        layout: replaceLeafId(tab.layout, currentSessionId, targetSessionId),
        focusedId: targetSessionId,
        diffFocused: false,
      };
    }
    if (tab.id === targetTab?.id) {
      return {
        ...tab,
        layout: replaceLeafId(tab.layout, targetSessionId, currentSessionId),
        focusedId: tab.focusedId === targetSessionId ? currentSessionId : tab.focusedId,
      };
    }
    return tab;
  });
}

/** Add a chat beside a file-only tab so an add-to-chat request has a target. */
export function openAddToChatSessionPane({
  tab,
  sessions,
  sessionId,
}: {
  tab: WorkspaceTab;
  sessions: readonly Pick<Session, "id">[];
  sessionId: string;
}): WorkspaceTab | null {
  const paneIds = leafIds(tab.layout);
  const sessionIds = new Set(sessions.map((session) => session.id));
  if (paneIds.some((id) => sessionIds.has(id))) return null;

  const sourceId = paneIds.includes(tab.focusedId) ? tab.focusedId : firstLeafId(tab.layout);
  return {
    ...tab,
    layout: splitPane(tab.layout, sourceId, "right", sessionId),
    focusedId: sessionId,
    diffFocused: false,
  };
}

export function filterTabsForProject(
  tabs: WorkspaceTab[],
  sessions: Session[],
  path: string,
): WorkspaceTab[] {
  return tabs.filter((tab) => {
    const cwd = workspaceTabCwd(tab, sessions);
    return cwd ? sameProjectPath(cwd, path) : false;
  });
}

export type WorkspaceTabCloseScope = "project" | "workspace";

export type WorkspaceTabClosePlan =
  | { action: "keep" }
  | { action: "close"; nextActiveTabId?: string };

export function planWorkspaceTabClose({
  tabs,
  sessions,
  closingTabId,
  scope,
  worktreeOf,
}: {
  tabs: WorkspaceTab[];
  sessions: Session[];
  closingTabId: string;
  scope: WorkspaceTabCloseScope;
  /** When given, the next tab also has to share the closing tab's worktree,
   * so closing a tab never leaves the worktree on screen. */
  worktreeOf?: (tab: WorkspaceTab) => string | null;
}): WorkspaceTabClosePlan {
  const closingIndex = tabs.findIndex((tab) => tab.id === closingTabId);
  if (closingIndex < 0) return { action: "keep" };

  const remaining = tabs.filter((tab) => tab.id !== closingTabId);
  if (remaining.length === 0) return { action: "keep" };

  const globalTarget = remaining[Math.max(0, closingIndex - 1)] ?? remaining[0];
  if (scope === "workspace") {
    return { action: "close", nextActiveTabId: globalTarget?.id };
  }

  const closingCwd = workspaceTabCwd(tabs[closingIndex], sessions);
  if (!closingCwd) {
    return { action: "close", nextActiveTabId: globalTarget?.id };
  }
  const closingWorktree = worktreeOf?.(tabs[closingIndex]) ?? null;
  const sameScope = (tab: WorkspaceTab) => {
    const cwd = workspaceTabCwd(tab, sessions);
    if (!cwd || !sameProjectPath(cwd, closingCwd)) return false;
    const worktree = closingWorktree && worktreeOf?.(tab);
    return !worktree || sameProjectPath(worktree, closingWorktree);
  };

  for (let index = closingIndex - 1; index >= 0; index -= 1) {
    if (sameScope(tabs[index])) {
      return { action: "close", nextActiveTabId: tabs[index].id };
    }
  }

  for (let index = closingIndex + 1; index < tabs.length; index += 1) {
    if (sameScope(tabs[index])) {
      return { action: "close", nextActiveTabId: tabs[index].id };
    }
  }

  // Deck mode is one project (and worktree) at a time. Closing the last tab
  // there must not jump to another one's tab; the caller keeps this one.
  return { action: "keep" };
}

/**
 * Drop a session onto a pane edge in the tab that owns `targetId`.
 * Already-open chats move; a blank target is replaced; a chat open
 * in another tab is relocated (that tab closes when it was the last leaf).
 */
export function applyPlaceSessionOnPane({
  tabs,
  sessions,
  sessionId,
  targetId,
  edge,
  tabPosition,
  replaceTarget,
  scope,
  worktreeOf,
  createReplacement,
}: {
  tabs: WorkspaceTab[];
  sessions: Session[];
  sessionId: string;
  targetId: string;
  edge: PaneEdge;
  tabPosition?: PaneTabDropPosition;
  replaceTarget: boolean;
  scope: WorkspaceTabCloseScope;
  /** When given, the tab that takes over also has to share the closing
   * tab's worktree. */
  worktreeOf?: (tab: WorkspaceTab) => string | null;
  createReplacement: (seed: Session | undefined) => Session;
}): {
  tabs: WorkspaceTab[];
  sessions: Session[];
  activeTabId: string;
} | null {
  if (sessionId === targetId) return null;
  const targetIndex = tabs.findIndex((tab) => leafIds(tab.layout).includes(targetId));
  if (targetIndex < 0) return null;

  let nextSessions = replaceTarget
    ? sessions.filter((session) => session.id !== targetId)
    : sessions;
  const targetTabId = tabs[targetIndex]!.id;

  let nextTabs = tabs.map((tab, index) => {
    if (index !== targetIndex) return tab;
    const layout = replaceTarget
      ? replaceLeafId(tab.layout, targetId, sessionId)
      : placePane(tab.layout, sessionId, targetId, edge, tabPosition);
    return { ...tab, layout, focusedId: sessionId, diffFocused: false };
  });

  for (const tab of [...nextTabs]) {
    if (tab.id === targetTabId) continue;
    if (!leafIds(tab.layout).includes(sessionId)) continue;
    const tabIndex = nextTabs.findIndex((entry) => entry.id === tab.id);
    if (tabIndex < 0) continue;

    const closed = closeLeaf(tab, sessionId);
    if (closed) {
      nextTabs[tabIndex] = closed;
      continue;
    }

    const closePlan = planWorkspaceTabClose({
      tabs: nextTabs,
      sessions: nextSessions,
      closingTabId: tab.id,
      scope,
      worktreeOf,
    });
    if (closePlan.action === "close") {
      nextTabs = nextTabs.filter((entry) => entry.id !== tab.id);
      continue;
    }

    const replacement = createReplacement(nextSessions.find((session) => session.id === sessionId));
    nextSessions = [...nextSessions, replacement];
    nextTabs[tabIndex] = {
      ...tab,
      layout: leaf(replacement.id),
      focusedId: replacement.id,
      editorPanes: [],
      terminalPanes: [],
      diffOpen: false,
      diffFocused: false,
    };
  }

  return { tabs: nextTabs, sessions: nextSessions, activeTabId: targetTabId };
}

/**
 * Drop a complete workspace tab onto a pane edge. Its split tree and surface
 * panes move together, and the source title tab is removed.
 */
export function applyPlaceTabOnPane({
  tabs,
  sessions,
  sourceTabId,
  targetId,
  edge,
  tabPosition,
  replaceTarget,
}: {
  tabs: WorkspaceTab[];
  sessions: Session[];
  sourceTabId: string;
  targetId: string;
  edge: PaneEdge;
  tabPosition?: PaneTabDropPosition;
  replaceTarget: boolean;
}): {
  tabs: WorkspaceTab[];
  sessions: Session[];
  activeTabId: string;
  focusedId: string;
} | null {
  const source = tabs.find((tab) => tab.id === sourceTabId);
  const target = tabs.find((tab) => leafIds(tab.layout).includes(targetId));
  if (!source || !target || source.id === target.id) return null;

  const targetIds = new Set(leafIds(target.layout));
  if (leafIds(source.layout).some((id) => targetIds.has(id))) return null;

  const layout = replaceTarget
    ? replacePaneWithLayout(target.layout, targetId, source.layout)
    : placeLayout(target.layout, source.layout, targetId, edge, tabPosition);
  const merged: WorkspaceTab = {
    ...target,
    layout,
    focusedId: source.focusedId,
    editorPanes: [...target.editorPanes, ...source.editorPanes],
    terminalPanes: [...(target.terminalPanes ?? []), ...(source.terminalPanes ?? [])],
    diffFocused: false,
  };
  const nextTabs = tabs
    .filter((tab) => tab.id !== source.id)
    .map((tab) => (tab.id === target.id ? merged : tab));
  const nextSessions = replaceTarget
    ? sessions.filter((session) => session.id !== targetId)
    : sessions;

  return {
    tabs: nextTabs,
    sessions: nextSessions,
    activeTabId: target.id,
    focusedId: source.focusedId,
  };
}

/** Move one existing pane without recreating its session or surface metadata. */
export function applyMovePaneBetweenTabs({
  tabs,
  fromId,
  toId,
  edge,
  tabPosition,
}: {
  tabs: WorkspaceTab[];
  fromId: string;
  toId: string;
  edge: PaneEdge;
  tabPosition?: PaneTabDropPosition;
}): { tabs: WorkspaceTab[]; activeTabId: string; focusedId: string } | null {
  if (fromId === toId) return null;
  const source = tabs.find((tab) => leafIds(tab.layout).includes(fromId));
  const target = tabs.find((tab) => leafIds(tab.layout).includes(toId));
  if (!source || !target) return null;
  if (source.id === target.id) {
    const layout = movePane(source.layout, fromId, toId, edge, tabPosition);
    return {
      tabs: tabs.map((tab) => (tab.id === source.id ? { ...tab, layout, focusedId: fromId } : tab)),
      activeTabId: target.id,
      focusedId: fromId,
    };
  }
  const remaining = closeLeaf(source, fromId);
  const nextSource = remaining && {
    ...remaining,
    editorPanes: source.editorPanes.filter((pane) => pane.id !== fromId),
    terminalPanes: (source.terminalPanes ?? []).filter((pane) => pane.id !== fromId),
  };
  const editorPane = source.editorPanes.find((pane) => pane.id === fromId);
  const terminalPane = (source.terminalPanes ?? []).find((pane) => pane.id === fromId);
  const nextTarget: WorkspaceTab = {
    ...target,
    layout: placePane(target.layout, fromId, toId, edge, tabPosition),
    focusedId: fromId,
    editorPanes: editorPane ? [...target.editorPanes, editorPane] : target.editorPanes,
    terminalPanes: terminalPane
      ? [...(target.terminalPanes ?? []), terminalPane]
      : target.terminalPanes,
    diffFocused: false,
  };
  return {
    tabs: tabs.flatMap((tab) =>
      tab.id === source.id
        ? nextSource
          ? [nextSource]
          : []
        : [tab.id === target.id ? nextTarget : tab],
    ),
    activeTabId: target.id,
    focusedId: fromId,
  };
}

/** Move a saved editor tab into another editor group or a new adjacent group. */
export function applyMoveFileBetweenPanes({
  tabs,
  fileId,
  targetPaneId,
  edge = "center",
  targetFileId,
  position = "after",
  createPaneId = () => crypto.randomUUID(),
}: {
  tabs: WorkspaceTab[];
  fileId: string;
  targetPaneId: string;
  edge?: PaneEdge;
  targetFileId?: string;
  position?: PaneTabDropPosition;
  createPaneId?: () => string;
}): { tabs: WorkspaceTab[]; activeTabId: string; focusedId: string } | null {
  const sourceTab = tabs.find((tab) =>
    tab.editorPanes.some((pane) => pane.files.some((file) => file.id === fileId)),
  );
  const sourcePane = sourceTab?.editorPanes.find((pane) =>
    pane.files.some((file) => file.id === fileId),
  );
  const targetTab = tabs.find((tab) => leafIds(tab.layout).includes(targetPaneId));
  const file = sourcePane?.files.find((entry) => entry.id === fileId);
  if (!sourceTab || !sourcePane || !targetTab || !file || file.terminal) return null;
  const existingTarget =
    edge === "center" ? targetTab.editorPanes.find((pane) => pane.id === targetPaneId) : undefined;
  if (sourcePane.id === existingTarget?.id) return null;
  const nextPaneId = existingTarget?.id ?? createPaneId();
  const sourceIndex = sourcePane.files.findIndex((entry) => entry.id === fileId);
  const remainingFiles = sourcePane.files.filter((entry) => entry.id !== fileId);
  const sourceActive =
    sourcePane.activeFileId === fileId
      ? (remainingFiles[Math.min(sourceIndex, remainingFiles.length - 1)]?.id ?? "")
      : sourcePane.activeFileId;
  const targetFiles = existingTarget?.files ?? [];
  const targetIndex = targetFiles.findIndex((entry) => entry.id === targetFileId);
  const insertion =
    targetIndex < 0 ? targetFiles.length : targetIndex + (position === "after" ? 1 : 0);
  const nextPane = existingTarget
    ? {
        ...existingTarget,
        files: [...targetFiles.slice(0, insertion), file, ...targetFiles.slice(insertion)],
        activeFileId: fileId,
      }
    : { ...newEditorPane(file), id: nextPaneId };
  const updated = tabs.map((tab) => {
    let next = tab;
    if (tab.id === targetTab.id) {
      next = {
        ...next,
        layout: existingTarget
          ? selectPaneTab(next.layout, nextPaneId)
          : placePane(next.layout, nextPaneId, targetPaneId, edge, position),
        focusedId: nextPaneId,
        editorPanes: existingTarget
          ? next.editorPanes.map((pane) => (pane.id === nextPaneId ? nextPane : pane))
          : [...next.editorPanes, nextPane],
        diffFocused: false,
      };
    }
    if (tab.id === sourceTab.id) {
      next = {
        ...next,
        editorPanes: next.editorPanes.flatMap((pane) =>
          pane.id !== sourcePane.id
            ? [pane]
            : remainingFiles.length
              ? [{ ...pane, files: remainingFiles, activeFileId: sourceActive }]
              : [],
        ),
      };
      if (!remainingFiles.length) return closeLeaf(next, sourcePane.id);
    }
    return next;
  });
  return {
    tabs: updated.filter((tab): tab is WorkspaceTab => !!tab),
    activeTabId: targetTab.id,
    focusedId: nextPaneId,
  };
}

/** Most sessions "Open Side by Side" will put into one tab. */
export const SIDE_BY_SIDE_LIMIT = 9;

/**
 * Build one grid tab holding `sessionIds`. Chats already open in another tab
 * move here, like dropping a session card onto a pane edge; a tab left without
 * panes disappears. `tabs` in the result excludes the new tab so the caller
 * decides where it is inserted.
 */
export function planOpenSessionsSideBySide({
  tabs,
  sessionIds,
  createTabId = () => crypto.randomUUID(),
}: {
  tabs: WorkspaceTab[];
  sessionIds: readonly string[];
  createTabId?: () => string;
}): { tabs: WorkspaceTab[]; tab: WorkspaceTab } | null {
  const ids = [...new Set(sessionIds)].slice(0, SIDE_BY_SIDE_LIMIT);
  if (ids.length < 2) return null;

  const remaining: WorkspaceTab[] = [];
  for (const source of tabs) {
    let next: WorkspaceTab | null = source;
    for (const id of ids) {
      if (next && leafIds(next.layout).includes(id)) {
        next = closeLeaf(next, id);
      }
    }
    if (next) remaining.push(next);
  }

  return {
    tabs: remaining,
    tab: {
      kind: "session",
      id: createTabId(),
      layout: layoutFromLeafIds(ids, "grid"),
      focusedId: ids[0],
      editorPanes: [],
      terminalPanes: [],
    },
  };
}

/**
 * Extract one leaf from a split workspace and turn it into a title tab.
 * Surface pane metadata moves with editor and terminal leaves.
 */
export function applyDetachPaneToTab({
  tabs,
  paneId,
  targetTabId,
  position,
  createTabId = () => crypto.randomUUID(),
}: {
  tabs: WorkspaceTab[];
  paneId: string;
  targetTabId: string;
  position: "before" | "after";
  createTabId?: () => string;
}): {
  tabs: WorkspaceTab[];
  activeTabId: string;
  focusedId: string;
} | null {
  const sourceIndex = tabs.findIndex((tab) => leafIds(tab.layout).includes(paneId));
  if (sourceIndex < 0 || leafIds(tabs[sourceIndex]!.layout).length < 2) {
    return null;
  }

  const source = tabs[sourceIndex]!;
  const remaining = closeLeaf(source, paneId);
  if (!remaining) return null;

  const editorPane = source.editorPanes.find((pane) => pane.id === paneId);
  const terminalPane = (source.terminalPanes ?? []).find((pane) => pane.id === paneId);
  const nextSource: WorkspaceTab = {
    ...remaining,
    editorPanes: source.editorPanes.filter((pane) => pane.id !== paneId),
    terminalPanes: (source.terminalPanes ?? []).filter((pane) => pane.id !== paneId),
  };
  const withoutDetached = tabs.map((tab, index) => (index === sourceIndex ? nextSource : tab));
  const targetIndex = withoutDetached.findIndex((tab) => tab.id === targetTabId);
  if (targetIndex < 0) return null;

  const insertAt = targetIndex + (position === "after" ? 1 : 0);
  const keepsSourceGroup =
    !!source.groupId &&
    (withoutDetached[insertAt - 1]?.groupId === source.groupId ||
      withoutDetached[insertAt]?.groupId === source.groupId);
  const detached: WorkspaceTab = {
    kind: "session",
    id: createTabId(),
    layout: leaf(paneId),
    focusedId: paneId,
    editorPanes: editorPane ? [editorPane] : [],
    terminalPanes: terminalPane ? [terminalPane] : [],
    diffOpen: false,
    diffFocused: false,
    ...(keepsSourceGroup ? { groupId: source.groupId } : {}),
  };
  const nextTabs = withoutDetached.slice();
  nextTabs.splice(insertAt, 0, detached);
  return { tabs: nextTabs, activeTabId: detached.id, focusedId: paneId };
}

export function isGroupableProject(project: string | null): project is string {
  return !!project && project !== "~";
}

export function replaceGroupInTabOrder(
  allIds: string[],
  startIndex: number,
  length: number,
  newGroupIds: string[],
): string[] {
  const next = allIds.slice();
  next.splice(startIndex, length, ...newGroupIds);
  return next;
}
