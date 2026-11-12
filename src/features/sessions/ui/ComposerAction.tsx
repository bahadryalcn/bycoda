import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ArrowUp, ListEnd, Square } from "../../../shared/ui/icons";

export function ComposerAction({
  busy,
  submitting = null,
  disabled = false,
  hasValue,
  allowBusySubmit = true,
  label: labelProp,
  busyLabel,
  blockedReason,
  onSend,
  onQueue,
  queueShortcut,
  stopShortcut = "Esc",
  stopping = false,
  onStop,
}: {
  busy: boolean;
  /** Submission can wait for attachments independently of the running turn. */
  submitting?: "send" | "queue" | null;
  disabled?: boolean;
  hasValue: boolean;
  allowBusySubmit?: boolean;
  label?: string;
  /** Describes the existing follow-up route without changing send behavior. */
  busyLabel?: string;
  /** Shown instead of the label while Send cannot reach its destination. */
  blockedReason?: string;
  onSend: () => void;
  /** Queue the message behind the running turn; only offered while one runs. */
  onQueue?: () => void;
  queueShortcut?: string | null;
  stopShortcut?: string | null;
  /** Stop was requested and the provider has not confirmed yet. */
  stopping?: boolean;
  onStop: () => void;
}) {
  const t = useT();
  const label = labelProp ?? t("Send");
  if (disabled && !busy && !submitting) {
    return (
      <Button
        variant="primary"
        tone="accent"
        motion="none"
        iconOnly
        label={blockedReason ? `${label}. ${blockedReason}` : label}
        tooltip={blockedReason}
        shortcut={blockedReason ? null : "Enter"}
        aria-description={blockedReason}
        disabled
      >
        <ArrowUp className="icon-sm" strokeWidth={2} />
      </Button>
    );
  }
  if (busy) {
    return (
      <>
        {(hasValue && allowBusySubmit && !disabled) || submitting ? (
          <>
            {onQueue ? (
              <Button
                motion="none"
                iconOnly
                label={t("Queue message")}
                tooltip={t("Queue message for when this turn finishes")}
                shortcut={queueShortcut}
                data-usage-guide="queue-button"
                loading={submitting === "queue"}
                loadingLabel={t("Sending…")}
                disabled={submitting === "send"}
                onClick={onQueue}
              >
                <ListEnd className="icon-sm" strokeWidth={1.75} />
              </Button>
            ) : null}
            <Button
              variant="primary"
              tone="accent"
              motion="none"
              iconOnly={!busyLabel}
              label={label}
              shortcut="Enter"
              aria-description={busyLabel}
              loading={submitting === "send"}
              loadingLabel={t("Sending…")}
              disabled={submitting === "queue"}
              startIcon={busyLabel ? <ArrowUp className="icon-sm" strokeWidth={2} /> : undefined}
              onClick={onSend}
            >
              {busyLabel ? (
                <span>{busyLabel}</span>
              ) : (
                <ArrowUp className="icon-sm" strokeWidth={2} />
              )}
            </Button>
          </>
        ) : null}
        <Button
          variant="primary"
          tone="danger"
          motion="none"
          iconOnly
          label={t("Stop")}
          shortcut={stopShortcut}
          data-usage-guide="stop-button"
          loading={stopping}
          loadingLabel={t("Stopping…")}
          onClick={onStop}
        >
          <Square className="size-2.5 fill-current stroke-none" />
        </Button>
      </>
    );
  }

  return (
    <Button
      variant="primary"
      tone="accent"
      motion="none"
      iconOnly
      label={blockedReason ? `${label}. ${blockedReason}` : label}
      tooltip={blockedReason}
      shortcut={blockedReason ? null : "Enter"}
      disabled={!hasValue && !submitting}
      loading={submitting !== null}
      loadingLabel={t("Sending…")}
      onClick={onSend}
      aria-description={blockedReason}
    >
      <ArrowUp className="icon-sm" strokeWidth={2} />
    </Button>
  );
}
