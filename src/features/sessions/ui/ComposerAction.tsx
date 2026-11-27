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
  followUpAction,
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
  followUpAction?: "queue" | "steer";
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
  const busyLabel =
    followUpAction && (followUpAction === "steer" ? t("Steer") : t("Queue message"));
  if (disabled && !busy && !submitting) {
    return (
      <Button
        variant="primary"
        tone="accent"
        motion="none"
        iconOnly
        label={label}
        shortcut={blockedReason ? null : "Enter"}
        disabled
        disabledReason={blockedReason}
      >
        <ArrowUp className="icon-sm" strokeWidth={2} />
      </Button>
    );
  }
  if (busy) {
    const queueIsPrimary = followUpAction === "queue";
    const showFollowUp = (hasValue && allowBusySubmit && !disabled) || !!submitting;
    return (
      <>
        {showFollowUp ? (
          <>
            {onQueue && !queueIsPrimary ? (
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
                disabledReason={t("Wait for the current action to finish.")}
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
              label={queueIsPrimary ? (busyLabel ?? label) : label}
              shortcut={
                queueIsPrimary && onQueue && queueShortcut ? `Enter / ${queueShortcut}` : "Enter"
              }
              aria-description={queueIsPrimary ? undefined : busyLabel}
              data-usage-guide={queueIsPrimary ? "queue-button" : undefined}
              loading={queueIsPrimary ? !!submitting : submitting === "send"}
              loadingLabel={t("Sending…")}
              disabled={!queueIsPrimary && submitting === "queue"}
              disabledReason={t("Wait for the current action to finish.")}
              startIcon={
                followUpAction === "steer" ? (
                  <span className="composer-steer-icon icon-sm" aria-hidden="true" />
                ) : busyLabel ? (
                  <ListEnd className="icon-sm" strokeWidth={1.75} />
                ) : undefined
              }
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
          variant="secondary"
          tone="danger"
          motion="none"
          iconOnly
          label={t("Stop")}
          shortcut={stopShortcut}
          data-usage-guide="stop-button"
          data-composer-stop-optional={
            showFollowUp && hasValue && onQueue && !submitting && !stopping ? "" : undefined
          }
          loading={stopping}
          loadingLabel={t("Stopping…")}
          onClick={onStop}
        >
          <Square className="size-2.5 fill-current stroke-none" />
        </Button>
      </>
    );
  }

  const sendDisabled = (!hasValue && !submitting) || submitting === "queue";
  return (
    <>
      {/* After the turn, delegated subagents may still run: Queue waits for them. */}
      {onQueue && hasValue ? (
        <Button
          motion="none"
          iconOnly
          label={t("Queue message")}
          tooltip={t("Queue message for when the subagents finish")}
          shortcut={queueShortcut}
          data-usage-guide="queue-button"
          loading={submitting === "queue"}
          loadingLabel={t("Sending…")}
          disabled={submitting === "send"}
          disabledReason={t("Wait for the current action to finish.")}
          onClick={onQueue}
        >
          <ListEnd className="icon-sm" strokeWidth={1.75} />
        </Button>
      ) : null}
      <Button
        variant="primary"
        tone="accent"
        motion="none"
        iconOnly
        label={label}
        tooltip={sendDisabled ? undefined : blockedReason}
        shortcut={blockedReason ? null : "Enter"}
        disabled={sendDisabled}
        disabledReason={sendDisabled ? blockedReason : undefined}
        loading={submitting === "send"}
        loadingLabel={t("Sending…")}
        onClick={onSend}
        aria-description={sendDisabled ? undefined : blockedReason}
      >
        <ArrowUp className="icon-sm" strokeWidth={2} />
      </Button>
    </>
  );
}
