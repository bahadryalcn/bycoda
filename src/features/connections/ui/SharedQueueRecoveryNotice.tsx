import { useState, useSyncExternalStore } from "react";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { useLocalSharedQueueClient } from "../model/useSharedLocalQueues";
import { t, useLocale } from "../../../shared/i18n";
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
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  if (!client || !state.recovery) return null;
  const resolve = async (accepted: boolean) => {
    if (working) return;
    setWorking(true);
    setError(undefined);
    const recoveryId = client.snapshot().queue.claim?.id;
    try {
      await client.resolveRecovery(accepted);
      const progress = recoveryId ? readDeliveryProgress(sessionId, recoveryId) : undefined;
      if (progress)
        updateDeliveryProgress(
          sessionId,
          progress,
          accepted ? "accepted" : "rejected",
          accepted
            ? "Marked as delivered. The message was not sent again."
            : "The queue is paused. Resume it only after checking the conversation.",
        );
      setOpen(false);
    } catch (reason) {
      setError(String(reason).replace(/^Error: /, ""));
    } finally {
      setWorking(false);
    }
  };
  return (
    <Alert tone="warning" role="alert" inline className="shrink-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{t("Queued delivery is unknown. Sending is held for review.")}</span>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {t("Review delivery")}
        </Button>
      </div>
      {open ? (
        <Modal
          title={t("Review queued delivery")}
          onClose={() => {
            if (!working) setOpen(false);
          }}
        >
          <div className="space-y-3 p-4 text-sm">
            <p>
              {t(
                "Check the conversation for this request before choosing. Keeping it queued pauses the queue and does not resend it.",
              )}
            </p>
            <p className="max-h-40 overflow-auto whitespace-pre-wrap break-words">
              {state.recovery}
            </p>
            {error ? (
              <Alert tone="danger" role="alert">
                {error}
              </Alert>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" disabled={working} onClick={() => void resolve(false)}>
                {t("Keep queued, pause")}
              </Button>
              <Button disabled={working} onClick={() => void resolve(true)}>
                {t("Already delivered")}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </Alert>
  );
}
