import { useEffect, useState, useSyncExternalStore } from "react";
import { DeliveryReviewChoice, type DeliveryReviewOutcome } from "./DeliveryReviewChoice";
import { useT } from "../../../shared/i18n";
import { InlineError } from "../../../shared/ui/InlineError";
import { Check, CircleDashed } from "../../../shared/ui/icons";
import { LiveText } from "../../../shared/ui/LiveText";
import { nextQueueStatus } from "../../connections/public/queueState";
import {
  deliveryResolverFor,
  useDeliveryReviewRequest,
  useLateSettlementPossible,
} from "../model/deliveryReview";
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
};
export const deliveryIsPending = (stage?: DeliveryStage) =>
  !!stage && !["accepted", "rejected", "unknown"].includes(stage);

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
    <span
      data-delivery-accepted={pending ? undefined : ""}
      data-delivery-pending={pending ? "" : undefined}
      className={
        pending ? "text-(--ui-text-muted)" : "delivery-accepted text-(--ui-tone-success-fg)"
      }
      title={label}
    >
      {pending ? (
        <CircleDashed
          className="icon-sm animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : (
        <Check className="icon-sm" aria-hidden="true" />
      )}
      <LiveText className="sr-only" text={label} />
    </span>
  );
}

/** Remains meaningful across composer remounts; unknown rows also survive restart. */
export function DeliveryProgressNotice({
  sessionId = "",
  messages,
  embedded = false,
}: {
  sessionId?: string;
  messages: QueuedMessage[];
  embedded?: boolean;
}) {
  const t = useT();
  const progress = useDeliveryProgress(sessionId);
  const client = useLocalSharedQueueClient(sessionId);
  const clientState = useSyncExternalStore<{ queue: { claim?: { id: string } } }>(
    client?.subscribe ?? noSubscribe,
    client?.snapshot ?? (() => noClientState),
  );
  const [working, setWorking] = useState(false);
  const [resolveError, setResolveError] = useState<string>();
  const focusRequest = useDeliveryReviewRequest(sessionId);
  const lateSettlement = useLateSettlementPossible(sessionId);
  const unknownRow = messages.find((row) => row.deliveryUnknown);
  const pending = deliveryIsPending(progress?.stage);
  useEffect(() => {
    if (!progress || progress.stage !== "accepted") return;
    const timer = window.setTimeout(() => clearDeliveryProgress(sessionId, progress), 1800);
    return () => window.clearTimeout(timer);
  }, [sessionId, progress]);
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
  if (
    (!progress && !unknownRow) ||
    (progress?.stage === "accepted" && !progress.noticeOnly && !unknownRow) ||
    pending
  )
    return null;
  const stage = unknownRow && !pending ? "unknown" : (progress?.stage ?? "unknown");
  const failure = stage === "rejected" ? progress?.detail : undefined;
  const summary = failure?.split(/\r?\n/, 1)[0] || labels[stage];
  const expandedDetail =
    progress?.detail &&
    !unknownRow &&
    (failure ? failure.length > 180 || failure.includes("\n") : progress.detail !== labels[stage]);
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
        .catch((reason) => setResolveError(String(reason).replace(/^Error: /, "")))
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
  return (
    <div
      className={`${embedded ? "px-1" : "px-4"} py-1 text-ui-caption text-(--ui-text-secondary)`}
      data-delivery-progress={stage}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <LiveText
          className="min-w-0 flex-1 line-clamp-2 [overflow-wrap:anywhere]"
          text={t(summary)}
          mode={stage === "rejected" ? "assertive" : "polite"}
        />
      </div>
      {expandedDetail ? (
        <details className="mt-1 min-w-0 text-(--ui-text-muted)" data-delivery-details>
          <summary className="w-fit cursor-pointer text-ui-caption">{t("Details")}</summary>
          <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {t(progress!.detail!)}
          </p>
        </details>
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
    </div>
  );
}
