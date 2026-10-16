import type { Dispatch, SetStateAction } from "react";
import { useEffect, useLayoutEffect } from "react";
import type { SubmitOptions } from "../helpers/types";
import type { OrchestrationState } from "./useOrchestrationState";
import { createOrchestratorWorkerBindings } from "./orchestratorWorkerBindings";
import { type WorkspaceTab } from "../../../features/workspace/model/layout";
import { type Session, type Attachment, HARNESSES, sessionWorkCwd } from "../../../features/sessions/model/session";
import { type SessionSummary } from "../../../features/sessions/data/sessionStore";
import { type SubmissionAcceptance } from "../../model/submissionAcceptance";
import { setSessions, sessionsRef } from "../../../features/sessions/model/sessionsStore";
import { attachOrchestrationWorkers, consolidateOrchestrationTabs } from "../../../features/orchestration/model/orchestrationWorkspace";
import { orchestrator } from "../../../features/orchestration/model/orchestration";
import { isHarnessAvailable } from "../../../integrations/harness/core/availability";
import { modelsFor } from "../../../features/sessions/model/models";
import { submitWithSettlement } from "../../model/managedSubmission";
import { flushSync } from "react-dom";
import { isLiveHarness, canSteerHarness, appendSteerUser, steerHarnessTurn, respondHarnessApproval, respondHarnessQuestion, stopHarnessSession } from "../../../integrations/harness";
import { sessionChildHarnesses } from "../../../features/sessions/model/handoff";
import { invoke } from "@tauri-apps/api/core";

export interface OrchestratorBindingDeps {
  tabs: WorkspaceTab[];
  activeTabId: string;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  setActiveTabId: (id: string) => void;
  sessions: Session[];
  orchestrationRuns: OrchestrationState["orchestrationRuns"];
  setHistory: Dispatch<SetStateAction<SessionSummary[]>>;
  setStoredLinkedSessions: Dispatch<SetStateAction<SessionSummary[]>>;
  checkOpenWorktreeFiles: (path: string) => void;
  submitSession: (
    sessionId: string,
    text: string,
    attachments: Attachment[],
    options?: SubmitOptions,
  ) => SubmissionAcceptance;
  onStop: (sessionId: string, managed?: boolean) => void;
  flushHarnessEvents: () => void;
}

export function useOrchestratorBinding({
  tabs,
  activeTabId,
  setTabs,
  setActiveTabId,
  sessions,
  orchestrationRuns,
  setHistory,
  setStoredLinkedSessions,
  checkOpenWorktreeFiles,
  submitSession,
  onStop,
  flushHarnessEvents,
}: OrchestratorBindingDeps): void {
  useEffect(() => {
    setSessions((prev) => attachOrchestrationWorkers(prev, orchestrationRuns));
  }, [orchestrationRuns]);

  useEffect(() => {
    const next = consolidateOrchestrationTabs(tabs, activeTabId, orchestrationRuns);
    if (next.tabs !== tabs) setTabs(next.tabs);
    if (next.activeTabId !== activeTabId) setActiveTabId(next.activeTabId);
  }, [tabs, activeTabId, orchestrationRuns]);
  useLayoutEffect(() => {
    orchestrator.bind({
      session: (id) => sessionsRef.current.find((session) => session.id === id),
      sessions: () => sessionsRef.current,
      choices: () =>
        HARNESSES.filter(isHarnessAvailable).map((harness) => ({
          harness,
          models: modelsFor(harness).map(({ id, name }) => ({ id, name })),
        })),
      ...createOrchestratorWorkerBindings({ checkOpenWorktreeFiles, onStop, setHistory, setStoredLinkedSessions }),
      submit: (id, text, done) => {
        void submitWithSettlement({
          submit: (onSettled) => {
            let acceptance: SubmissionAcceptance = false;
            // Commit an immediate turn before another scheduler update. A
            // deferred submission flushes its own turn after synchronization.
            flushSync(() => {
              acceptance = submitSession(id, text, [], {
                managed: true,
                onSettled,
              });
            });
            return acceptance;
          },
          onSettled: done,
          rejectionMessage: "The selected agent session could not accept this turn.",
        }).catch(console.error);
      },
      steer: async (id, text) => {
        flushHarnessEvents();
        const session = sessionsRef.current.find((entry) => entry.id === id);
        if (!session) throw new Error("This agent is no longer available");
        if (!session.busy)
          throw new Error("This agent is not running a turn; send it a fresh one with message.");
        if (!isLiveHarness(session.harness) || !canSteerHarness(session.harness))
          throw new Error(
            `${session.harness} cannot take guidance mid-turn. Wait for the turn to finish, then use message.`,
          );
        // Record it on the worker before dispatch, so its own transcript shows
        // why it changed course even if the harness call then fails.
        const next = sessionsRef.current.map((entry) =>
          entry.id === id ? appendSteerUser(entry, text) : entry,
        );
        sessionsRef.current = next;
        setSessions(next);
        await steerHarnessTurn({
          harness: session.harness,
          sessionId: id,
          cwd: sessionWorkCwd(session),
          model: session.model,
          modelSettings: session.modelSettings,
          text,
        });
      },
      respondApproval: (id, requestId, decision) => {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        if (session) respondHarnessApproval(session.harness, id, requestId, decision);
      },
      answerQuestion: (id, requestId, reply) => {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        if (session) respondHarnessQuestion(session.harness, id, requestId, reply);
      },
      stop: async (id) => {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        onStop(id, true);
        try {
          if (session)
            await Promise.all(
              sessionChildHarnesses(session).map((harness) => stopHarnessSession(harness, id)),
            );
        } finally {
          // Also reap processes left behind by a renderer reload, before the
          // corresponding session has been restored in this window.
          await invoke("harness_kill", { sessionId: id });
          await invoke("control_turn_finished", { sessionId: id });
        }
      },
    });
  }, [checkOpenWorktreeFiles, submitSession, onStop]);
  useEffect(() => {
    orchestrator.sync();
  }, [sessions]);
}
