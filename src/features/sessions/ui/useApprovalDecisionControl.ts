import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  remoteSessionActionsObservation,
  subscribeRemoteSessionActions,
} from "../../connections/public/remoteSessionActions";
import type { ApprovalDecision } from "../../../integrations/harness";
import { useT } from "../../../shared/i18n";
import { useParentInputsClosed } from "../data/parentInputClosure";
import {
  APPROVAL_INTENT_MESSAGES,
  captureApprovalRequest,
  readApprovalIntent,
  readApprovalRefusal,
  useApprovalIntent,
  useApprovalRequestBlocked,
} from "../model/approvalIntents";
import type { Block, Session } from "../model/session";
import type { ApprovalDispatch } from "./ApprovalDecisionContext";

export function useApprovalDecisionControl(
  session: Session,
  requestId: number,
  dispatch: ApprovalDispatch,
  expectedBlock?: Block,
) {
  const t = useT();
  const intent = useApprovalIntent(session, requestId);
  const retainedRequestBlocked = useApprovalRequestBlocked(session.id, requestId);
  const closed = useParentInputsClosed(undefined, "profile");
  const remoteSource = useMemo(
    () => ({
      subscribe: (listener: () => void) => subscribeRemoteSessionActions(session.id, listener),
      read: () => remoteSessionActionsObservation(session.id),
    }),
    [session.id],
  );
  const sourceObservation = useSyncExternalStore(
    remoteSource.subscribe,
    remoteSource.read,
    remoteSource.read,
  );
  const expected = useMemo(
    () => captureApprovalRequest(session, requestId, expectedBlock),
    [session, requestId, expectedBlock, sourceObservation],
  );
  const occurrence =
    expectedBlock?.approval ??
    session.blocks.find(
      (block) => block.approval?.requestId === requestId && !block.approval.decided,
    )?.approval;
  const running = useRef(false);
  const [local, setLocal] = useState<{
    occurrence: typeof occurrence;
    decision: ApprovalDecision;
    pending: boolean;
    unconfirmed: boolean;
    error: string | null;
  } | null>(null);
  const current = local?.occurrence === occurrence ? local : null;
  const pending = intent?.phase === "pending" || !!current?.pending;
  const repeatBlocked = retainedRequestBlocked || !!intent?.repeatBlocked || !!current?.unconfirmed;
  const feedback = pending
    ? t("Sending decision…")
    : repeatBlocked
      ? t(APPROVAL_INTENT_MESSAGES.unconfirmed)
      : intent?.error
        ? t(intent.error)
        : current?.error
          ? t(current.error)
          : closed
            ? t(APPROVAL_INTENT_MESSAGES.closed)
            : null;
  const danger = !pending && !repeatBlocked && !!(intent?.error || current?.error);
  const decide = async (decision: ApprovalDecision) => {
    if (running.current || pending || repeatBlocked || closed) return;
    if (!expected) {
      setLocal({
        occurrence,
        decision,
        pending: false,
        unconfirmed: false,
        error: APPROVAL_INTENT_MESSAGES.changed,
      });
      return;
    }
    running.current = true;
    setLocal({ occurrence, decision, pending: true, unconfirmed: false, error: null });
    try {
      const result = await dispatch(session.id, requestId, decision, expected);
      const actual = readApprovalIntent(session, requestId);
      setLocal({
        occurrence,
        decision,
        pending: false,
        unconfirmed: !!actual?.repeatBlocked || (result !== false && !actual),
        error:
          result === false && !actual
            ? (readApprovalRefusal(expected) ??
              "Decision was not sent. Check the request and try again.")
            : null,
      });
    } catch {
      // A thrown callback may already have dispatched. Keep the original choice
      // and never present that ambiguity as permission to repeat the decision.
      setLocal({ occurrence, decision, pending: false, unconfirmed: true, error: null });
    } finally {
      running.current = false;
    }
  };
  return {
    pending,
    blocked: pending || repeatBlocked || closed,
    decision: intent?.decision ?? current?.decision,
    feedback,
    danger,
    decide,
  };
}
