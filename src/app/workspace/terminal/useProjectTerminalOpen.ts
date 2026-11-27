import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { recordGuideActivity } from "../../../features/onboarding/model/guideActivity";
import { queueTerminalCommand } from "../../../features/terminal/model/terminalLaunchCommand";
import {
  addTerminalToDock,
  createProjectTerminal,
  findProjectTerminal,
  mapProjectTerminal,
  nextDockTerminalTitle,
  splitTerminalInDock,
  withDockOpen,
  type ProjectTerminalDock,
} from "../../../features/projects/model/projectTerminal";
import {
  canOpenTerminalIn,
  isLocalProject,
  sameProjectPath,
} from "../../../features/projects/model/recents";
import { parseRemotePath, remotePath } from "../../../features/connections/public/remoteProjects";
import { useRemoteMachines } from "../../../features/connections/public/connections";
import type { RemoteCodeRun } from "../../../features/terminal/public/codeExecution";
import { t } from "../../../shared/i18n";
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
  const { setProjectTerminals, setProjectTerminalFocused, lastDockSideRef, projectTerminalsRef } =
    dock;
  const remoteProject = parseRemotePath(projectCwd);
  const { machines } = useRemoteMachines(!!remoteProject);
  // Saved SSH opens a native shell; otherwise the project's Host runs one itself.
  const remoteTerminalAvailable = !!remoteProject;

  const focusProjectTerminal = useCallback(() => {
    recordGuideActivity("terminal-opened");
    setProjectTerminalFocused(true);
    setComposerFocused(false);
  }, [setComposerFocused, setProjectTerminalFocused]);

  const openProjectTerminal = useCallback(
    (cwd: string, profile?: string, terminalId?: string) => {
      const workdir = cwd || projectCwdRef.current;
      const projectPath = projectCwdRef.current;
      const remote = parseRemotePath(projectPath);
      const remoteWorkdir = parseRemotePath(workdir);
      const machine =
        remote &&
        machines.find((entry) => entry.environmentId === remote.environmentId && !!entry.ssh);
      const sameMachine = !!remoteWorkdir && remoteWorkdir.environmentId === remote?.environmentId;
      const ssh =
        machine && sameMachine
          ? {
              connectionId: machine.id,
              project: { environmentId: machine.environmentId, cwd: remoteWorkdir.hostPath },
            }
          : undefined;
      const hostShell = remote && sameMachine && !ssh ? { projectCwd: projectPath } : undefined;
      if (
        remote
          ? !(ssh || hostShell) || !!profile || !!terminalId
          : !canOpenTerminalIn(projectPath) || !canOpenTerminalIn(workdir)
      )
        return false;
      // Chosen once, so the terminal keeps its shell when the default changes.
      const shellProfile = remote ? undefined : (profile ?? loadTerminalProfile());
      setProjectTerminals((prev) => {
        const existing = findProjectTerminal(prev, projectPath);
        if (terminalId && existing?.pane.files.some((file) => file.id === terminalId))
          return mapProjectTerminal(prev, projectPath, (dock) => withDockOpen(dock, true));
        const file = newTerminalFile(
          workdir,
          existing ? nextDockTerminalTitle(existing, workdir) : undefined,
          projectPath,
          shellProfile,
        );
        if (terminalId) file.id = terminalId;
        const next = existing
          ? addTerminalToDock(existing, file)
          : createProjectTerminal(projectPath, file, lastDockSideRef.current ?? "bottom");
        const opened = ssh
          ? { ...next, sshShells: { ...next.sshShells, [file.id]: ssh } }
          : hostShell
            ? { ...next, hostShells: { ...next.hostShells, [file.id]: hostShell } }
            : next;
        return existing ? mapProjectTerminal(prev, projectPath, () => opened) : [...prev, opened];
      });
      focusProjectTerminal();
      return true;
    },
    [focusProjectTerminal, projectCwdRef, setProjectTerminals, lastDockSideRef, machines],
  );

  const onOpenTerminal = useCallback(
    (cwd: string, asWorkspaceTab = false, occupySessionId?: string, profile?: string) => {
      const workdir = cwd || terminalCwd;
      if (openProjectTerminal(workdir, profile)) return;
      if (!canOpenTerminalIn(projectCwdRef.current) || !canOpenTerminalIn(workdir)) return;
      recordGuideActivity("terminal-opened");
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
      setProjectTerminals((prev) =>
        mapProjectTerminal(prev, projectPath, (dock) => {
          const source = dock.pane.files.find((file) => file.id === fileId);
          const ssh = dock.sshShells?.[fileId];
          const hostShell = dock.hostShells?.[fileId];
          if (!source || (!ssh && !hostShell && !canOpenTerminalIn(projectPath))) return dock;
          const file = newTerminalFile(
            source.cwd,
            nextDockTerminalTitle(dock, source.cwd),
            projectPath,
            source.shellProfile,
          );
          const next = splitTerminalInDock(dock, fileId, file);
          if (ssh) return { ...next, sshShells: { ...next.sshShells, [file.id]: ssh } };
          if (hostShell)
            return { ...next, hostShells: { ...next.hostShells, [file.id]: hostShell } };
          return next;
        }),
      );
      focusProjectTerminal();
    },
    [focusProjectTerminal, setProjectTerminals, projectCwdRef],
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
  }, [
    terminalCwd,
    focusProjectTerminal,
    onOpenTerminal,
    projectCwd,
    setProjectTerminals,
    projectTerminalsRef,
  ]);

  const onNewTerminalInSession = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      if (session?.worktreeRemoved) return;
      const cwd = session ? sessionWorkCwd(session) : projectCwd;
      const remote = session && parseRemotePath(session.cwd);
      onOpenTerminal(
        remote && !parseRemotePath(cwd) ? remotePath(remote.environmentId, cwd) : cwd,
        false,
        sessionId,
      );
    },
    [onOpenTerminal, projectCwd, sessionsRef],
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

  /** A chat code block runs in its own project's dock; false leaves it to the run dialog. */
  const onRunSessionCode = useCallback(
    (sessionId: string, cwd: string, profile: string, terminalId: string) => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      if (!session || session.worktreeRemoved || session.cwd !== projectCwdRef.current)
        return false;
      return openProjectTerminal(cwd, profile, terminalId);
    },
    [openProjectTerminal, projectCwdRef, sessionsRef],
  );

  const onRunRemoteSessionCode = useCallback(
    (sessionId: string, run: RemoteCodeRun) => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      const projectPath = projectCwdRef.current;
      if (
        !session ||
        session.worktreeRemoved ||
        !parseRemotePath(projectPath) ||
        !sameProjectPath(session.cwd, projectPath) ||
        !sameProjectPath(run.options.projectCwd, projectPath)
      )
        return false;
      const file = newTerminalFile(run.options.cwd, t("Code block"), projectPath);
      file.id = run.controller.snapshot().id;
      setProjectTerminals((prev) => {
        const addRun = (dock: ProjectTerminalDock) => ({
          ...dock,
          remoteRuns: { ...dock.remoteRuns, [file.id]: run },
        });
        if (findProjectTerminal(prev, projectPath))
          return mapProjectTerminal(prev, projectPath, (dock) =>
            addRun(addTerminalToDock(dock, file)),
          );
        return [
          ...prev,
          addRun(createProjectTerminal(projectPath, file, lastDockSideRef.current ?? "bottom")),
        ];
      });
      focusProjectTerminal();
      return true;
    },
    [focusProjectTerminal, projectCwdRef, sessionsRef, setProjectTerminals, lastDockSideRef],
  );

  return {
    remoteTerminalAvailable,
    focusProjectTerminal,
    openProjectTerminal,
    onOpenTerminal,
    onNewTerminal,
    onNewTerminalWithProfile,
    onSplitProjectTerminal,
    onShowProjectTerminal,
    onNewTerminalInSession,
    onRunSessionProjectAction,
    onRunSessionCode,
    onRunRemoteSessionCode,
  };
}
