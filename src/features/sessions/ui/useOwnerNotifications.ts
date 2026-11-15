import { useSyncExternalStore } from "react";
import {
  ownerApprovalsSnapshot,
  ownerSecretInputsSnapshot,
  subscribeOwnerApprovals,
  subscribeOwnerSecretInputs,
} from "../../notifications";

/** A live owner request as the sheet lists it: a title and a deadline, never its content. */
export type OwnerRequestRow = {
  key: string;
  title: string;
  deadline: number;
  /** The conversation that answers it; absent for the shared confirmation. */
  sessionId?: string;
};

/** Live application approvals and secret inputs for the Pending list; each logs its own outcome. */
export function useOwnerNotifications(): OwnerRequestRow[] {
  const approvals = useSyncExternalStore(
    subscribeOwnerApprovals,
    ownerApprovalsSnapshot,
    ownerApprovalsSnapshot,
  );
  const secrets = useSyncExternalStore(
    subscribeOwnerSecretInputs,
    ownerSecretInputsSnapshot,
    ownerSecretInputsSnapshot,
  );
  return [
    ...approvals.map((request) => ({
      key: `owner:${request.id}`,
      title: request.title,
      deadline: request.deadline,
      sessionId: request.sessionId,
    })),
    ...secrets.map((request) => ({
      key: `owner-secret:${request.id}`,
      title: request.title,
      deadline: request.deadline,
      sessionId: request.sessionId,
    })),
  ];
}
