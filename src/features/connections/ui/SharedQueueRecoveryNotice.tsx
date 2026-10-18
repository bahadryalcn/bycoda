import { useState, useSyncExternalStore } from "react";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { useLocalSharedQueueClient } from "../model/useSharedLocalQueues";
import { t, useLocale } from "../../../shared/i18n";

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
    try {
      await client.resolveRecovery(accepted);
      setOpen(false);
    } catch (reason) {
      setError(String(reason).replace(/^Error: /, ""));
    } finally {
      setWorking(false);
    }
  };
  return (
    <div
      role="alert"
      className="shrink-0 border-b border-stroke px-4 py-2 text-xs text-(--ui-text-muted)"
    >
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
            {error ? <p role="alert">{error}</p> : null}
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
    </div>
  );
}
