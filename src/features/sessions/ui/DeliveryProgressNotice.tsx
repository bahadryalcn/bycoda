import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { useT } from "../../../shared/i18n";
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
import { useLocalSharedQueueClient } from "../../connections/model/useSharedLocalQueues";

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
  rejected: "The message remains queued. Resolve the error before trying again.",
  unknown: "Delivery is not confirmed. Automatic resend is held.",
};
export const deliveryIsPending = (stage?: DeliveryStage) =>
  !!stage && !["accepted", "rejected", "unknown"].includes(stage);

/** Remains meaningful across composer remounts; unknown rows also survive restart. */
export function DeliveryProgressNotice({
  sessionId = "",
  messages,
}: {
  sessionId?: string;
  messages: QueuedMessage[];
}) {
  const t = useT();
  const progress = useDeliveryProgress(sessionId);
  const client = useLocalSharedQueueClient(sessionId);
  const clientState = useSyncExternalStore<{ queue: { claim?: { id: string } } }>(
    client?.subscribe ?? noSubscribe,
    client?.snapshot ?? (() => noClientState),
  );
  const [clock, setClock] = useState<{ startedAt: number; elapsed: number }>();
  const [review, setReview] = useState(false);
  const unknownRow = messages.find((row) => row.deliveryUnknown);
  const pending = deliveryIsPending(progress?.stage);
  const startedAt = progress?.startedAt;
  const elapsed = clock?.startedAt === startedAt ? (clock?.elapsed ?? 0) : 0;
  useEffect(() => {
    if (startedAt === undefined || !pending) return;
    const tick = () =>
      setClock({ startedAt, elapsed: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) });
    const initial = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [startedAt, pending]);
  useEffect(() => {
    if (!progress || progress.stage !== "accepted") return;
    const timer = window.setTimeout(() => clearDeliveryProgress(sessionId, progress), 6000);
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
  if (!progress && !unknownRow) return null;
  const stage = unknownRow && !pending ? "unknown" : (progress?.stage ?? "unknown");
  const resolve = (accepted: boolean) => {
    if (!unknownRow) return;
    // Shared claimed sends use the existing durable recovery notice instead.
    if (client?.snapshot().queue.claim) return;
    setSessions((sessions) =>
      sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              queueStatus: "paused",
              queuedMessages: accepted
                ? session.queuedMessages?.filter((row) => row.id !== unknownRow.id)
                : session.queuedMessages?.map((row) =>
                    row.id === unknownRow.id ? { ...row, deliveryUnknown: undefined } : row,
                  ),
            }
          : session,
      ),
    );
    const owner =
      readDeliveryProgress(sessionId, unknownRow.id) ??
      beginDeliveryProgress(sessionId, unknownRow.id, "unknown");
    updateDeliveryProgress(
      sessionId,
      owner,
      accepted ? "accepted" : "rejected",
      accepted
        ? "Marked as delivered. The message was not sent again."
        : "The queue is paused. Resume it only after checking the conversation.",
    );
    setReview(false);
  };
  return (
    <div className="px-4 py-1 text-xs text-(--ui-text-secondary)" data-delivery-progress={stage}>
      <div
        role={stage === "rejected" || stage === "unknown" ? "alert" : "status"}
        aria-live="polite"
      >
        {t(labels[stage])}
        {pending ? (
          <span className="ms-2 tabular-nums" aria-live="off">
            {t("{p0}s elapsed", { p0: elapsed })}
          </span>
        ) : null}
        {pending && elapsed >= 10 ? (
          <span className="ms-2">
            {t("Still waiting. Your message is retained; you do not need to write it again.")}
          </span>
        ) : null}
        {progress?.detail && !unknownRow ? <div>{t(progress.detail)}</div> : null}
      </div>
      {unknownRow && !clientState.queue.claim ? (
        <Button variant="ghost" onClick={() => setReview(true)}>
          {t("Review delivery")}
        </Button>
      ) : null}
      {review && unknownRow ? (
        <Modal title={t("Review queued delivery")} onClose={() => setReview(false)}>
          <div className="space-y-3 p-4 text-sm">
            <p>
              {t(
                "Check the conversation for this request before choosing. Keeping it queued pauses the queue and does not resend it.",
              )}
            </p>
            <p className="max-h-40 overflow-auto whitespace-pre-wrap break-words">
              {unknownRow.text}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => resolve(false)}>
                {t("Keep queued, pause")}
              </Button>
              <Button onClick={() => resolve(true)}>{t("Already delivered")}</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
