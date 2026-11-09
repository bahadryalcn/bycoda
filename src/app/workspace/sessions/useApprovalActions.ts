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
import {
  delegationParentOf,
  isDelegatedChildOf,
} from "../../../features/sessions/model/delegatedAgents";
import { requestViewDelegated } from "../../../features/sessions/ui/delegatedFocus";
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
    (sessionId: string, requestId: number, reply: UserQuestionReply, current?: () => boolean) => {
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
        if (current) return;
        const actions = remoteSessionActions(sessionId);
        if (!actions) throw new Error("Question connection is unavailable");
        actions.answer(requestId, reply);
        return;
      }
      if (current && !current()) return;
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

  /**
   * Resolves whether the conversation actually opened. It may be closed, deleted
   * or owned by another window, and a caller such as the request history must be
   * able to say so instead of closing over nothing.
   */
  const onOpenApprovalSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      const parentId =
        sessionsRef.current.find((session) => session.id === sessionId)?.orchestrationLeadId ??
        orchestrator.forSession(sessionId)?.leadId;
      const ownerId = parentId && parentId !== sessionId ? parentId : sessionId;
      if (ownerId !== sessionId) setInspectedWorkerId(sessionId);
      if (focusOpenSession(ownerId)) return true;
      try {
        return (await onSelectHistorySession(ownerId)) === true;
      } catch (error) {
        console.error("Conversation could not be opened", error);
        return false;
      }
    },
    [focusOpenSession, onSelectHistorySession],
  );

  // A cross-window live-agent announcement is only a request to focus an
  // already-owned pane. Its sender may hold a stale snapshot: never reopen it.
  const onFocusOwnedApprovalSession = useCallback(
    (sessionId: string) => {
      const child = sessionsRef.current.find((session) => session.id === sessionId);
      if (child && delegationParentOf(child)) {
        const parents = sessionsRef.current.filter(
          (parent) => !parent.inboxAsk && isDelegatedChildOf(child, parent),
        );
        if (child.inboxAsk || parents.length !== 1 || !focusOpenSession(parents[0].id)) return;
        requestViewDelegated(parents[0].id, child.id);
        return;
      }
      const parentId =
        sessionsRef.current.find((session) => session.id === sessionId)?.orchestrationLeadId ??
        orchestrator.forSession(sessionId)?.leadId;
      const ownerId = parentId && parentId !== sessionId ? parentId : sessionId;
      if (!focusOpenSession(ownerId)) return;
      if (ownerId !== sessionId) setInspectedWorkerId(sessionId);
    },
    [focusOpenSession, sessionsRef, setInspectedWorkerId],
  );

  return {
    onApproval,
    onQuestionReply,
    onQuestionInteraction,
    onOpenApprovalSession,
    onFocusOwnedApprovalSession,
  };
}
