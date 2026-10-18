import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import { isProjectPasswordLocked } from "../../../features/group-lock/model/groupLock";
import {
  listAutomationRuns,
  updateAutomationRun,
  type Automation,
  type AutomationRun,
} from "../../../features/automations/model/automations";
import {
  LOCKED_PROJECT_SKIP,
  automationLimits,
  dailyRunLimitSkip,
  runLimitBreach,
} from "../../../features/automations/model/automationLimits";
import {
  HARNESS_LABEL,
  formatSessionTitle,
  newSession,
  sessionWorkCwd,
  type LinkedWorkItem,
} from "../../../features/sessions/model/session";
import { linkedWorkItemFromAutomationEvent } from "../../../features/sessions/model/sessionWorkItem";
import { looksLikeProject } from "../../../features/projects/model/recents";
import {
  loadSessionFolders,
  placeSessionInFolder,
  saveSessionFolders,
} from "../../../features/sessions/model/sessionFolders";
import { newTab, type WorkspaceTab } from "../../../features/workspace/model/layout";
import { pathKey } from "../../../shared/lib/paths";
import { submitWithSettlement } from "../../model/managedSubmission";
import { sessionsRef, setSessions } from "../../../features/sessions/model/sessionsStore";
import type { Submit } from "../helpers/types";
import type { SidebarTabId } from "../../../features/settings/model/appearance";

export interface AutomationLaunchDeps {
  appendTab: (tab: WorkspaceTab, cwd: string) => void;
  focusOpenSession: (sessionId: string) => void;
  submitSession: Submit;
  setActiveTabId: (id: string) => void;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  setSearchViewOpen: (open: boolean) => void;
  setInboxViewOpen: (open: boolean) => void;
  setNotesViewOpen: (open: boolean) => void;
  setAutomationsViewOpen: (open: boolean) => void;
  setServersViewOpen?: (open: boolean) => void;
  setSidebarTab: (tab: SidebarTabId, project?: string) => void;
  onStopRef: { current: (sessionId: string) => void };
}

// Automation runs: claim-gated launch of a run into a session. Verbatim from Workspace.
export function useAutomationLaunch({
  appendTab,
  focusOpenSession,
  submitSession,
  setActiveTabId,
  setComposerFocused,
  setSearchViewOpen,
  setInboxViewOpen,
  setNotesViewOpen,
  setAutomationsViewOpen,
  setServersViewOpen,
  setSidebarTab,
  onStopRef,
}: AutomationLaunchDeps) {
  const automationSessionReservations = useRef(new Set<string>());
  // Launches of one automation start one at a time, so the daily limit sees
  // the runs claimed alongside it.
  const automationStartGate = useRef(new Map<string, Promise<void>>());

  const launchAutomation = useCallback(
    async (
      automation: Automation,
      run: AutomationRun,
      reveal = false,
      prompt = run.prompt ?? automation.prompt,
      sourceWorkItem?: LinkedWorkItem,
    ) => {
      // A runbook must use its native target-bound approval and process owner.
      // Scheduled/recovered agent launch paths never execute its script.
      if (automation.executor === "ssh" || automation.sshRunbook) return;
      let reservationId: string | undefined;
      let releaseAfterSettle = false;
      const releaseReservation = () => {
        if (!reservationId) return;
        automationSessionReservations.current.delete(reservationId);
        reservationId = undefined;
      };
      const limits = automationLimits(automation);
      const earlier = automationStartGate.current.get(automation.id) ?? Promise.resolve();
      let started = () => undefined as void;
      automationStartGate.current.set(
        automation.id,
        new Promise<void>((resolve) => {
          started = resolve;
        }),
      );
      let watchdog: number | undefined;
      let breach: string | null = null;
      try {
        await earlier;
        const skip = isProjectPasswordLocked(automation.cwd)
          ? LOCKED_PROJECT_SKIP
          : run.trigger === "manual"
            ? null
            : dailyRunLimitSkip(
                limits,
                limits.maxRunsPerDay > 0 ? await listAutomationRuns(automation.id) : [],
                run.id,
                Date.now(),
              );
        if (skip) {
          await updateAutomationRun(run.id, "skipped", { error: skip });
          return;
        }
        const eventRun = run.trigger === "event";
        const linkedWorkItem = sourceWorkItem ?? linkedWorkItemFromAutomationEvent(run);
        let session =
          automation.reuseSession && automation.lastSessionId
            ? sessionsRef.current.find(
                (entry) =>
                  entry.id === automation.lastSessionId &&
                  entry.harness === automation.harness &&
                  !entry.busy &&
                  !entry.worktreeRemoved &&
                  !automationSessionReservations.current.has(entry.id) &&
                  (automation.workspaceMode === "current"
                    ? entry.workspaceMode !== "worktree" &&
                      !entry.worktreeCwd &&
                      pathKey(entry.cwd) === pathKey(automation.cwd)
                    : automation.workspaceMode === "existing"
                      ? pathKey(sessionWorkCwd(entry)) === pathKey(automation.worktreeCwd ?? "")
                      : false),
              )
            : undefined;

        if (!session) {
          session = {
            ...newSession(
              automation.harness,
              automation.cwd,
              automation.model,
              automation.runtimeMode,
              automation.modelSettings,
            ),
            title: eventRun
              ? HARNESS_LABEL[automation.harness]
              : formatSessionTitle(automation.harness, automation.name),
            automationId: automation.id,
            ...(linkedWorkItem ? { linkedWorkItem } : {}),
            ...(automation.workspaceMode === "worktree"
              ? { workspaceMode: "worktree" as const, worktreeBase: "HEAD" }
              : automation.workspaceMode === "existing" && automation.worktreeCwd
                ? { worktreeCwd: automation.worktreeCwd }
                : {}),
          };
          const nextSessions = [...sessionsRef.current, session];
          sessionsRef.current = nextSessions;
          setSessions(nextSessions);
          const tab = newTab(session.id);
          appendTab(tab, automation.cwd);
          if (reveal) {
            setActiveTabId(tab.id);
            setComposerFocused(false);
          }
        } else {
          const stamped = {
            ...session,
            automationId: automation.id,
            model: automation.model,
            modelSettings: automation.modelSettings ?? {},
            runtimeMode: automation.runtimeMode,
            ...(linkedWorkItem ? { linkedWorkItem } : {}),
          };
          session = stamped;
          const nextSessions = sessionsRef.current.map((entry) =>
            entry.id === stamped.id ? stamped : entry,
          );
          sessionsRef.current = nextSessions;
          setSessions(nextSessions);
          if (reveal) {
            focusOpenSession(session.id);
          }
        }

        reservationId = session.id;
        automationSessionReservations.current.add(session.id);

        if (automation.sessionFolderId && looksLikeProject(automation.cwd)) {
          saveSessionFolders(
            automation.cwd,
            placeSessionInFolder(loadSessionFolders(automation.cwd), session.id, {
              kind: "existing",
              folderId: automation.sessionFolderId,
            }),
          );
        }

        if (reveal) {
          setSearchViewOpen(false);
          setInboxViewOpen(false);
          setNotesViewOpen(false);
          setAutomationsViewOpen(false);
          setServersViewOpen?.(false);
          setSidebarTab("sessions", session.cwd);
        }

        await updateAutomationRun(run.id, "running", {
          sessionId: session.id,
        });
        started();
        if (limits.maxRunMinutes > 0) {
          const startedAt = Date.now();
          const sessionId = session.id;
          watchdog = window.setInterval(() => {
            breach = runLimitBreach(limits, { startedAt, now: Date.now() });
            if (!breach) return;
            window.clearInterval(watchdog);
            onStopRef.current(sessionId);
          }, 15_000);
        }
        // From here the settlement callback owns reservation cleanup, including
        // a rejected submission that never starts an agent turn.
        releaseAfterSettle = true;
        await submitWithSettlement({
          submit: (onSettled) =>
            submitSession(session.id, prompt, [], {
              refreshTitle: eventRun,
              onSettled,
            }),
          rejectionMessage: "The selected agent session could not start this run.",
          onSettled: (outcome) => {
            window.clearInterval(watchdog);
            const error = breach ?? outcome.error;
            const status = breach
              ? "failed"
              : outcome.status === "completed"
                ? "succeeded"
                : outcome.status === "cancelled"
                  ? "cancelled"
                  : "failed";
            void updateAutomationRun(run.id, status, {
              sessionId: session.id,
              ...(error ? { error } : {}),
            })
              .catch((error) => {
                console.warn("App operation failed", error);
              })
              .finally(releaseReservation);
          },
        });
      } catch (reason: unknown) {
        await updateAutomationRun(run.id, "failed", {
          error: reason instanceof Error ? reason.message : String(reason),
        }).catch((error) => {
          console.warn("App operation failed", error);
        });
        throw reason;
      } finally {
        started();
        if (!releaseAfterSettle) {
          window.clearInterval(watchdog);
          releaseReservation();
        }
      }
    },
    [appendTab, focusOpenSession, submitSession],
  );

  return { launchAutomation };
}
