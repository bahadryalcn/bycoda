import { useEffect, useState } from "react";
import { useT } from "../../../shared/i18n";
import { InlineMessage } from "../../../shared/ui/InlineError";

/** Keep each removal recoverable, including several quick removals and failed restores. */
export function QueueRemovalNotice({
  id,
  onUndo,
  onDismiss,
  disabled,
  disabledReason,
}: {
  id: string;
  onUndo: () => Promise<boolean>;
  onDismiss: (id: string) => void;
  disabled: boolean;
  /** Shown while `disabled`, naming why Undo is unavailable. */
  disabledReason?: string;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (pending || failed || focused || disabled) return;
    const timer = window.setTimeout(() => onDismiss(id), 5000);
    return () => window.clearTimeout(timer);
  }, [pending, failed, focused, disabled, onDismiss, id]);
  return (
    <InlineMessage
      tone="neutral"
      icon={null}
      inset="row"
      data-queue-removal
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      action={{
        label: t("Undo"),
        pending,
        disabled,
        disabledReason,
        onClick: () => {
          setPending(true);
          void onUndo()
            .then((restored) => {
              if (restored) onDismiss(id);
              else setFailed(true);
            })
            .catch(() => setFailed(true))
            .finally(() => setPending(false));
        },
      }}
    >
      {t("Message removed")}
    </InlineMessage>
  );
}
