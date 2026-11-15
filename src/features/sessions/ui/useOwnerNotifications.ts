import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  logOwnerRequest,
  ownerApprovalsSnapshot,
  ownerSecretInputsSnapshot,
  subscribeOwnerApprovals,
  subscribeOwnerSecretInputs,
  type OwnerSecretInput,
} from "../../notifications";

/** A live owner request as the sheet lists it: a title and a deadline, never its content. */
export type OwnerRequestRow = {
  key: string;
  title: string;
  deadline: number;
  /** The conversation that answers it; absent for the shared confirmation. */
  sessionId?: string;
};

/**
 * Live application approvals and secret inputs for the Pending list. Approvals record their own
 * outcome; a secret input has no outcome event, so its disappearance is recorded here: after the
 * deadline it expired, before it the owner closed or answered it (the value is never seen).
 */
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
  const known = useRef(new Map<string, Pick<OwnerSecretInput, "title" | "deadline">>());
  // Reads the store snapshot after it changes: a request that left it ended once, so log it once.
  useEffect(() => {
    const live = new Set(secrets.map((request) => request.id));
    for (const [id, request] of known.current) {
      if (live.has(id)) continue;
      known.current.delete(id);
      logOwnerRequest({
        id,
        title: request.title,
        outcome: Date.now() >= request.deadline ? "expired" : "closed",
      });
    }
    for (const request of secrets) known.current.set(request.id, request);
  }, [secrets]);
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
