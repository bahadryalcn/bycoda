import { ownerApprovalsSnapshot, subscribeOwnerApprovals } from "../../../notifications";
import { setVoiceApprovalPort } from "../../model/voiceRuntimeDeadline";

/** Suspends voice tool deadlines while an owner approval is waiting for the owner. */
export function installVoiceApprovalPort(): () => void {
  const port = {
    pending: () => ownerApprovalsSnapshot().length > 0,
    subscribe: subscribeOwnerApprovals,
  };
  setVoiceApprovalPort(port);
  return () => setVoiceApprovalPort(undefined);
}
