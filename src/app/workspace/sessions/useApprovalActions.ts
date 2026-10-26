import { useCallback, type MutableRefObject } from "react";
import {
  keepHarnessQuestionOpen,
  respondHarnessApproval,
  respondHarnessQuestion,
  type ApprovalDecision,
  type UserQuestionReply,
} from "../../../integrations/harness";
import { remoteSessionActions } from "../../../features/connections/model/remoteSessionActions";
import { remoteProjectFor } from "../../../features/connections/model/remoteProjects";
import { type Session } from "../../../features/sessions/model/session";
import { orchestrator } from "../../../features/orchestration/model/orchestration";

export interface ApprovalActionDeps {
  sessionsRef: MutableRefObject<Session[]>;
  setInspectedWorkerId: (workerId: string) => void;
  focusOpenSession: (sessionId: string) => boolean;
  onSelectHistorySession: (sessionId: string) => Promise<unknown>;
}

/** Approval, question reply/interaction and open-approval-session callbacks. Verbatim bodies. */
export function useApprovalActions(deps: ApprovalActionDeps) {
  const { sessionsRef, setInspectedWorkerId, focusOpenSession, onSelectHistorySession } = deps;

  const onApproval = useCallback(
    (sessionId: string, requestId: number, decision: ApprovalDecision) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session || session.worktreeRemoved) return;
      if (remoteProjectFor(session.cwd)) {
        remoteSessionActions(sessionId)?.approve(requestId, decision);
        return;
      }
      respondHarnessApproval(session.harness, sessionId, requestId, decision);
    },
    [],
  );

  const onQuestionReply = useCallback(
    (sessionId: string, requestId: number, reply: UserQuestionReply) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session || session.worktreeRemoved) return;
      if (
        session.pendingQuestion?.requestId !== requestId ||
        ["sending", "queued", "unknown"].includes(session.pendingQuestion.delivery ?? "")
      )
        return;
      if (remoteProjectFor(session.cwd)) {
        const actions = remoteSessionActions(sessionId);
        if (!actions) throw new Error("Question connection is unavailable");
        actions.answer(requestId, reply);
        return;
      }
      respondHarnessQuestion(session.harness, sessionId, requestId, reply);
    },
    [],
  );

  const onQuestionInteraction = useCallback((sessionId: string, requestId: number) => {
    const session = sessionsRef.current.find((s) => s.id === sessionId);
    if (session && remoteProjectFor(session.cwd)) return;
    if (session && !session.worktreeRemoved)
      keepHarnessQuestionOpen(session.harness, sessionId, requestId);
  }, []);

  const onOpenApprovalSession = useCallback(
    (sessionId: string) => {
      const parentId =
        sessionsRef.current.find((session) => session.id === sessionId)?.orchestrationLeadId ??
        orchestrator.forSession(sessionId)?.leadId;
      if (parentId && parentId !== sessionId) {
        setInspectedWorkerId(sessionId);
        if (!focusOpenSession(parentId)) void onSelectHistorySession(parentId);
      } else if (!focusOpenSession(sessionId)) {
        void onSelectHistorySession(sessionId);
      }
    },
    [focusOpenSession, onSelectHistorySession],
  );

  return { onApproval, onQuestionReply, onQuestionInteraction, onOpenApprovalSession };
}
