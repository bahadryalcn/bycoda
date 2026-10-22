import { useCallback, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { routeWindowDestination } from "../../model/windowNavigation";
import type { ToolWindow } from "../../model/toolWindows";
import { ADOPTED_SESSION_ADDED } from "../../../features/connections/model/adoptedSessions";
import { openLocalHostSession } from "../../../features/connections/model/openLocalHostSession";
import { loadRemoteSession, remoteRequest } from "../../../features/connections/model/connections";
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
import { sessionWorkCwd, type Session } from "../../../features/sessions/model/session";
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
      setRecents(rememberProject(session.cwd));
      await onSelectHistorySession(sessionId);
    },
    [ensureOpenSession, onSelectHistorySession, toolWindow],
  );

  // Host-owned task and automation conversations open in the normal transcript
  // pane. Local copies keep following the host through the adopted-session mirror.
  const onOpenBackgroundSession = useCallback(
    async (target: BackgroundSessionTarget, routed = false) => {
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
        setAutomationsViewOpen(false);
        setServersViewOpen?.(false);
        setSearchViewOpen(false);
        setInboxViewOpen(false);
        setNotesViewOpen(false);
        setSettingsOpen(false);
        setFilePickerOpen(false);
        setSidebarTab("sessions", opened.cwd);
        setProjectCwd(opened.cwd);
        setRecents(rememberProject(opened.cwd));
        await onSelectHistorySession(opened.sessionId);
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
      setRecents(rememberProject(project.key));
      promptAddedProjectNames(knownBefore);
      onSelectRemoteSession(project.key, target.sessionId);
    },
    [
      ensureOpenSession,
      invalidateLoadedSession,
      onRefreshAdoptedSession,
      onSelectHistorySession,
      onSelectRemoteSession,
      promptAddedProjectNames,
      toolWindow,
    ],
  );

  return { onOpenAutomationSession, onOpenBackgroundSession };
}
