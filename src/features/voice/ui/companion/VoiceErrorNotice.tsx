import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { TriangleAlert } from "../../../../shared/ui/icons";
import { MicrophoneRecoveryAction } from "../MicrophoneRecoveryAction";

/** Errors whose text is already the owner's next step; every other error is a technical detail. */
export function isActionableVoiceError(error: string | undefined) {
  return (
    error === t("Conversation was not saved. Retry.") ||
    error ===
      t("Current computer presence could not be verified. Mark yourself here before talking.")
  );
}

/** What the header mark is called: the next step itself, or the generic attention line. */
export function voiceErrorTitle(error: string) {
  return isActionableVoiceError(error) ? error : t("Voice needs attention");
}

/**
 * Header mark for a voice error. It carries `data-voice-error`, which tints the whole card. With
 * `onShow` it is a button (the compact card has no room for the message and expands on it);
 * otherwise it is a plain mark, because the message is already visible in the body.
 */
export function VoiceErrorMark({ error, onShow }: { error: string; onShow?: () => void }) {
  const title = voiceErrorTitle(error);
  if (!onShow) {
    return (
      <span
        data-voice-error=""
        role="img"
        aria-label={title}
        className="grid size-7 shrink-0 place-items-center text-(--ui-tone-danger-fg)"
      >
        <TriangleAlert className="icon-sm" />
      </span>
    );
  }
  return (
    <Button
      iconOnly
      variant="ghost"
      tone="danger"
      data-voice-error=""
      label={title}
      onClick={onShow}
    >
      <TriangleAlert className="icon-sm" />
    </Button>
  );
}

/** The error message with its recovery action and Dismiss, always visible while the error stands. */
export function VoiceErrorNotice({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  const title = voiceErrorTitle(error);
  return (
    <div className="flex flex-col gap-2 text-ui-caption">
      {title === error ? null : <p className="font-medium">{title}</p>}
      <p className="break-words text-(--ui-text-secondary) select-text">{error}</p>
      <MicrophoneRecoveryAction message={error} />
      <div className="flex justify-end">
        <Button variant="primary" onClick={onDismiss}>
          {t("Dismiss")}
        </Button>
      </div>
    </div>
  );
}
