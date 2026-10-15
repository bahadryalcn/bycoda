import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { setSessions } from "../../../features/sessions/model/sessionsStore";
import { newDefaultSession, type Session } from "../../../features/sessions/model/session";
import { newTab, type WorkspaceTab } from "../../../features/workspace/model/layout";
import {
  archiveProject,
  forgetProject,
  looksLikeProject,
  normalizeProjectPath,
  rememberProject,
  sameProjectPath,
  type RecentProject,
} from "../../../features/projects/model/recents";
import { forgetProjectLocation } from "../../../features/projects/model/projectLocation";
import { loadProjectSidebarTab } from "../../../features/settings/model/projectSidebarTab";
import type { SidebarTabId } from "../../../features/settings/model/appearance";
import { t } from "../../../shared/i18n";
import { removeProjectData } from "../../../features/projects/model/projectData";
import { filterTabsForProject } from "../../../features/workspace/model/workspaceTabGroups";
import { cancelHarnessTurn, forgetHarnessSession } from "../../../integrations/harness";
import { sessionChildHarnesses } from "../../../features/sessions/model/handoff";
import { shouldPersistSession } from "../../../features/sessions/data/sessionStore";
import { rememberLoadedSession } from "../../../features/sessions/data/sessionCache";
import type { ProjectTerminalDockState } from "../terminal/useProjectTerminalDockState";

export interface ProjectRemovalRefs {
  sessionsRef: { current: Session[] };
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  activeTabIdRef: MutableRefObject<string>;
  projectCwdRef: MutableRefObject<string>;
  removingSessionIds: MutableRefObject<Set<string>>;
  loadedSessionCache: MutableRefObject<Map<string, Session>>;
  sessionLoads: MutableRefObject<Map<string, Promise<Session | null>>>;
  pendingPersist: MutableRefObject<Map<string, Session>>;
  lastPersisted: MutableRefObject<Map<string, string>>;
  turnGen: MutableRefObject<Map<string, number>>;
}

export interface ProjectRemovalDeps {
  refs: ProjectRemovalRefs;
  activeTabId: string;
  invalidateLoadedSession: (sessionId: string) => void;
  persistSession: (session: Session | undefined) => void;
  onSelectProject: (path: string) => void;
  setRecents: Dispatch<SetStateAction<RecentProject[]>>;
  setSidebarTabSelection: Dispatch<SetStateAction<{ project: string; tab: SidebarTabId }>>;
  setSessions: typeof setSessions;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  setActiveTabId: (id: string) => void;
  setProjectCwd: Dispatch<SetStateAction<string>>;
  setDirtyFiles: Dispatch<SetStateAction<Set<string>>>;
  setProjectTerminals: ProjectTerminalDockState["setProjectTerminals"];
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
}

/** Removing a project from the rail (archive or purge data) and restoring it. */
export function useProjectRemoval({
  refs,
  activeTabId,
  invalidateLoadedSession,
  persistSession,
  onSelectProject,
  setRecents,
  setSidebarTabSelection,
  setSessions,
  setTabs,
  setActiveTabId,
  setProjectCwd,
  setDirtyFiles,
  setProjectTerminals,
  setComposerFocused,
}: ProjectRemovalDeps) {
  const {
    sessionsRef,
    tabsRef,
    activeTabIdRef,
    projectCwdRef,
    removingSessionIds,
    loadedSessionCache,
    sessionLoads,
    pendingPersist,
    lastPersisted,
    turnGen,
  } = refs;

  const onRemoveProject = useCallback(
    async (path: string, options: { purgeData: boolean }) => {
      const normalized = normalizeProjectPath(path);
      if (options.purgeData) {
        const projectSessions = sessionsRef.current.filter((session) =>
          sameProjectPath(session.cwd, normalized),
        );
        if (
          projectSessions.some(
            (session) => session.busy || removingSessionIds.current.has(session.id),
          )
        ) {
          throw new Error(
            t(
              "Selection changed or a project is working. Close this dialog and review your selection.",
            ),
          );
        }
        // Keep the project visible on storage failure and prevent autosave from
        // recreating a session while its persisted data is being removed.
        for (const session of projectSessions) removingSessionIds.current.add(session.id);
        try {
          await removeProjectData(normalized);
        } finally {
          for (const session of projectSessions) removingSessionIds.current.delete(session.id);
        }
      }
      const wasCurrent = sameProjectPath(projectCwdRef.current, normalized);
      const remaining = options.purgeData ? forgetProject(normalized) : archiveProject(normalized);
      if (options.purgeData) {
        forgetProjectLocation(normalized);
        setSidebarTabSelection((current) =>
          sameProjectPath(current.project, normalized)
            ? { project: "~", tab: loadProjectSidebarTab("~") }
            : current,
        );
      }
      setRecents(remaining);

      const tabs = tabsRef.current;
      const sessions = sessionsRef.current;
      const projectTabs = filterTabsForProject(tabs, sessions, normalized);
      const projectTabIds = new Set(projectTabs.map((tab) => tab.id));
      const projectSessions = sessions.filter((session) =>
        sameProjectPath(session.cwd, normalized),
      );
      const projectSessionIds = new Set(projectSessions.map((session) => session.id));

      if (options.purgeData) {
        const cachedOrLoading = new Set([
          ...loadedSessionCache.current.keys(),
          ...sessionLoads.current.keys(),
        ]);
        for (const sessionId of cachedOrLoading) {
          invalidateLoadedSession(sessionId);
        }
        for (const session of projectSessions) {
          pendingPersist.current.delete(session.id);
          if (session.busy) {
            turnGen.current.set(session.id, (turnGen.current.get(session.id) ?? 0) + 1);
            for (const id of sessionChildHarnesses(session)) {
              void cancelHarnessTurn(id, session.id);
            }
          }
          for (const id of sessionChildHarnesses(session)) {
            void forgetHarnessSession(id, session.id);
          }
          lastPersisted.current.delete(session.id);
        }
      } else {
        for (const session of projectSessions) {
          if (session.busy) continue;
          if (shouldPersistSession(session)) {
            rememberLoadedSession(loadedSessionCache.current, session);
          }
          persistSession(session);
          pendingPersist.current.delete(session.id);
          for (const id of sessionChildHarnesses(session)) {
            void forgetHarnessSession(id, session.id);
          }
        }
      }

      let nextTabs = tabs.filter((tab) => !projectTabIds.has(tab.id));
      let nextSessions = sessions.filter((session) => {
        if (!projectSessionIds.has(session.id)) return true;
        return !options.purgeData && session.busy;
      });
      let nextActiveTabId = activeTabIdRef.current;

      if (nextTabs.length === 0) {
        const fallback = nextSessions[0];
        const session = newDefaultSession("~", fallback?.runtimeMode);
        const tab = newTab(session.id);
        nextSessions = [...nextSessions, session];
        nextTabs = [tab];
        nextActiveTabId = tab.id;
      } else if (projectTabIds.has(nextActiveTabId)) {
        nextActiveTabId = nextTabs[0]?.id ?? nextActiveTabId;
      }

      sessionsRef.current = nextSessions;
      tabsRef.current = nextTabs;
      activeTabIdRef.current = nextActiveTabId;
      setSessions(nextSessions);
      setTabs(nextTabs);
      if (nextActiveTabId !== activeTabId) {
        setActiveTabId(nextActiveTabId);
      }
      setDirtyFiles((prev) => {
        const updated = new Set(prev);
        for (const tab of projectTabs) {
          for (const file of [
            ...tab.editorPanes.flatMap((pane) => pane.files),
            ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
          ]) {
            updated.delete(file.id);
          }
        }
        return updated;
      });
      setProjectTerminals((prev) =>
        prev.filter((dock) => !sameProjectPath(dock.projectPath, normalized)),
      );

      if (wasCurrent) {
        const next = remaining.find((item) => looksLikeProject(item.path));
        if (next) {
          onSelectProject(next.path);
          setProjectCwd(next.path);
        } else {
          setProjectCwd("~");
          setComposerFocused(true);
        }
      }
    },
    [activeTabId, invalidateLoadedSession, onSelectProject, persistSession],
  );

  const onRestoreProject = useCallback(
    (path: string) => {
      setRecents(rememberProject(path));
      onSelectProject(path);
    },
    [onSelectProject],
  );

  return { onRemoveProject, onRestoreProject };
}
