import { useEffect, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineMessage } from "../../../shared/ui/InlineError";

/** Keep each removal recoverable, including several quick removals and failed restores. */
export function QueueRemovalNotice({
  id,
  onUndo,
  onDismiss,
  disabled,
}: {
  id: string;
  onUndo: () => Promise<boolean>;
  onDismiss: (id: string) => void;
  disabled: boolean;
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
      className="px-1 py-1"
      data-queue-removal
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      action={
        <Button
          variant="link"
          layout="text"
          loading={pending}
          disabled={disabled}
          onClick={() => {
            setPending(true);
            void onUndo()
              .then((restored) => {
                if (restored) onDismiss(id);
                else setFailed(true);
              })
              .catch(() => setFailed(true))
              .finally(() => setPending(false));
          }}
        >
          {t("Undo")}
        </Button>
      }
    >
      {t("Message removed")}
    </InlineMessage>
  );
}
