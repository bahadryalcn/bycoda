import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { useT } from "../../shared/i18n";
import { Button } from "../../shared/ui/Button";
import { TransientNotice } from "../../shared/ui/TransientNotice";

interface BootRestoreActions {
  /** One more read of the saved layout; true when it can be read now. */
  canRead: () => Promise<boolean>;
  /** The person chose to work in the seed layout. */
  startFresh: () => void;
}

function BootRestoreNotice({
  canRead,
  startFresh,
  onClose,
}: BootRestoreActions & { onClose: () => void }) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [stillFailing, setStillFailing] = useState(false);
  const retry = async () => {
    if (pending) return;
    setPending(true);
    const readable = await canRead();
    if (readable) {
      // A fresh start reads the saved layout again, before anything is saved.
      window.location.reload();
      return;
    }
    setStillFailing(true);
    setPending(false);
  };
  return (
    <TransientNotice
      tone="warning"
      title={t("Could not restore your tabs")}
      message={
        stillFailing
          ? t("The saved layout is still unreadable. It was not changed. Try again in a moment.")
          : t(
              "Your saved layout was not changed. Retry to restore it, or start fresh in this window.",
            )
      }
      durationMs={null}
      action={{ label: t("Retry"), onClick: () => void retry(), pending }}
      actions={
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            startFresh();
            onClose();
          }}
        >
          {t("Start fresh")}
        </Button>
      }
      onDismiss={onClose}
    />
  );
}

/** Mounted on its own: it must show even when the workspace itself is not up yet. */
export function showBootRestoreNotice(actions: BootRestoreActions): void {
  if (typeof document === "undefined") return;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const close = () =>
    queueMicrotask(() => {
      root.unmount();
      host.remove();
    });
  root.render(createElement(BootRestoreNotice, { ...actions, onClose: close }));
}
