import type { Dispatch, SetStateAction } from "react";
import { useEffect, useLayoutEffect } from "react";
import type { SubmitOptions } from "../helpers/types";
import type { OrchestrationState } from "./useOrchestrationState";
import {
  assertOriginalWorkerProcess,
  createOrchestratorWorkerBindings,
  finishOriginalWorkerProcess,
  stopOriginalWorkerHarnesses,
} from "./orchestratorWorkerBindings";
import { type WorkspaceTab } from "../../../features/workspace/model/layout";
import {
  type Attachment,
  HARNESSES,
  sessionWorkCwd,
} from "../../../features/sessions/model/session";
import { type SessionSummary } from "../../../features/sessions/data/sessionStore";
import { type SubmissionAcceptance } from "../../model/submissionAcceptance";
import {
  setSessions,
  sessionsRef,
  subscribeShell,
} from "../../../features/sessions/model/sessionsStore";
import {
  attachOrchestrationWorkers,
  consolidateOrchestrationTabs,
} from "../../../features/orchestration/model/orchestrationWorkspace";
import { orchestrator } from "../../../features/orchestration/model/orchestration";
import { isHarnessAvailable } from "../../../integrations/harness/core/availability";
import { modelsFor } from "../../../features/sessions/model/models";
import { submitWithSettlement } from "../../model/managedSubmission";
import { flushSync } from "react-dom";
import {
  isLiveHarness,
  canSteerHarness,
  appendSteerUser,
  steerHarnessTurn,
  respondHarnessQuestion,
} from "../../../integrations/harness";
import { captureChildProcess } from "../../../integrations/harness/core/child";
import { captureHarnessControlTurn } from "../../../integrations/harness/core/registry";
import { pendingApprovalForSession } from "../../../features/notifications/model/approvalToast";
import { isApprovalOccurrenceId } from "../../../shared/model/approvalOccurrence";
import {
  approvalRequestDispatchStarted,
  captureApprovalRequest,
  submitApprovalIntent,
} from "../../../features/sessions/model/approvalIntents";

export interface OrchestratorBindingDeps {
  tabs: WorkspaceTab[];
  activeTabId: string;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  setActiveTabId: (id: string) => void;
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
  orchestrationRuns,
  setHistory,
  setStoredLinkedSessions,
  checkOpenWorktreeFiles,
  submitSession,
  onStop,
  flushHarnessEvents,
}: OrchestratorBindingDeps): void {
  // `orchestrationLeadId` is read straight from the shared sessions store by
  // many consumers (sidebar, history, tray, inbox, approvals), so the projection
  // stays a store write instead of a per-consumer selector. Both writes below
  // are idempotent: the pure helpers return their input when nothing changes,
  // and they are skipped outright when no run has any worker task.
  const hasWorkerTasks = orchestrationRuns.some((run) => run.tasks.length > 0);
  // Tab consolidation depends only on which worker sessions belong to which
  // lead, not on run status churn, so key it on that link set.
  const workerLinkKey = orchestrationRuns
    .flatMap((run) => run.tasks.map((task) => `${run.leadId}>${task.sessionId}`))
    .join("|");

  useEffect(() => {
    if (!hasWorkerTasks) return;
    setSessions((prev) => attachOrchestrationWorkers(prev, orchestrationRuns));
  }, [orchestrationRuns, hasWorkerTasks]);

  useEffect(() => {
    if (!workerLinkKey) return;
    const next = consolidateOrchestrationTabs(tabs, activeTabId, orchestrationRuns);
    if (next.tabs !== tabs) setTabs(next.tabs);
    if (next.activeTabId !== activeTabId) setActiveTabId(next.activeTabId);
  }, [tabs, activeTabId, workerLinkKey]);
  useLayoutEffect(() => {
    orchestrator.bind({
      session: (id) => sessionsRef.current.find((session) => session.id === id),
      sessions: () => sessionsRef.current,
      choices: () =>
        HARNESSES.filter(isHarnessAvailable).map((harness) => ({
          harness,
          models: modelsFor(harness).map(({ id, name }) => ({ id, name })),
        })),
      ...createOrchestratorWorkerBindings({
        checkOpenWorktreeFiles,
        onStop,
        setHistory,
        setStoredLinkedSessions,
      }),
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
      respondApproval: (id, requestId, decision, approvalOccurrenceId) => {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        const pending = session && pendingApprovalForSession(session);
        if (
          !session ||
          pending?.kind !== "approval" ||
          pending.requestId !== requestId ||
          !isApprovalOccurrenceId(approvalOccurrenceId) ||
          pending.block?.approval?.occurrenceId !== approvalOccurrenceId
        )
          return false;
        // The caller supplies its original viewed nonce. Capture only this exact
        // accepted source, never whichever numeric request exists after an await.
        const token = captureApprovalRequest(session, requestId);
        if (!token) return false;
        const outcome = submitApprovalIntent(session, requestId, decision, token, () =>
          sessionsRef.current.find((entry) => entry.id === id),
        );
        if (typeof outcome !== "boolean") void outcome.catch(() => undefined);
        return approvalRequestDispatchStarted(token);
      },
      answerQuestion: (id, requestId, reply) => {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        if (session) respondHarnessQuestion(session.harness, id, requestId, reply);
      },
      stop: async (id) => {
        const originalProcess = captureChildProcess(id);
        const originalControl = captureHarnessControlTurn(id, originalProcess);
        const session = sessionsRef.current.find((entry) => entry.id === id);
        assertOriginalWorkerProcess(id, originalProcess);
        onStop(id, true);
        assertOriginalWorkerProcess(id, originalProcess);
        if (session) await stopOriginalWorkerHarnesses(session);
        // Source snapshots above survive every awaited family cleanup.
        await finishOriginalWorkerProcess(id, originalProcess, originalControl);
      },
    });
  }, [checkOpenWorktreeFiles, submitSession, onStop]);
  useEffect(() => {
    let disposed = false;
    let scheduled = false;
    const unsubscribe = subscribeShell(() => {
      if (scheduled) return;
      scheduled = true;
      // A sync can wake workers and update sessions. Run after the current store
      // transaction, coalescing synchronous updates before inspecting idle state.
      queueMicrotask(() => {
        scheduled = false;
        if (!disposed) orchestrator.sync();
      });
    });
    orchestrator.sync();
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
}
