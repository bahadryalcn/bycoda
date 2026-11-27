import { workspaceFailureDetail } from "../../model/workspaceActionError";
import { hostSessionBinding } from "../../../features/connections/model/sessionExecutionBinding";
import { useCallback, type MutableRefObject } from "react";
import {
  keepHarnessQuestionOpen,
  respondHarnessQuestion,
  type ApprovalDecision,
  type UserQuestionReply,
} from "../../../integrations/harness";
import { remoteSessionActions } from "../../../features/connections/model/remoteSessionActions";
import { remoteSessionProject } from "../../../features/connections/model/sessionMachineTarget";
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
import { toast } from "../../../shared/ui/ToastRegion";
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
  onSelectRemoteSession?: (project: string, remoteSessionId: string) => Promise<boolean>;
  /** Closes the full-screen surfaces (search, inbox, ...) that would cover the conversation. */
  closeSurfaces?: () => void;
  workspaceNavigation?: { cancel: () => void; captureRequest: () => () => boolean };
}

/** Approval, question reply/interaction and open-approval-session callbacks. Verbatim bodies. */
export function useApprovalActions(deps: ApprovalActionDeps) {
  const { sessionsRef, setInspectedWorkerId, focusOpenSession, onSelectHistorySession } = deps;
  const { ensureOpenSession, liveAgents, unopenedRemoteRef, dismissRemoteFinished } = deps;
  const { onSelectRemoteSession, closeSurfaces } = deps;
  const cancelNavigation = deps.workspaceNavigation?.cancel;
  const captureNavigation = deps.workspaceNavigation?.captureRequest;

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
      allowForSession?: true,
    ) => {
      pruneApprovalIntents(sessionsRef.current);
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      return submitApprovalIntent(
        session,
        requestId,
        decision,
        expected,
        () => sessionsRef.current.find((current) => current.id === sessionId),
        allowForSession,
      );
    },
    [sessionsRef],
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
      if (hostSessionBinding(session) || remoteSessionProject(session)) {
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
    [sessionsRef],
  );

  const onQuestionInteraction = useCallback(
    (sessionId: string, requestId: number) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (session && (hostSessionBinding(session) || remoteSessionProject(session))) return;
      if (session && !session.worktreeRemoved)
        keepHarnessQuestionOpen(liveTurnHarness(session), sessionId, requestId);
    },
    [sessionsRef],
  );

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
        const live = liveAgents?.find((agent) => agent.id === ownerId);
        if (live?.ownerWindowLabel) {
          if (locked(live.cwd)) return false;
          cancelNavigation?.();
          try {
            await focusWindowLiveAgent(live);
            return true;
          } catch (error) {
            toast.show({
              tone: "warning",
              title: t("Could not switch to the window that has this conversation"),
              message: workspaceFailureDetail(error),
            });
            return false;
          }
        }
        const known = sessionsRef.current.find((session) => session.id === ownerId);
        const remoteProject = live?.listedRemote
          ? live.cwd
          : !known
            ? unopenedRemoteRef?.current.find(({ session }) => session.id === ownerId)?.project
            : undefined;
        if (remoteProject && onSelectRemoteSession) {
          if (locked(remoteProject)) return false;
          closeSurfaces?.();
          const opened = await onSelectRemoteSession(remoteProject, ownerId);
          if (opened) dismissRemoteFinished?.(ownerId);
          return opened;
        }
        if (known && locked(known.cwd)) return false;
        cancelNavigation?.();
        const isCurrent = captureNavigation?.();
        const session = known ?? (await ensureOpenSession?.(ownerId));
        if (isCurrent && !isCurrent()) return false;
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
      cancelNavigation,
      captureNavigation,
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
        const parentsOf = (session: Session) =>
          sessionsRef.current.filter(
            (parent) => !parent.inboxAsk && isDelegatedChildOf(session, parent),
          );
        let parents = parentsOf(child);
        // A subagent's own subagent opens in the conversation that owns its parent.
        if (parents.length === 1 && delegationParentOf(parents[0])) parents = parentsOf(parents[0]);
        if (child.inboxAsk || parents.length !== 1 || !focusOpenSession(parents[0].id)) return;
        closeSurfaces?.();
        requestViewDelegated(parents[0].id, child.id);
        return;
      }
      const ownerId = ownerOf(sessionId);
      if (!focusOpenSession(ownerId)) return;
      closeSurfaces?.();
      if (ownerId !== sessionId) setInspectedWorkerId(sessionId);
    },
    [closeSurfaces, focusOpenSession, ownerOf, sessionsRef, setInspectedWorkerId],
  );

  return {
    onApproval,
    onQuestionReply,
    onQuestionInteraction,
    onOpenApprovalSession,
    onFocusOwnedApprovalSession,
  };
}
