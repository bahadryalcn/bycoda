import { useEffect } from "react";
import { remoteRequest } from "../../connections/public/connections";
import { startOwnerApprovalMirror } from "../model/ownerApprovalMirror";
import {
  onOwnerApprovalOutcome,
  ownerApprovalsSnapshot,
  settleOwnerApproval,
  subscribeOwnerApprovals,
} from "../model/ownerApprovals";

/**
 * Mount once in the app shell. Publishes the pending owner approvals to this computer's Host so a paired
 * phone can answer the ones that allow it, and applies those answers through the same path as a click.
 */
export function useOwnerApprovalMirror(hostId: string | undefined): void {
  useEffect(() => {
    if (!hostId) return;
    return startOwnerApprovalMirror({
      request: (method, params) => remoteRequest(hostId, method, params),
      approvals: ownerApprovalsSnapshot,
      subscribe: subscribeOwnerApprovals,
      onOutcome: onOwnerApprovalOutcome,
      settle: settleOwnerApproval,
    });
  }, [hostId]);
}
