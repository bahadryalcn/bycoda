import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { newTab, type WorkspaceTab } from "../../../features/workspace/model/layout";
import {
  keepSessionTab,
  openSessionPreview,
} from "../../../features/workspace/model/sessionPreview";
import { clearedWorkspaceSession, newWorkspaceSession } from "../../model/newWorkspaceSession";
import type { NewSessionOptions } from "../../../features/sessions/model/newSessionCommand";
import { newDefaultSession, type Session } from "../../../features/sessions/model/session";
import {
  rememberRemoteSession,
  remoteSessionFor,
} from "../../../features/connections/model/connections";
import { findRemoteSessionTab } from "../../../features/connections/model/remoteSessionNavigation";
import {
  worktreeFocus,
  type WorktreeFocus,
} from "../../../features/source-control/model/worktreeFocus";
import { inboxComposerCard, type InboxItem } from "../../../features/inbox/model/githubTasks";
import { inboxTrackerDescription } from "../../../features/inbox/model/inboxContext";
import { linkedWorkItemFromInboxItem } from "../../../features/sessions/model/sessionWorkItem";
import { looksLikeProject } from "../../../features/projects/model/recents";
import { type NoteComposerCard } from "../../../features/notes";
import { type SidebarTabId } from "../../../features/settings/model/appearance";

export interface NewSessionActionDeps {
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  active: Session | undefined;
  sessionDefaults: Session | undefined;
  projectCwd: string;
  sidebarCwd: string;
  sessionsRef: MutableRefObject<Session[]>;
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setSearchViewOpen: Dispatch<SetStateAction<boolean>>;
  setInboxViewOpen: Dispatch<SetStateAction<boolean>>;
  setNotesViewOpen: Dispatch<SetStateAction<boolean>>;
  setAutomationsViewOpen: Dispatch<SetStateAction<boolean>>;
  setServersViewOpen?: Dispatch<SetStateAction<boolean>>;
  setSidebarTab: (tab: SidebarTabId, project?: string) => void;
  setActiveTabId: (id: string) => void;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  workspaceNavigation: { cancel: () => void };
  activateTab: (id: string, paneId?: string) => void;
  appendTab: (tab: WorkspaceTab, cwd?: string) => void;
  followProject: (cwd: string | null | undefined) => void;
}

export interface NewSessionActions {
  createWorkspaceTab: (cwd: string, focus?: WorktreeFocus) => string;
  onNewSession: (sourceSessionId?: string, options?: NewSessionOptions) => string;
  onNew: () => string;
  onSelectRemoteSession: (
    project: string,
    remoteSessionId: string,
    options?: { preview?: boolean },
  ) => void;
  onStartInboxItem: (item: InboxItem, body?: string) => Promise<void>;
  onAddNoteToChat: (card: NoteComposerCard) => void;
}

/** Callbacks that create a session and a workspace tab for it. */
export function useNewSessionActions(deps: NewSessionActionDeps): NewSessionActions {
  const {
    setTabs,
    active,
    sessionDefaults,
    projectCwd,
    sidebarCwd,
    sessionsRef,
    tabsRef,
    setSessions,
    setSearchViewOpen,
    setInboxViewOpen,
    setNotesViewOpen,
    setAutomationsViewOpen,
    setServersViewOpen,
    setSidebarTab,
    setActiveTabId,
    setComposerFocused,
    workspaceNavigation,
    activateTab,
    appendTab,
    followProject,
  } = deps;

  const createWorkspaceTab = useCallback(
    (cwd: string, focus?: WorktreeFocus) => {
      const session = newWorkspaceSession(cwd, sessionDefaults?.runtimeMode, focus);
      const tab = newTab(session.id);
      setSessions((prev) => [...prev, session]);
      appendTab(tab, cwd);
      return tab.id;
    },
    [appendTab, sessionDefaults?.runtimeMode],
  );

  const onNewSession = useCallback(
    (sourceSessionId?: string, options?: NewSessionOptions) => {
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setServersViewOpen?.(false);
      const source = sourceSessionId
        ? sessionsRef.current.find((session) => session.id === sourceSessionId)
        : undefined;
      const cwd = source?.cwd ?? sidebarCwd;
      const focus = worktreeFocus(cwd);
      const session =
        options?.preserveSettings && source
          ? clearedWorkspaceSession(source)
          : newWorkspaceSession(cwd, sessionDefaults?.runtimeMode, focus);
      const tab = newTab(session.id);
      setSessions((prev) => [...prev, session]);
      appendTab(tab, cwd);
      setActiveTabId(tab.id);
      setComposerFocused(true);
      return session.id;
    },
    [appendTab, sessionDefaults?.runtimeMode, sidebarCwd],
  );

  const onNew = useCallback(() => onNewSession(), [onNewSession]);

  const onSelectRemoteSession = useCallback(
    (project: string, remoteSessionId: string, options?: { preview?: boolean }) => {
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setServersViewOpen?.(false);
      workspaceNavigation.cancel();
      const existing = findRemoteSessionTab(
        tabsRef.current,
        sessionsRef.current,
        project,
        remoteSessionId,
        remoteSessionFor,
      );
      if (existing) {
        if (!options?.preview)
          setTabs((tabs) =>
            tabs.map((tab) => (tab.id === existing.tab.id ? keepSessionTab(tab) : tab)),
          );
        activateTab(existing.tab.id, existing.shellId);
        return;
      }
      // Never reuse a blank remote composer: it may hold a create/upload in flight.
      const session = newDefaultSession(project, sessionDefaults?.runtimeMode);
      const replacement = options?.preview
        ? openSessionPreview(tabsRef.current, session, sessionsRef.current)
        : undefined;
      const tab = replacement?.tab ?? {
        ...newTab(session.id),
        ...(options?.preview ? { previewSessionId: session.id } : {}),
      };
      rememberRemoteSession(session.id, remoteSessionId);
      setSessions((prev) => [...prev, session]);
      if (replacement) {
        tabsRef.current = replacement.tabs;
        setTabs(replacement.tabs);
      } else appendTab(tab, project);
      setActiveTabId(tab.id);
      followProject(project);
    },
    [
      activateTab,
      appendTab,
      followProject,
      sessionDefaults?.runtimeMode,
      setActiveTabId,
      workspaceNavigation.cancel,
    ],
  );

  const onStartInboxItem = useCallback(
    async (item: InboxItem, body?: string) => {
      const start = (description?: string) => {
        setInboxViewOpen(false);
        setNotesViewOpen(false);
        setAutomationsViewOpen(false);
        setServersViewOpen?.(false);
        const cwd = item.projectPath || active?.cwd || sessionDefaults?.cwd || projectCwd;
        setSidebarTab("sessions", cwd);
        const ref =
          item.provider === "linear" || item.provider === "jira"
            ? item.identifier?.trim() || `#${item.number}`
            : `#${item.number}`;
        const linkedWorkItem = linkedWorkItemFromInboxItem(item);
        const session = {
          ...newDefaultSession(cwd, sessionDefaults?.runtimeMode),
          title: `${ref} ${item.title}`,
          inboxCard: inboxComposerCard(item, description),
          ...(linkedWorkItem ? { linkedWorkItem } : {}),
        };
        const tab = newTab(session.id);
        setSessions((prev) => [...prev, session]);
        appendTab(tab, cwd);
        setActiveTabId(tab.id);
        setComposerFocused(true);
      };

      start(await inboxTrackerDescription(item, body));
    },
    [active?.cwd, appendTab, sessionDefaults?.cwd, sessionDefaults?.runtimeMode, projectCwd],
  );

  const onAddNoteToChat = useCallback(
    (card: NoteComposerCard) => {
      if (!card.id) return;
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setServersViewOpen?.(false);
      const cwd =
        (card.sourceCwd && looksLikeProject(card.sourceCwd) ? card.sourceCwd : undefined) ||
        active?.cwd ||
        sessionDefaults?.cwd ||
        projectCwd;
      setSidebarTab("sessions", cwd);
      const title = card.title.trim();
      const session = {
        ...newDefaultSession(cwd, sessionDefaults?.runtimeMode),
        ...(title ? { title } : {}),
        noteCard: card,
      };
      const tab = newTab(session.id);
      setSessions((prev) => [...prev, session]);
      appendTab(tab, cwd);
      setActiveTabId(tab.id);
      setComposerFocused(true);
    },
    [active?.cwd, appendTab, sessionDefaults?.cwd, sessionDefaults?.runtimeMode, projectCwd],
  );

  return {
    createWorkspaceTab,
    onNewSession,
    onNew,
    onSelectRemoteSession,
    onStartInboxItem,
    onAddNoteToChat,
  };
}
