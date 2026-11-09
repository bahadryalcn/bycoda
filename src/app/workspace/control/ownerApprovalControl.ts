import type { Session } from "../../../features/sessions/model/session";
import { getGroupLockView, subscribeGroupLock } from "../../../features/group-lock/model/groupLock";
import { isProjectLockedIn } from "../../../features/group-lock/model/lockState";
import {
  requestOwnerApproval,
  abandonOwnerApproval,
} from "../../../features/notifications/model/ownerApprovals";
import {
  abandonOwnerSecretInput,
  requestOwnerSecretInput,
} from "../../../features/notifications/model/ownerSecretInputs";

export type AppControlRequest = {
  id: string;
  namespace: string;
  sessionId: string;
  threadId?: string;
  environmentId?: string;
  projectId?: string | null;
  targetProjectCwd?: string | null;
  requestId: string;
  action: string;
  input: Record<string, unknown>;
};

export function handleOwnerApprovalControl(
  payload: { namespace: string; id: string; sessionId?: unknown; input: Record<string, unknown> },
  sessions: () => readonly Pick<Session, "id" | "cwd">[],
  disposed: () => boolean,
) {
  if (payload.namespace === "owner-approval-ended") return abandonOwnerApproval(payload.id);
  if (payload.namespace === "owner-secret-ended") return abandonOwnerSecretInput(payload.id);
  if (payload.namespace !== "owner-approval" && payload.namespace !== "owner-secret")
    throw new Error("Unsupported approval request.");
  const originalLock = getGroupLockView().lock;
  const allowed = () => {
    if (!payload.sessionId) return !disposed() && getGroupLockView().lock === originalLock;
    const source = sessions().find((session) => session.id === payload.sessionId);
    return !disposed() && !!source && !isProjectLockedIn(getGroupLockView().lock, source.cwd);
  };
  if (payload.namespace === "owner-secret")
    return requestOwnerSecretInput(payload, allowed, subscribeGroupLock);
  return requestOwnerApproval(payload, allowed, subscribeGroupLock);
}
