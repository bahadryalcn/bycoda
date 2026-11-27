import { useSyncExternalStore } from "react";
import { useT } from "../../../shared/i18n";
import {
  ownerApprovalsSnapshot,
  ownerRequestTitle,
  ownerSecretInputsSnapshot,
  subscribeOwnerApprovals,
  subscribeOwnerSecretInputs,
} from "../../notifications";

/** A live owner request as the sheet lists it: what it asks and a deadline, never its content. */
export type OwnerRequestRow = {
  key: string;
  /** Approvals open in the shared dialog; secret inputs are answered where they ask. */
  kind: "approval" | "secret";
  /** What is asked, without the native source prefix; an Inbox write names its target. */
  title: string;
  deadline: number;
  /** The conversation that answers it; absent for the shared confirmation. */
  sessionId?: string;
  /** The Assistant Room that asked, when no conversation did. */
  threadId?: string;
  /** The project the request acts on, for Room requests without a conversation. */
  cwd?: string;
};

/** Live application approvals and secret inputs for the Pending list; each logs its own outcome. */
export function useOwnerNotifications(): OwnerRequestRow[] {
  const t = useT();
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
      kind: "approval" as const,
      title: request.inbox
        ? `${ownerRequestTitle(request, t)} · ${request.inbox.target}`
        : ownerRequestTitle(request, t),
      deadline: request.deadline,
      sessionId: request.sessionId,
      threadId: request.threadId,
      cwd: request.cwd,
    })),
    ...secrets.map((request) => ({
      key: `owner-secret:${request.id}`,
      kind: "secret" as const,
      title: ownerRequestTitle(request, t),
      deadline: request.deadline,
      sessionId: request.sessionId,
      threadId: request.threadId,
      cwd: request.cwd,
    })),
  ];
}
