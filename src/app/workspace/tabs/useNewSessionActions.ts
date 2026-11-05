import {
  reserveSessionWindow,
  remoteSessionOwnershipKey,
} from "../../model/sessionWindowOwnership";
import { message } from "@tauri-apps/plugin-dialog";
import { appName } from "../../../shared/lib/appName";
import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { NEW_LOCAL_HOST_SESSION } from "../../../features/connections/model/newLocalHostSession";
import { leafIds, newTab, type WorkspaceTab } from "../../../features/workspace/model/layout";
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
import { resolveRemoteSessionTarget } from "../../../features/connections/model/remoteSessionNavigation";
import { remoteCreateShellFor } from "../../../features/connections/model/remoteCreateIntent";
import {
  worktreeFocus,
  type WorktreeFocus,
} from "../../../features/source-control/model/worktreeFocus";
import { inboxComposerCard, type InboxItem } from "../../../features/inbox/model/githubTasks";
import { inboxTrackerDescription } from "../../../features/inbox/model/inboxContext";
import { linkedWorkItemFromInboxItem } from "../../../features/sessions/model/sessionWorkItem";
import { looksLikeProject, sameProjectPath } from "../../../features/projects/model/recents";
import { type NoteComposerCard } from "../../../features/notes";
import { type SidebarTabId } from "../../../features/settings/model/appearance";
import { isProjectLockedIn, type LockSnapshot } from "../../../features/group-lock/model/lockState";
import { pathKey } from "../../../shared/lib/paths";

export function canCreateListedSession(
  project: string,
  allowed: ReadonlySet<string>,
  lock: LockSnapshot,
): boolean {
  return allowed.has(pathKey(project)) && !isProjectLockedIn(lock, project);
}

/** A global row may identify an adopted local shell or an unopened remote session. */
export function listedRemoteSessionId(
  sessions: readonly Session[],
  project: string,
  listedId: string,
): string {
  const shell = sessions.find(
    (session) => session.id === listedId && sameProjectPath(session.cwd, project),
  );
  return (shell && remoteSessionFor(shell.id)) || listedId;
}

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
  workspaceNavigation: { cancel: () => void; captureRequest?: () => () => boolean };
  activateTab: (id: string, paneId?: string) => void;
  appendTab: (tab: WorkspaceTab, cwd?: string) => void;
  followProject: (cwd: string | null | undefined) => void;
}

export interface NewSessionActions {
  createWorkspaceTab: (cwd: string, focus?: WorktreeFocus) => string;
  onNewSession: (sourceSessionId?: string, options?: NewSessionOptions) => string;
  onNew: () => string;
  onNewSessionForProject: (project: string) => string;
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

  useEffect(() => {
    const open = (event: Event) => {
      const session = (event as CustomEvent<Session>).detail;
      if (!session?.hostBinding || sessionsRef.current.some((entry) => entry.id === session.id))
        return;
      const tab = newTab(session.id);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setServersViewOpen?.(false);
      setSessions((previous) => [...previous, session]);
      appendTab(tab, session.cwd);
      setActiveTabId(tab.id);
      followProject(session.cwd);
      setComposerFocused(true);
    };
    window.addEventListener(NEW_LOCAL_HOST_SESSION, open);
    return () => window.removeEventListener(NEW_LOCAL_HOST_SESSION, open);
  }, [appendTab, followProject, setActiveTabId, setSessions]);

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

  const onNewSessionForProject = useCallback(
    (project: string) => {
      workspaceNavigation.cancel();
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setServersViewOpen?.(false);
      const session = newWorkspaceSession(
        project,
        sessionDefaults?.runtimeMode,
        worktreeFocus(project),
      );
      const tab = newTab(session.id);
      setSessions((previous) => [...previous, session]);
      appendTab(tab, project);
      setActiveTabId(tab.id);
      followProject(project);
      setComposerFocused(true);
      return session.id;
    },
    [appendTab, followProject, sessionDefaults?.runtimeMode, workspaceNavigation.cancel],
  );

  const onSelectRemoteSession = useCallback(
    async (project: string, remoteSessionId: string, options?: { preview?: boolean }) => {
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setServersViewOpen?.(false);
      workspaceNavigation.cancel();
      // The same Host session has one owner even when listed under another project path.
      const requestedKey = remoteSessionOwnershipKey(project, remoteSessionId);
      const ownedTab = tabsRef.current
        .flatMap((tab) => leafIds(tab.layout).map((id) => ({ tab, id })))
        .find(({ id }) => {
          const candidate = sessionsRef.current.find((session) => session.id === id);
          const remoteId = remoteSessionFor(id);
          if (!candidate || !remoteId) return false;
          try {
            return remoteSessionOwnershipKey(candidate.cwd, remoteId) === requestedKey;
          } catch {
            return false;
          }
        });
      if (ownedTab) {
        if (!options?.preview)
          setTabs((tabs) =>
            tabs.map((tab) => (tab.id === ownedTab.tab.id ? keepSessionTab(tab) : tab)),
          );
        activateTab(ownedTab.tab.id, ownedTab.id);
        return;
      }
      // A session still being created by an open tab is that tab's, not a new one.
      const existing = resolveRemoteSessionTarget(
        tabsRef.current,
        sessionsRef.current,
        project,
        remoteSessionId,
        remoteSessionFor,
        remoteCreateShellFor,
      );
      if (existing) {
        if (!options?.preview)
          setTabs((tabs) =>
            tabs.map((tab) => (tab.id === existing.tab.id ? keepSessionTab(tab) : tab)),
          );
        activateTab(existing.tab.id, existing.shellId);
        return;
      }
      const current = workspaceNavigation.captureRequest?.() ?? (() => true);
      let release: Awaited<ReturnType<typeof reserveSessionWindow>>;
      try {
        release = await reserveSessionWindow([requestedKey]);
      } catch (error) {
        await message(String(error), { title: appName(), kind: "warning" });
        return;
      }
      if (!release) return;
      let retained = false;
      try {
        if (!current()) return;
        // Recheck after async ownership admission; another local open may have won.
        const already = resolveRemoteSessionTarget(
          tabsRef.current,
          sessionsRef.current,
          project,
          remoteSessionId,
          remoteSessionFor,
          remoteCreateShellFor,
        );
        if (already) {
          activateTab(already.tab.id, already.shellId);
          retained = true;
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
        retained = true;
      } finally {
        await release(retained).catch((error) =>
          console.error("Conversation ownership release failed", error),
        );
      }
    },
    [
      activateTab,
      appendTab,
      followProject,
      sessionDefaults?.runtimeMode,
      setActiveTabId,
      workspaceNavigation.cancel,
      workspaceNavigation.captureRequest,
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
    onNewSessionForProject,
    onSelectRemoteSession,
    onStartInboxItem,
    onAddNoteToChat,
  };
}
