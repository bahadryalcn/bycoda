import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { orchestrator } from "../../../features/orchestration/model/orchestration";
import { cancelHarnessTurn, stopStreaming } from "../../../integrations/harness";
import {
  buildDeterministicHandoff,
  completeHandoff,
  isPreparingHandoff,
  sessionChildHarnesses,
} from "../../../features/sessions/model/handoff";
import { markConversationTurnStopped } from "../../../features/sessions/model/conversationRewind";
import { notifyReviewChanged } from "../../../features/sessions/model/checkpoint";
import { sessionWorkCwd, type Session } from "../../../features/sessions/model/session";
import { remoteSessionActions } from "../../../features/connections/model/remoteSessionActions";
import { remoteProjectFor } from "../../../features/connections/model/remoteProjects";
import {
  deferUnhandledEscape,
  focusedBusyAgentSessionId,
  shouldStopFocusedTurnOnEscape,
} from "../../../features/workspace/model/tabKeys";
import { type WorkspaceTab } from "../../../features/workspace/model/layout";
import { notifyFinishedWorkspace } from "../helpers/workspaceNotify";

export interface SessionStopDeps {
  sessionsRef: MutableRefObject<Session[]>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  turnGen: MutableRefObject<Map<string, number>>;
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
    flushHarnessEvents,
    deferWorkspaceWork,
    tabsRef,
    activeTabIdRef,
    projectTerminalFocusedRef,
    onStopRef,
  } = deps;

  const onStop = useCallback(
    (sessionId: string, managed = false) => {
      const remote = sessionsRef.current.find((s) => s.id === sessionId);
      if (remote && remoteProjectFor(remote.cwd)) {
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
      // Completion may arrive while the provider is processing Stop. Prevent
      // that completion from draining another queued turn in the meantime.
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId && s.queuedMessages?.length ? { ...s, queueStatus: "paused" } : s,
        ),
      );
      flushHarnessEvents();
      const generation = turnGen.current.get(sessionId) ?? 0;
      const failureBlockId = `stop-error:${sessionId}`;
      void (async () => {
        // Keep the current event generation live until cancellation is delivered.
        // A failed Stop must leave provider events and another Stop actionable.
        const cancellations = await Promise.allSettled(
          session
            ? sessionChildHarnesses(session).map((id) => cancelHarnessTurn(id, sessionId))
            : [],
        );
        if ((turnGen.current.get(sessionId) ?? 0) !== generation) return;
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
                    ...(s.queuedMessages?.length ? { queueStatus: "paused" as const } : {}),
                  }
                : s,
            ),
          );
          return;
        }
        turnGen.current.set(sessionId, generation + 1);
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sessionId) return s;
            const stopped = s.busy
              ? markConversationTurnStopped(stopStreaming(s))
              : stopStreaming(s);
            const completed = isPreparingHandoff(stopped)
              ? completeHandoff(stopped, buildDeterministicHandoff(stopped))
              : stopped;
            const ready = {
              ...completed,
              worktreePreparing: undefined,
              blocks: completed.blocks.filter((block) => block.id !== failureBlockId),
            };
            return ready.queuedMessages?.length ? { ...ready, queueStatus: "paused" } : ready;
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
      })().catch(console.error);
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

  return { onStop };
}
