import {
  ownerApprovalsSnapshot,
  subscribeOwnerApprovals,
} from "../../../features/notifications/model/ownerApprovals";
import {
  setSessions,
  subscribeSessionCommits,
} from "../../../features/sessions/model/sessionsStore";

/** Project transient native approvals into session status without changing provider transcripts. */
export function startOwnerApprovalSessions(): () => void {
  const sync = () => {
    const ids = new Set(ownerApprovalsSnapshot().map((request) => request.sessionId));
    setSessions((sessions) => {
      let changed = false;
      const next = sessions.map((session) => {
        const pending = !session.worktreeRemoved && ids.has(session.id);
        if (!!session.pendingOwnerApproval === pending) return session;
        changed = true;
        return { ...session, pendingOwnerApproval: pending || undefined };
      });
      return changed ? next : sessions;
    });
  };
  const stopApprovals = subscribeOwnerApprovals(sync);
  // Host snapshots and restored sessions must retain the current local approval projection.
  const stopSessions = subscribeSessionCommits(sync);
  sync();
  return () => {
    stopApprovals();
    stopSessions();
  };
}
