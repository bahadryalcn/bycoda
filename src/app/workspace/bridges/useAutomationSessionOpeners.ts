import {
  remoteSessionOwnershipKey,
  reserveSessionWindow,
} from "../../model/sessionWindowOwnership";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { routeWindowDestination } from "../../model/windowNavigation";
import type { ToolWindow } from "../../model/toolWindows";
import { ADOPTED_SESSION_ADDED } from "../../../features/connections/model/adoptedSessions";
import { openLocalHostSession } from "../../../features/connections/model/openLocalHostSession";
import {
  loadRemoteSession,
  remoteRequest,
  remoteMachineFor,
  remoteSessionFor,
  rememberRemoteSession,
} from "../../../features/connections/model/connections";
import { remoteSessionState } from "../../../features/connections/model/remoteSessionState";
import {
  parseRemotePath,
  rememberRemoteProject,
  remoteProjectsOn,
} from "../../../features/connections/model/remoteProjects";
import type { HostProject } from "../../../features/connections/model/protocol";
import type { BackgroundSessionTarget } from "../../../features/tasks/model/backgroundSession";
import { bindHarnessSession, isLiveHarness } from "../../../integrations/harness";
import {
  persistFingerprint,
  upsertSessionIfUnchanged,
} from "../../../features/sessions/data/sessionStore";
import { loadRecents, rememberProject } from "../../../features/projects/model/recents";
import {
  newDefaultSession,
  sessionWorkCwd,
  type Session,
} from "../../../features/sessions/model/session";
import { sameProjectPath } from "../../../features/projects/model/recents";
import { sessionsRef, setSessions } from "../../../features/sessions/model/sessionsStore";
import type { SidebarTabId } from "../../../features/settings/model/appearance";

export interface AutomationSessionOpenersDeps {
  toolWindow: ToolWindow | null;
  ensureOpenSession: (sessionId: string) => Promise<Session | null>;
  onSelectHistorySession: (sessionId: string) => Promise<unknown>;
  onSelectRemoteSession: (projectKey: string, sessionId: string) => unknown;
  invalidateLoadedSession: (sessionId: string) => void;
  onRefreshAdoptedSession: Parameters<typeof openLocalHostSession>[1]["refresh"];
  promptAddedProjectNames: (knownBefore: string[]) => void;
  lastPersisted: { current: Map<string, string> };
  setAutomationsViewOpen: (open: boolean) => void;
  setServersViewOpen?: (open: boolean) => void;
  setSearchViewOpen: (open: boolean) => void;
  setInboxViewOpen: (open: boolean) => void;
  setNotesViewOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setFilePickerOpen: (open: boolean) => void;
  setSidebarTab: (tab: SidebarTabId, project?: string) => void;
  setProjectCwd: Dispatch<SetStateAction<string>>;
  setRecents: Dispatch<SetStateAction<ReturnType<typeof loadRecents>>>;
}

// Opens automation and host background sessions in the transcript pane. Verbatim from Workspace.
export function useAutomationSessionOpeners({
  toolWindow,
  ensureOpenSession,
  onSelectHistorySession,
  onSelectRemoteSession,
  invalidateLoadedSession,
  onRefreshAdoptedSession,
  promptAddedProjectNames,
  lastPersisted,
  setAutomationsViewOpen,
  setServersViewOpen,
  setSearchViewOpen,
  setInboxViewOpen,
  setNotesViewOpen,
  setSettingsOpen,
  setFilePickerOpen,
  setSidebarTab,
  setProjectCwd,
  setRecents,
}: AutomationSessionOpenersDeps) {
  const onOpenAutomationSession = useCallback(
    async (sessionId: string, routed = false) => {
      if (
        routed !== true &&
        (await routeWindowDestination({ kind: "session", sessionId }, !!toolWindow))
      )
        return;
      const session = await ensureOpenSession(sessionId);
      if (!session) throw new Error("This conversation is no longer available.");
      setAutomationsViewOpen(false);
      setServersViewOpen?.(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setSettingsOpen(false);
      setFilePickerOpen(false);
      setSidebarTab("sessions", session.cwd);
      setProjectCwd(session.cwd);
      setRecents(await rememberProject(session.cwd));
      await onSelectHistorySession(sessionId);
    },
    [
      ensureOpenSession,
      onSelectHistorySession,
      toolWindow,
      setAutomationsViewOpen,
      setProjectCwd,
      setServersViewOpen,
      setSearchViewOpen,
      setSettingsOpen,
      setSidebarTab,
      setNotesViewOpen,
      setRecents,
      setFilePickerOpen,
      setInboxViewOpen,
    ],
  );

  // Host-owned task and automation conversations open in the normal transcript
  // pane. Local copies keep following the host through the adopted-session mirror.
  const onOpenBackgroundSession = useCallback(
    async (target: BackgroundSessionTarget, routed = false, embedded = false) => {
      if (
        routed !== true &&
        (await routeWindowDestination(
          { kind: "session", sessionId: target.sessionId, cwd: target.cwd, background: target },
          !!toolWindow,
        ))
      )
        return;
      const remote = parseRemotePath(target.cwd);
      if (!remote) {
        const release = await reserveSessionWindow([target.sessionId]);
        if (!release) return;
        let retained = false;
        try {
          const opened = await openLocalHostSession(target, {
            machines: () => invoke("remote_machines"),
            projects: (machineId) => remoteRequest<HostProject[]>(machineId, "projects.list"),
            load: (machineId, sessionId) => loadRemoteSession(machineId, sessionId),
            find: ensureOpenSession,
            refresh: onRefreshAdoptedSession,
            create: async (copy) => {
              if (sessionsRef.current.some((session) => session.id === copy.id)) return false;
              if (!(await upsertSessionIfUnchanged(copy, null))) return false;
              if (sessionsRef.current.some((session) => session.id === copy.id)) return false;
              invalidateLoadedSession(copy.id);
              if (!copy.worktreeRemoved && copy.providerSessionId && isLiveHarness(copy.harness)) {
                bindHarnessSession(
                  copy.harness,
                  copy.id,
                  copy.providerSessionId,
                  sessionWorkCwd(copy),
                  copy.providerAccountId,
                  copy.blocks,
                );
              }
              lastPersisted.current.set(copy.id, persistFingerprint(copy));
              const next = [...sessionsRef.current, copy];
              sessionsRef.current = next;
              setSessions(next);
              window.dispatchEvent(
                new CustomEvent<string>(ADOPTED_SESSION_ADDED, { detail: copy.cwd }),
              );
              return true;
            },
          });
          if (embedded) {
            retained = true;
            return;
          }
          setAutomationsViewOpen(false);
          setServersViewOpen?.(false);
          setSearchViewOpen(false);
          setInboxViewOpen(false);
          setNotesViewOpen(false);
          setSettingsOpen(false);
          setFilePickerOpen(false);
          setSidebarTab("sessions", opened.cwd);
          setProjectCwd(opened.cwd);
          setRecents(await rememberProject(opened.cwd));
          await onSelectHistorySession(opened.sessionId);
          retained = true;
          return;
        } finally {
          await release(retained);
        }
      }
      if (embedded) {
        const machine = await remoteMachineFor(remote.environmentId);
        if (!machine || machine.id !== target.machineId)
          throw new Error("This conversation belongs to another machine.");
        const release = await reserveSessionWindow([
          remoteSessionOwnershipKey(target.cwd, target.sessionId),
        ]);
        if (!release) throw new Error("This conversation is already open in another window.");
        let retained = false;
        try {
          const listed = await remoteRequest<HostProject[]>(machine.id, "projects.list");
          const owner = listed.find((entry) => entry.id === target.projectId);
          if (!owner) throw new Error("This project is no longer on that machine.");
          const project = rememberRemoteProject(remote.environmentId, owner);
          if (!sameProjectPath(project.key, target.cwd))
            throw new Error("This conversation belongs to another project.");
          const snapshot = await loadRemoteSession(machine.id, target.sessionId);
          if (snapshot.projectId !== owner.id || snapshot.session.id !== target.sessionId)
            throw new Error("This conversation belongs to another project.");
          const existing = sessionsRef.current.find(
            (entry) =>
              sameProjectPath(entry.cwd, project.key) &&
              remoteSessionFor(entry.id) === target.sessionId,
          );
          const shell = existing ?? newDefaultSession(project.key, snapshot.session.runtimeMode);
          // Bind only the exact claimed Host session; reuse its canonical shell,
          // never a blank composer that may already own an in-flight request.
          rememberRemoteSession(shell.id, target.sessionId);
          setSessions((current) => {
            const latest = current.find((entry) => entry.id === shell.id);
            const hydrated = remoteSessionState(latest ?? shell, snapshot, project);
            return latest
              ? current.map((entry) => (entry.id === shell.id ? hydrated : entry))
              : [...current, hydrated];
          });
          retained = true;
        } finally {
          await release(retained);
        }
        return;
      }
      // By the host's project ID: a task's session may run in a worktree.
      let project = remoteProjectsOn(remote.environmentId).find(
        (entry) => entry.projectId === target.projectId,
      );
      if (!project) {
        const listed = await remoteRequest<HostProject[]>(target.machineId, "projects.list");
        const host = listed.find((entry) => entry.id === target.projectId);
        if (!host) throw new Error("This project is no longer on that machine.");
        project = rememberRemoteProject(remote.environmentId, host);
      }
      const knownBefore = loadRecents().map((item) => item.path);
      setSettingsOpen(false);
      setFilePickerOpen(false);
      setRecents(await rememberProject(project.key));
      promptAddedProjectNames(knownBefore);
      await onSelectRemoteSession(project.key, target.sessionId);
    },
    [
      ensureOpenSession,
      invalidateLoadedSession,
      onRefreshAdoptedSession,
      onSelectHistorySession,
      onSelectRemoteSession,
      promptAddedProjectNames,
      toolWindow,
      setRecents,
      setInboxViewOpen,
      lastPersisted,
      setServersViewOpen,
      setSettingsOpen,
      setNotesViewOpen,
      setAutomationsViewOpen,
      setProjectCwd,
      setSearchViewOpen,
      setFilePickerOpen,
      setSidebarTab,
    ],
  );

  return { onOpenAutomationSession, onOpenBackgroundSession };
}
