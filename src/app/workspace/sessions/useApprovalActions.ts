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
import { message } from "@tauri-apps/plugin-dialog";
import { isProjectLockedIn } from "../../../features/group-lock/model/lockState";
import { getGroupLockView } from "../../../features/group-lock/model/groupLock";
import { focusWindowLiveAgent } from "../../model/useWindowLiveAgents";

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
  /** Loads a closed session so its project can be checked against the group lock. */
  ensureOpenSession?: (sessionId: string) => Promise<Session | null>;
  /** Conversations other windows hold; a click focuses that window. */
  liveAgents?: Parameters<typeof focusWindowLiveAgent>[0][];
  unopenedRemoteRef?: MutableRefObject<{ project: string; session: { id: string } }[]>;
  dismissRemoteFinished?: (sessionId: string) => void;
  onSelectRemoteSession?: (project: string, remoteSessionId: string) => void;
  /** Closes the full-screen surfaces (search, inbox, ...) that would cover the conversation. */
  closeSurfaces?: () => void;
}

/** Approval, question reply/interaction and open-approval-session callbacks. Verbatim bodies. */
export function useApprovalActions(deps: ApprovalActionDeps) {
  const { sessionsRef, setInspectedWorkerId, focusOpenSession, onSelectHistorySession } = deps;
  const { ensureOpenSession, liveAgents, unopenedRemoteRef, dismissRemoteFinished } = deps;
  const { onSelectRemoteSession, closeSurfaces } = deps;

  /** An orchestrated worker is opened through its lead. */
  const ownerOf = useCallback(
    (sessionId: string) => {
      const parentId =
        sessionsRef.current.find((session) => session.id === sessionId)?.orchestrationLeadId ??
        orchestrator.forSession(sessionId)?.leadId;
      return parentId && parentId !== sessionId ? parentId : sessionId;
    },
    [sessionsRef],
  );

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
   * The one opener behind every notification target. Resolves whether the
   * conversation actually opened or was focused: it may be closed, deleted,
   * owned by another window or machine, or in a locked project group.
   */
  const onOpenApprovalSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      const ownerId = ownerOf(sessionId);
      const locked = (cwd: string) => isProjectLockedIn(getGroupLockView().lock, cwd);
      try {
        const elsewhere = liveAgents?.find(
          (agent) => agent.id === ownerId && agent.ownerWindowLabel,
        );
        if (elsewhere) {
          if (locked(elsewhere.cwd)) return false;
          try {
            await focusWindowLiveAgent(elsewhere);
            return true;
          } catch (error) {
            void message(String(error), { title: t("Open conversation window") }).catch(() => {});
            return false;
          }
        }
        const remote =
          sessionsRef.current.some((session) => session.id === ownerId) || !onSelectRemoteSession
            ? undefined
            : unopenedRemoteRef?.current.find(({ session }) => session.id === ownerId);
        if (remote) {
          if (locked(remote.project)) return false;
          closeSurfaces?.();
          dismissRemoteFinished?.(ownerId);
          onSelectRemoteSession?.(remote.project, ownerId);
          return true;
        }
        const known = sessionsRef.current.find((session) => session.id === ownerId);
        const session = known ?? (await ensureOpenSession?.(ownerId));
        if (ensureOpenSession && !session) return false;
        if (session && locked(session.cwd)) return false;
        closeSurfaces?.();
        if (ownerId !== sessionId) setInspectedWorkerId(sessionId);
        if (focusOpenSession(ownerId)) return true;
        return (await onSelectHistorySession(ownerId)) === true;
      } catch (error) {
        console.error("Conversation could not be opened", error);
        return false;
      }
    },
    [
      closeSurfaces,
      dismissRemoteFinished,
      ensureOpenSession,
      focusOpenSession,
      liveAgents,
      onSelectHistorySession,
      onSelectRemoteSession,
      ownerOf,
      sessionsRef,
      setInspectedWorkerId,
      unopenedRemoteRef,
    ],
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
      const ownerId = ownerOf(sessionId);
      if (!focusOpenSession(ownerId)) return;
      if (ownerId !== sessionId) setInspectedWorkerId(sessionId);
    },
    [focusOpenSession, ownerOf, sessionsRef, setInspectedWorkerId],
  );

  return {
    onApproval,
    onQuestionReply,
    onQuestionInteraction,
    onOpenApprovalSession,
    onFocusOwnedApprovalSession,
  };
}
