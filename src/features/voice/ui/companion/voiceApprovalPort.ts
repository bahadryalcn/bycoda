import { ownerApprovalsSnapshot, subscribeOwnerApprovals } from "../../../notifications";
import { setVoiceApprovalPort } from "../../model/voiceRuntimeDeadline";

/** Suspends voice tool deadlines while an owner approval is waiting for the owner. */
export function installVoiceApprovalPort(): () => void {
  const port = {
    pending: (requestId: string) =>
      ownerApprovalsSnapshot().some((approval) => approval.operationId === requestId),
    subscribe: subscribeOwnerApprovals,
  };
  setVoiceApprovalPort(port);
  return () => setVoiceApprovalPort(undefined);
}
