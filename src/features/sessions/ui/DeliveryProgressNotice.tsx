import { presentRemoteError } from "../../connections/public/remoteFailure";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { Spinner } from "../../../shared/ui/Spinner";
import { Text } from "../../../shared/ui/Text";
import { useEffect, useState, useSyncExternalStore } from "react";
import { DeliveryReviewChoice, type DeliveryReviewOutcome } from "./DeliveryReviewChoice";
import { useT } from "../../../shared/i18n";
import { Alert, type AlertTone } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { InlineError } from "../../../shared/ui/InlineError";
import { Check, TriangleAlert } from "../../../shared/ui/icons";
import { LiveText } from "../../../shared/ui/LiveText";
import { nextQueueStatus } from "../../connections/public/queueState";
import {
  deliveryResolverFor,
  useDeliveryReviewRequest,
  useLateSettlementPossible,
  useQueueHoldReason,
} from "../model/deliveryReview";
import {
  deliveryNoticeKey,
  dismissDeliveryNotice,
  reopenDeliveryNotice,
  useDeliveryNoticeDismissed,
} from "../model/deliveryNoticeDismissal";
import { deliveryFailureSentence } from "../model/deliveryFailureText";
import { getSessions, setSessions } from "../model/sessionsStore";
import type { QueuedMessage } from "../model/session";
import {
  beginDeliveryProgress,
  clearDeliveryProgress,
  readDeliveryProgress,
  subscribeDeliveryProgress,
  updateDeliveryProgress,
  type DeliveryStage,
} from "../model/deliveryProgress";
import { useLocalSharedQueueClient } from "../../connections/public/useSharedLocalQueues";

const noSubscribe = () => () => {};
const noClientState = { queue: { claim: undefined as { id: string } | undefined } };

export function useDeliveryProgress(sessionId = "") {
  return useSyncExternalStore(subscribeDeliveryProgress, () => readDeliveryProgress(sessionId));
}
const labels: Record<DeliveryStage, string> = {
  syncing: "Synchronizing the message queue…",
  claiming: "Waiting for queue ownership…",
  preparing: "Preparing the message and attachments…",
  provider: "Waiting for the provider to be ready…",
  confirming: "Sending the message. Waiting for provider confirmation…",
  accepted: "Message accepted. Follow its progress in the conversation.",
  rejected: "Queue paused: the last message was not accepted",
  unknown: "Delivery is not confirmed. Automatic resend is held.",
  waiting: "Not sent yet. The message stays queued and is retried automatically.",
};
export const deliveryIsPending = (stage?: DeliveryStage) =>
  !!stage && !["accepted", "rejected", "unknown", "waiting"].includes(stage);

const noticeTone = (stage: DeliveryStage, noticeOnly?: boolean): AlertTone =>
  stage === "accepted" ? "success" : stage === "rejected" && !noticeOnly ? "danger" : "warning";

/** Which notice (if any) the session shows now, and whether the owner closed it. */
function useDeliveryNoticeState(sessionId: string, messages: QueuedMessage[]) {
  const progress = useDeliveryProgress(sessionId);
  const holdReason = useQueueHoldReason(sessionId);
  const focusRequest = useDeliveryReviewRequest(sessionId);
  const unknownRow = messages.find((row) => row.deliveryUnknown);
  const holdDetail =
    holdReason && holdReason !== "stopped" && messages.length > 0 ? holdReason : undefined;
  const pending = deliveryIsPending(progress?.stage);
  const present =
    !pending &&
    ((progress && (progress.stage !== "accepted" || progress.noticeOnly)) ||
      unknownRow ||
      (!progress && holdDetail));
  const stage: DeliveryStage = unknownRow ? "unknown" : (progress?.stage ?? "rejected");
  const key = present
    ? deliveryNoticeKey(
        sessionId,
        progress ? `op${progress.operationId}` : unknownRow ? `row${unknownRow.id}` : "hold",
      )
    : undefined;
  const dismissed = useDeliveryNoticeDismissed(key, focusRequest);
  return {
    progress,
    unknownRow,
    holdDetail,
    stage,
    key,
    present: !!present,
    dismissed,
    focusRequest,
  };
}

/** Icon button in the queue header that brings back a closed delivery notice. */
export function DeliveryNoticeReopen({
  sessionId = "",
  messages,
}: {
  sessionId?: string;
  messages: QueuedMessage[];
}) {
  const t = useT();
  const state = useDeliveryNoticeState(sessionId, messages);
  if (!state.key || !state.dismissed || state.stage === "accepted") return null;
  const key = state.key;
  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      iconOnly
      label={t("Show delivery notice")}
      className="shrink-0"
      data-delivery-notice-reopen=""
      onClick={() => reopenDeliveryNotice(key)}
    >
      <TriangleAlert className="icon-sm" aria-hidden="true" />
    </Button>
  );
}

/** Compact, session-owned indication; acceptance is not turn completion. */
export function DeliveryProgressIndicator({ sessionId = "" }: { sessionId?: string }) {
  const t = useT();
  const progress = useDeliveryProgress(sessionId);
  if (
    !progress ||
    (!deliveryIsPending(progress.stage) && (progress.stage !== "accepted" || progress.noticeOnly))
  )
    return null;
  const pending = deliveryIsPending(progress.stage);
  const label = t(labels[progress.stage]);
  return (
    <Tooltip label={label} asChild>
      <Text
        size="inherit"
        tone={pending ? "muted" : "success"}
        data-delivery-accepted={pending ? undefined : ""}
        data-delivery-pending={pending ? "" : undefined}
        className={pending ? undefined : "delivery-accepted"}
      >
        {pending ? <Spinner size="sm" /> : <Check className="icon-sm" aria-hidden="true" />}
        <LiveText className="sr-only" text={label} />
      </Text>
    </Tooltip>
  );
}

/** Remains meaningful across composer remounts; unknown rows also survive restart. */
export function DeliveryProgressNotice({
  sessionId = "",
  messages,
}: {
  sessionId?: string;
  messages: QueuedMessage[];
}) {
  const t = useT();
  const { progress, unknownRow, holdDetail, stage, key, present, dismissed, focusRequest } =
    useDeliveryNoticeState(sessionId, messages);
  const client = useLocalSharedQueueClient(sessionId);
  const clientState = useSyncExternalStore<{ queue: { claim?: { id: string } } }>(
    client?.subscribe ?? noSubscribe,
    client?.snapshot ?? (() => noClientState),
  );
  const [working, setWorking] = useState(false);
  const [resolveError, setResolveError] = useState<string>();
  const lateSettlement = useLateSettlementPossible(sessionId);
  // Effect reason: an accepted notice is obsolete after a short moment; clear it from the store.
  useEffect(() => {
    if (!progress || progress.stage !== "accepted") return;
    const timer = window.setTimeout(() => clearDeliveryProgress(sessionId, progress), 1800);
    return () => window.clearTimeout(timer);
  }, [sessionId, progress]);
  // Effect reason: a rejected or unknown notice for a row that left the queue is obsolete; clear it.
  useEffect(() => {
    if (
      !progress ||
      !["rejected", "unknown"].includes(progress.stage) ||
      messages.some((row) => row.id === progress.messageId) ||
      clientState.queue.claim?.id === progress.messageId
    )
      return;
    const timer = window.setTimeout(() => {
      // Read the store after batched parent updates before clearing an obsolete
      // warning. This must not erase a follow-up that is only now being held.
      if (
        getSessions()
          .find((session) => session.id === sessionId)
          ?.queuedMessages?.some((row) => row.id === progress.messageId) ||
        client?.snapshot().queue.claim?.id === progress.messageId
      )
        return;
      clearDeliveryProgress(sessionId, progress);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [sessionId, progress, messages, client, clientState]);
  if (!present || !key || dismissed) return null;
  const noticeOnly = !!progress?.noticeOnly;
  // A recorded outcome is already a plain sentence; a failure keeps its raw text behind details.
  const raw = noticeOnly || unknownRow ? undefined : (progress?.detail ?? holdDetail);
  const title = noticeOnly && progress?.detail ? t(progress.detail) : t(labels[stage]);
  const body = raw ? deliveryFailureSentence(raw, t) : undefined;
  const technical = raw && raw.trim() !== body ? raw : undefined;
  const outcomeText = (outcome: DeliveryReviewOutcome) =>
    outcome === "delivered"
      ? t("Marked as delivered. The message was not sent again.")
      : outcome === "discard"
        ? t("Discarded. The message was not sent.")
        : outcome === "retry"
          ? t("The message is queued to send again.")
          : t("The queue is paused. Resume it only after checking the conversation.");
  const choose = (outcome: DeliveryReviewOutcome) => {
    if (!unknownRow || working) return;
    // Shared claimed sends use the existing durable recovery notice instead.
    if (client?.snapshot().queue.claim) return;
    const removed = outcome === "delivered" || outcome === "discard";
    const finish = () => {
      const owner =
        readDeliveryProgress(sessionId, unknownRow.id) ??
        beginDeliveryProgress(sessionId, unknownRow.id, "unknown");
      updateDeliveryProgress(
        sessionId,
        owner,
        removed ? "accepted" : "rejected",
        outcomeText(outcome),
        true,
      );
    };
    // A pane showing another computer's queue decides through the shared queue.
    const resolver = deliveryResolverFor(sessionId);
    if (resolver) {
      setWorking(true);
      setResolveError(undefined);
      void resolver(unknownRow.id, outcome)
        .then(finish)
        .catch((reason) => setResolveError(presentRemoteError(reason, { explicit: true })))
        .finally(() => setWorking(false));
      return;
    }
    setSessions((sessions) =>
      sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              // Sending again is the owner's decision that it never arrived.
              queueStatus: outcome === "retry" ? "active" : nextQueueStatus(undefined, "unknown"),
              queuedMessages: removed
                ? session.queuedMessages?.filter((row) => row.id !== unknownRow.id)
                : session.queuedMessages?.map((row) =>
                    row.id === unknownRow.id ? { ...row, deliveryUnknown: undefined } : row,
                  ),
            }
          : session,
      ),
    );
    finish();
  };
  const hasChildren = !!body || (unknownRow && !clientState.queue.claim) || !!resolveError;
  return (
    // In-pane overlay at the top centre; only the card takes pointer events.
    <div className="pointer-events-none absolute inset-x-0 top-2 z-(--layer-pane-sheet) flex justify-center px-2">
      <Alert
        key={key}
        open
        className="pointer-events-auto w-full max-w-md"
        tone={noticeTone(stage, noticeOnly)}
        title={title}
        data-delivery-progress={stage}
        onDismiss={() => dismissDeliveryNotice(key, focusRequest)}
        extra={technical ? <ErrorDetails detail={technical} title={title} /> : undefined}
      >
        {hasChildren ? (
          <>
            {body ? (
              <Text as="p" size="inherit" className="min-w-0 [overflow-wrap:anywhere]">
                {body}
              </Text>
            ) : null}
            {unknownRow && !clientState.queue.claim ? (
              <DeliveryReviewChoice
                text={unknownRow.text}
                working={working}
                lateSettlement={lateSettlement}
                focusRequest={focusRequest}
                onChoose={choose}
              />
            ) : null}
            {resolveError ? <InlineError className="mt-1">{resolveError}</InlineError> : null}
          </>
        ) : null}
      </Alert>
    </div>
  );
}
