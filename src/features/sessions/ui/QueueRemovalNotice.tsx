import { useEffect, useState } from "react";
import { useT } from "../../../shared/i18n";
import { LiveText } from "../../../shared/ui/LiveText";
import { Text } from "../../../shared/ui/Text";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { NoticeActionButton } from "./TranscriptNotice";

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
    <Text
      as="div"
      size="caption"
      tone="secondary"
      data-queue-removal
      {...surfaceAttributes(
        { frame: "card", radius: "card" },
        "flex min-h-9 items-center justify-between gap-2 ps-3 pe-1",
      )}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <LiveText className="min-w-0 break-words" text={t("Message removed")} />
      <NoticeActionButton
        quiet
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
      />
    </Text>
  );
}
