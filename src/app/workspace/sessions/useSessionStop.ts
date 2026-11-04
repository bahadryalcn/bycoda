import { hostSessionBinding } from "../../../features/connections/model/sessionExecutionBinding";
import type { DesktopControlGuard } from "../../../features/connections/model/desktopLive";
import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { nextQueueStatus } from "../../../features/connections/model/queueState";
import { noteSharedLocalStop } from "../../../features/connections/model/useSharedLocalQueues";
import { orchestrator } from "../../../features/orchestration/model/orchestration";
import { cancelHarnessTurn, stopStreaming } from "../../../integrations/harness";
import {
  cancelHandoff,
  isPreparingHandoff,
  sessionChildHarnesses,
} from "../../../features/sessions/model/handoff";
import { markConversationTurnStopped } from "../../../features/sessions/model/conversationRewind";
import { hasActiveSubmit } from "../../../features/sessions/model/activeSubmits";
import { notifyReviewChanged } from "../../../features/sessions/model/checkpoint";
import { sessionWorkCwd, type Session } from "../../../features/sessions/model/session";
import { remoteSessionActions } from "../../../features/connections/model/remoteSessionActions";
import { remoteProjectFor } from "../../../features/connections/model/remoteProjects";
import { cancelAdoptedTurn } from "../../../features/connections/model/adoptedSessionCommands";
import {
  deferUnhandledEscape,
  focusedBusyAgentSessionId,
  shouldStopFocusedTurnOnEscape,
} from "../../../features/workspace/model/tabKeys";
import { type WorkspaceTab } from "../../../features/workspace/model/layout";
import { notifyFinishedWorkspace } from "../helpers/workspaceNotify";
import { isSendStarting } from "./submit/submitStarting";

export interface SessionStopDeps {
  sessionsRef: MutableRefObject<Session[]>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  turnGen: MutableRefObject<Map<string, number>>;
  retiringTurns: MutableRefObject<Map<string, number>>;
  flushHarnessEvents: () => void;
  deferWorkspaceWork: (callback: () => void, delay: number) => void;
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  activeTabIdRef: MutableRefObject<string>;
  projectTerminalFocusedRef: MutableRefObject<boolean>;
  /** Mirror written here; the ref is declared in Workspace because the automation launch hook reads it. */
  onStopRef: MutableRefObject<(sessionId: string) => void>;
}

/** Stop-turn callback, its onStopRef mirror, and the window Escape stop listener. Verbatim bodies. */
export function useSessionStop(deps: SessionStopDeps) {
  const {
    sessionsRef,
    setSessions,
    turnGen,
    retiringTurns,
    flushHarnessEvents,
    deferWorkspaceWork,
    tabsRef,
    activeTabIdRef,
    projectTerminalFocusedRef,
    onStopRef,
  } = deps;

  const onStop = useCallback(
    (sessionId: string, managed = false, current?: DesktopControlGuard, awaitOutcome = false) => {
      if (current && !current()) return;
      const remote = sessionsRef.current.find((s) => s.id === sessionId);
      if (current && remote && (hostSessionBinding(remote) || remoteProjectFor(remote.cwd))) return;
      // A remote desktop command has no original orchestration receipt. Hold it
      // rather than retargeting an orchestrator that appeared after the heartbeat.
      if (current && !managed && orchestrator.forSession(sessionId)) {
        if (current.stopOrchestration) void current.stopOrchestration().catch(console.error);
        return;
      }
      if (remote && (hostSessionBinding(remote) || remoteProjectFor(remote.cwd))) {
        remoteSessionActions(sessionId)?.stop();
        return;
      }
      if (!managed) {
        const stopping = orchestrator.stopForSession(sessionId);
        if (stopping) {
          void stopping.catch(console.error);
          return;
        }
      }
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (session?.continuingElsewhere && !session.busy) {
        // There is no local runner to retire, but in-flight attachment preparation
        // still belongs to this generation and must not send after Stop.
        turnGen.current.set(sessionId, (turnGen.current.get(sessionId) ?? 0) + 1);
        const stoppingGeneration = turnGen.current.get(sessionId);
        noteSharedLocalStop(sessionId);
        setSessions((prev) =>
          prev.map((entry) =>
            entry.id === sessionId && entry.queuedMessages?.length
              ? { ...entry, queueStatus: nextQueueStatus(entry.queueStatus, "pause") }
              : entry,
          ),
        );
        void cancelAdoptedTurn(
          sessionId,
          session.adoptedRunId,
          session.adoptedAuthorityGeneration,
        ).catch((error) => {
          if (turnGen.current.get(sessionId) !== stoppingGeneration) return;
          setSessions((prev) =>
            prev.map((entry) =>
              entry.id === sessionId
                ? {
                    ...entry,
                    blocks: [
                      ...entry.blocks.filter((block) => block.id !== `stop-error:${sessionId}`),
                      {
                        id: `stop-error:${sessionId}`,
                        role: "system" as const,
                        notice: "error" as const,
                        text: `Stop failed: ${error instanceof Error ? error.message : String(error)}. Try Stop again.`,
                      },
                    ],
                  }
                : entry,
            ),
          );
        });
        return;
      }
      // Completion may arrive while the provider is processing Stop. Prevent
      // that completion from draining another queued turn in the meantime.
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId && s.queuedMessages?.length
            ? { ...s, queueStatus: nextQueueStatus(s.queueStatus, "pause") }
            : s,
        ),
      );
      // A send still unsettled (a recovery notice, a late provider answer) pauses the
      // queue when it settles; the paused display alone would not stop a late success.
      noteSharedLocalStop(sessionId);
      flushHarnessEvents();
      if (current && !current()) return;
      const generation = turnGen.current.get(sessionId) ?? 0;
      if ((retiringTurns.current.get(sessionId) ?? 0) < 0) {
        if (awaitOutcome) return Promise.reject(new Error("Stop is already in progress."));
        return;
      }
      // A distinct marker survives the submit's own cleanup while Stop is in flight.
      const stoppingMarker = -generation - 1;
      retiringTurns.current.set(sessionId, stoppingMarker);
      const failureBlockId = `stop-error:${sessionId}`;
      // A send still starting has no turn yet; the last answered message is not
      // the one being stopped, so it must not be marked "Stopped by you".
      const noTurnYet = isSendStarting(sessionId);
      const operation = (async () => {
        try {
        // Keep the current event generation live until cancellation is delivered.
        // A failed Stop must leave provider events and another Stop actionable.
        const cancellations = await Promise.allSettled(
          session
            ? sessionChildHarnesses(session).map((id) => cancelHarnessTurn(id, sessionId))
            : [],
        );
        if ((turnGen.current.get(sessionId) ?? 0) !== generation) {
          if (awaitOutcome) throw new Error("Stop outcome is unknown because the session generation changed.");
          return;
        }
        const failure = cancellations.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") {
          const detail =
            failure.reason instanceof Error ? failure.reason.message : String(failure.reason);
          setSessions((prev) =>
            prev.map((s) =>
              s.id === sessionId
                ? {
                    ...s,
                    blocks: [
                      ...s.blocks.filter((block) => block.id !== failureBlockId),
                      {
                        id: failureBlockId,
                        role: "system" as const,
                        notice: "error" as const,
                        text: `Stop failed: ${detail}. Try Stop again.`,
                      },
                    ],
                    ...(s.queuedMessages?.length
                      ? { queueStatus: nextQueueStatus(s.queueStatus, "pause") }
                      : {}),
                  }
                : s,
            ),
          );
          throw new Error(`Stop failed: ${detail}. Try Stop again.`);
        }
        turnGen.current.set(sessionId, generation + 1);
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sessionId) return s;
            const stopped =
              s.busy && !noTurnYet
                ? markConversationTurnStopped(stopStreaming(s))
                : stopStreaming(s);
            const completed = isPreparingHandoff(stopped) ? cancelHandoff(stopped) : stopped;
            const ready = {
              ...completed,
              worktreePreparing: undefined,
              blocks: completed.blocks.filter((block) => block.id !== failureBlockId),
            };
            return ready.queuedMessages?.length
              ? { ...ready, queueStatus: nextQueueStatus(ready.queueStatus, "pause") }
              : ready;
          }),
        );
        if (session) {
          notifyFinishedWorkspace(
            sessionId,
            sessionWorkCwd(session),
            deferWorkspaceWork,
            "workspace-first",
          );
        } else {
          notifyReviewChanged(sessionId);
        }
        } finally {
          if (retiringTurns.current.get(sessionId) === stoppingMarker) {
            if (hasActiveSubmit(sessionId)) retiringTurns.current.set(sessionId, generation);
            else retiringTurns.current.delete(sessionId);
          }
        }
      })();
      if (awaitOutcome) return operation;
      void operation.catch(console.error);
    },
    [flushHarnessEvents],
  );
  onStopRef.current = onStop;

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const inTerminal = Boolean(target?.closest(".bycoda-terminal"));
      const activeTabId = activeTabIdRef.current;
      const sessionId = focusedBusyAgentSessionId(
        activeTabId,
        tabsRef.current,
        sessionsRef.current,
        projectTerminalFocusedRef.current,
      );
      if (
        !sessionId ||
        !shouldStopFocusedTurnOnEscape(event, {
          inTerminal,
          focusedSessionBusy: true,
        })
      ) {
        return;
      }

      // Other surfaces (drag/reorder included) can claim Escape later in the
      // same keydown dispatch. Defer the destructive stop until every handler
      // has had a chance to preventDefault, then verify focus did not move.
      deferUnhandledEscape(event, () => {
        const stillFocusedSessionId = focusedBusyAgentSessionId(
          activeTabIdRef.current,
          tabsRef.current,
          sessionsRef.current,
          projectTerminalFocusedRef.current,
        );
        if (activeTabIdRef.current !== activeTabId || stillFocusedSessionId !== sessionId) {
          return;
        }
        onStop(sessionId);
      });
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [onStop]);

  const onStopForRoom = useCallback(async (sessionId: string) => {
    const session = sessionsRef.current.find((entry) => entry.id === sessionId);
    if (!session || session.continuingElsewhere || hostSessionBinding(session) || remoteProjectFor(session.cwd) || orchestrator.forSession(sessionId)) throw new Error("Session stop owner is unavailable in this window.");
    await onStop(sessionId, false, undefined, true);
  }, [onStop]);
  return { onStop, onStopForRoom };
}
