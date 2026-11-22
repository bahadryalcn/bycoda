import { Text } from "../../../../shared/ui/Text";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { ErrorDetails } from "../../../../shared/ui/ErrorDetails";
import { TriangleAlert } from "../../../../shared/ui/icons";
import { isMicrophoneBlocked } from "../../model/microphoneAccess";
import { isVoiceSetupError, VoiceRecoveryAction } from "../MicrophoneRecoveryAction";

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
  if (isVoiceSetupError(error)) return t("Voice setup is needed");
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
      <Text
        size="inherit"
        tone="danger"
        data-voice-error=""
        role="img"
        aria-label={title}
        className="grid size-7 shrink-0 place-items-center"
      >
        <TriangleAlert className="icon-sm" />
      </Text>
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

/**
 * The error headline with its recovery action, always visible while the error stands. Raw
 * transport text sits behind Details. With `onReconnect` (the call is down and can start again)
 * Reconnect is the one primary action and Dismiss is quiet; otherwise Dismiss is the only button.
 */
export function VoiceErrorNotice({
  error,
  onDismiss,
  onReconnect,
}: {
  error: string;
  onDismiss: () => void;
  onReconnect?: () => void;
}) {
  const title = voiceErrorTitle(error);
  const reconnect = onReconnect && !isVoiceSetupError(error) && !isActionableVoiceError(error);
  return (
    <Text as="div" size="caption" tone="inherit" className="flex flex-col gap-2">
      {title === error ? null : (
        <Text as="p" size="inherit" tone="secondary" weight="medium">
          {title}
        </Text>
      )}
      {!isVoiceSetupError(error) && title !== error ? (
        isMicrophoneBlocked(error) ? (
          // The owner's next step is in the sentence itself: no raw detail to hide.
          <Text as="p" size="inherit" tone="secondary" className="break-words select-text">
            {error}
          </Text>
        ) : (
          <div>
            <ErrorDetails title={title} detail={error} />
          </div>
        )
      ) : null}
      <VoiceRecoveryAction message={error} />
      <div className="flex justify-end gap-2">
        <Button variant={reconnect ? "ghost" : "primary"} onClick={onDismiss}>
          {t("Dismiss")}
        </Button>
        {reconnect ? (
          <Button
            variant="primary"
            onClick={() => {
              onDismiss();
              onReconnect();
            }}
          >
            {t("Reconnect")}
          </Button>
        ) : null}
      </div>
    </Text>
  );
}
