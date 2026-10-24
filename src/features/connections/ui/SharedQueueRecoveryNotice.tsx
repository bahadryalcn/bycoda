import { useState, useSyncExternalStore } from "react";
import { Alert } from "../../../shared/ui/Alert";
import { DeliveryReviewChoice } from "../../sessions/ui/DeliveryReviewChoice";
import { resumeSharedLocalQueue, useLocalSharedQueueClient } from "../model/useSharedLocalQueues";
import { t, useLocale } from "../../../shared/i18n";
import {
  useDeliveryReviewRequest,
  useLateSettlementPossible,
} from "../../sessions/model/deliveryReview";
import {
  readDeliveryProgress,
  updateDeliveryProgress,
} from "../../sessions/model/deliveryProgress";

const empty = { recovery: undefined as string | undefined, error: undefined as string | undefined };
const subscribe = () => () => {};

/** Recovery is a decision about prior delivery, never permission to replay a request. */
export function SharedQueueRecoveryNotice({ sessionId }: { sessionId: string }) {
  useLocale();
  const client = useLocalSharedQueueClient(sessionId);
  const state = useSyncExternalStore<{ recovery?: string; error?: string }>(
    client?.subscribe ?? subscribe,
    client?.snapshot ?? (() => empty),
  );
  const focusRequest = useDeliveryReviewRequest(sessionId);
  const lateSettlement = useLateSettlementPossible(sessionId);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  if (!client || !state.recovery) return null;
  const choose = async (outcome: "delivered" | "retry" | "keep" | "discard") => {
    if (working) return;
    setWorking(true);
    setError(undefined);
    const recoveryId = client.snapshot().queue.claim?.id;
    try {
      // Delivered and discarded both take the row out; neither sends it again.
      await client.resolveRecovery(outcome === "delivered" || outcome === "discard");
      // "Send again" is the owner saying it never arrived: keep the row and let the queue drain.
      if (outcome === "retry" && (await resumeSharedLocalQueue(sessionId)) === "late")
        throw new Error(
          t(
            "The provider has not answered yet and may still deliver this message. Wait for the answer, or stop the turn.",
          ),
        );
      const progress = recoveryId ? readDeliveryProgress(sessionId, recoveryId) : undefined;
      if (progress && outcome !== "retry")
        updateDeliveryProgress(
          sessionId,
          progress,
          outcome === "keep" ? "rejected" : "accepted",
          outcome === "delivered"
            ? t("Marked as delivered. The message was not sent again.")
            : outcome === "discard"
              ? t("Discarded. The message was not sent.")
              : t("The queue is paused. Resume it only after checking the conversation."),
        );
    } catch (reason) {
      setError(String(reason).replace(/^Error: /, ""));
    } finally {
      setWorking(false);
    }
  };
  return (
    <Alert tone="warning" role="alert" inline className="shrink-0">
      <div className="text-ui-caption">
        {t("Queued delivery is unknown. Sending is held for review.")}
      </div>
      <DeliveryReviewChoice
        text={state.recovery}
        working={working}
        lateSettlement={lateSettlement}
        focusRequest={focusRequest}
        onChoose={(outcome) => void choose(outcome)}
      />
      {error ? (
        <div className="mt-1 text-ui-caption text-(--ui-tone-danger-fg)">{error}</div>
      ) : null}
    </Alert>
  );
}
