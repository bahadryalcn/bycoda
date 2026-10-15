import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { queueTerminalCommand } from "../../../features/terminal/model/terminalLaunchCommand";
import {
  addTerminalToDock,
  createProjectTerminal,
  findProjectTerminal,
  mapProjectTerminal,
  nextDockTerminalTitle,
  splitTerminalInDock,
  withDockOpen,
} from "../../../features/projects/model/projectTerminal";
import { isLocalProject } from "../../../features/projects/model/recents";
import { sessionWorkCwd, type Session } from "../../../features/sessions/model/session";
import { type ProjectAction } from "../../../features/projects/model/projectActions";
import { loadTerminalProfile } from "../../../features/terminal/model/terminalProfiles";
import { forgetHarnessSession } from "../../../integrations/harness";
import { isBlankSession } from "../../../features/projects/model/projectReturn";
import {
  newTerminalFile,
  newTerminalWorkspaceTab,
  nextTerminalTitle,
  openTerminalTab,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import { type ProjectTerminalDockState } from "./useProjectTerminalDockState";

export interface ProjectTerminalOpenDeps {
  dock: ProjectTerminalDockState;
  activeTab: WorkspaceTab | undefined;
  appendTab: (tab: WorkspaceTab, cwd?: string) => void;
  setActiveTabId: (id: string) => void;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  sessionsRef: MutableRefObject<Session[]>;
  lastPersisted: MutableRefObject<Map<string, string>>;
  projectCwd: string;
  projectCwdRef: MutableRefObject<string>;
  sidebarCwd: string;
  terminalCwd: string;
}

/** Opens terminals: the project dock first, otherwise a pane or workspace tab. */
export function useProjectTerminalOpen(deps: ProjectTerminalOpenDeps) {
  const {
    dock,
    activeTab,
    appendTab,
    setActiveTabId,
    setComposerFocused,
    setSessions,
    setTabs,
    sessionsRef,
    lastPersisted,
    projectCwd,
    projectCwdRef,
    sidebarCwd,
    terminalCwd,
  } = deps;
  const {
    setProjectTerminals,
    setProjectTerminalFocused,
    lastDockSideRef,
    projectTerminalsRef,
  } = dock;

  const focusProjectTerminal = useCallback(() => {
    setProjectTerminalFocused(true);
    setComposerFocused(false);
  }, []);

  const openProjectTerminal = useCallback(
    (cwd: string, profile?: string) => {
      const workdir = cwd || projectCwdRef.current;
      const projectPath = projectCwdRef.current;
      if (!isLocalProject(projectPath)) return false;
      // Chosen once, so the terminal keeps its shell when the default changes.
      const shellProfile = profile ?? loadTerminalProfile();
      setProjectTerminals((prev) => {
        const existing = findProjectTerminal(prev, projectPath);
        const file = newTerminalFile(
          workdir,
          existing ? nextDockTerminalTitle(existing, workdir) : undefined,
          projectPath,
          shellProfile,
        );
        if (!existing) {
          return [
            ...prev,
            createProjectTerminal(projectPath, file, lastDockSideRef.current ?? "bottom"),
          ];
        }
        return mapProjectTerminal(prev, projectPath, (dock) => addTerminalToDock(dock, file));
      });
      focusProjectTerminal();
      return true;
    },
    [focusProjectTerminal],
  );

  const onOpenTerminal = useCallback(
    (cwd: string, asWorkspaceTab = false, occupySessionId?: string, profile?: string) => {
      const workdir = cwd || terminalCwd;
      if (!isLocalProject(projectCwdRef.current) || !isLocalProject(workdir)) return;
      if (openProjectTerminal(workdir, profile)) return;
      const shellProfile = profile ?? loadTerminalProfile();

      if (asWorkspaceTab || !activeTab) {
        const file = newTerminalFile(workdir, undefined, sidebarCwd, shellProfile);
        const tab = newTerminalWorkspaceTab(file);
        appendTab(tab, sidebarCwd);
        setActiveTabId(tab.id);
        setComposerFocused(false);
        return;
      }

      const occupying = sessionsRef.current.find(
        (session) => session.id === (occupySessionId ?? activeTab.focusedId),
      );
      const occupyPaneId = occupying && isBlankSession(occupying) ? occupying.id : undefined;
      if (occupyPaneId && occupying) {
        lastPersisted.current.delete(occupyPaneId);
        void forgetHarnessSession(occupying.harness, occupyPaneId);
        setSessions((prev) => prev.filter((session) => session.id !== occupyPaneId));
      }

      const file = newTerminalFile(
        workdir,
        nextTerminalTitle(activeTab, workdir),
        sidebarCwd,
        shellProfile,
      );
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTab.id ? openTerminalTab(tab, file, occupyPaneId) : tab,
        ),
      );
      setComposerFocused(false);
    },
    [terminalCwd, activeTab, appendTab, openProjectTerminal, sidebarCwd],
  );

  const onNewTerminal = useCallback(() => {
    onOpenTerminal(terminalCwd);
  }, [terminalCwd, onOpenTerminal]);

  /** A terminal in a shell other than the default, picked from the profile menu. */
  const onNewTerminalWithProfile = useCallback(
    (profile: string) => {
      onOpenTerminal(terminalCwd, false, undefined, profile);
    },
    [terminalCwd, onOpenTerminal],
  );

  const onSplitProjectTerminal = useCallback(
    (fileId: string) => {
      const projectPath = projectCwdRef.current;
      if (!isLocalProject(projectPath)) return;
      setProjectTerminals((prev) =>
        mapProjectTerminal(prev, projectPath, (dock) => {
          const source = dock.pane.files.find((file) => file.id === fileId);
          if (!source) return dock;
          const file = newTerminalFile(
            source.cwd,
            nextDockTerminalTitle(dock, source.cwd),
            projectPath,
            source.shellProfile,
          );
          return splitTerminalInDock(dock, fileId, file);
        }),
      );
      focusProjectTerminal();
    },
    [focusProjectTerminal],
  );

  const onShowProjectTerminal = useCallback(() => {
    const dock = findProjectTerminal(projectTerminalsRef.current, projectCwd);
    if (dock && dock.pane.files.length > 0) {
      if (!dock.open) {
        setProjectTerminals((prev) =>
          mapProjectTerminal(prev, projectCwd, (entry) => withDockOpen(entry, true)),
        );
      }
      focusProjectTerminal();
      return;
    }
    onOpenTerminal(terminalCwd);
  }, [terminalCwd, focusProjectTerminal, onOpenTerminal, projectCwd]);

  const onNewTerminalInSession = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      if (session?.worktreeRemoved) return;
      onOpenTerminal(session ? sessionWorkCwd(session) : projectCwd, false, sessionId);
    },
    [onOpenTerminal, projectCwd],
  );

  const onRunSessionProjectAction = useCallback(
    (sessionId: string, action: ProjectAction) => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      if (!session || session.worktreeRemoved) return;
      const cwd = sessionWorkCwd(session);
      if (!isLocalProject(cwd)) return;
      const file = newTerminalFile(cwd, action.name, session.cwd, loadTerminalProfile());
      queueTerminalCommand(file.id, action.command);
      const tab = newTerminalWorkspaceTab(file);
      appendTab(tab, session.cwd);
      setActiveTabId(tab.id);
      setComposerFocused(false);
    },
    [appendTab],
  );

  return {
    focusProjectTerminal,
    openProjectTerminal,
    onOpenTerminal,
    onNewTerminal,
    onNewTerminalWithProfile,
    onSplitProjectTerminal,
    onShowProjectTerminal,
    onNewTerminalInSession,
    onRunSessionProjectAction,
  };
}
