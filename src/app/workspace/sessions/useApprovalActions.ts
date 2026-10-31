import { hostSessionBinding } from "../../../features/connections/model/sessionExecutionBinding";
import { useCallback, type MutableRefObject } from "react";
import {
  keepHarnessQuestionOpen,
  respondHarnessQuestion,
  type ApprovalDecision,
  type UserQuestionReply,
} from "../../../integrations/harness";
import { remoteSessionActions } from "../../../features/connections/model/remoteSessionActions";
import { remoteProjectFor } from "../../../features/connections/model/remoteProjects";
import { type Session } from "../../../features/sessions/model/session";
import {
  pruneApprovalIntents,
  submitApprovalIntent,
  type ApprovalRequestToken,
} from "../../../features/sessions/model/approvalIntents";
import { liveTurnHarness } from "../../../features/sessions/model/messageQueue";
import { orchestrator } from "../../../features/orchestration/model/orchestration";
import { setSessions } from "../../../features/sessions/model/sessionsStore";
import { t } from "../../../shared/i18n";

/** An answer that never left the app must not leave its form on "Sending answer…". */
function failQuestionDelivery(sessionId: string, requestId: number, error: string): void {
  setSessions((sessions) =>
    sessions.map((session) =>
      session.id === sessionId && session.pendingQuestion?.requestId === requestId
        ? { ...session, pendingQuestion: { ...session.pendingQuestion, delivery: "failed", error } }
        : session,
    ),
  );
}

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
    (
      sessionId: string,
      requestId: number,
      decision: ApprovalDecision,
      expected?: ApprovalRequestToken,
    ) => {
      pruneApprovalIntents(sessionsRef.current);
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      return submitApprovalIntent(session, requestId, decision, expected, () =>
        sessionsRef.current.find((current) => current.id === sessionId),
      );
    },
    [],
  );

  const onQuestionReply = useCallback(
    (sessionId: string, requestId: number, reply: UserQuestionReply) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session) return;
      if (session.worktreeRemoved) {
        failQuestionDelivery(
          sessionId,
          requestId,
          t("The workspace was removed, so the answer could not be delivered."),
        );
        return;
      }
      if (
        session.pendingQuestion?.requestId !== requestId ||
        ["sending", "queued", "unknown"].includes(session.pendingQuestion.delivery ?? "")
      )
        return;
      if (hostSessionBinding(session) || remoteProjectFor(session.cwd)) {
        const actions = remoteSessionActions(sessionId);
        if (!actions) throw new Error("Question connection is unavailable");
        actions.answer(requestId, reply);
        return;
      }
      if (!respondHarnessQuestion(liveTurnHarness(session), sessionId, requestId, reply))
        failQuestionDelivery(
          sessionId,
          requestId,
          t("The provider is no longer waiting for this answer, so it was not delivered."),
        );
    },
    [],
  );

  const onQuestionInteraction = useCallback((sessionId: string, requestId: number) => {
    const session = sessionsRef.current.find((s) => s.id === sessionId);
    if (session && (hostSessionBinding(session) || remoteProjectFor(session.cwd))) return;
    if (session && !session.worktreeRemoved)
      keepHarnessQuestionOpen(liveTurnHarness(session), sessionId, requestId);
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
