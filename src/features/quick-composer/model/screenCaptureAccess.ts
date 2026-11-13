import { t } from "../../../shared/i18n";

/** Stable code returned by `quick_composer_capture` when macOS withholds Screen Recording. */
const SCREEN_RECORDING_DENIED = "screen-recording-permission-required";

/** Copy for the recovery notice; the Host never sends user-facing text for this case. */
export function screenRecordingBlockedMessage(): string {
  return t("Screenshots need Screen Recording access. Review access to set it up, then try again.");
}

export function isScreenRecordingBlocked(message: string | null): boolean {
  return message !== null && message === screenRecordingBlockedMessage();
}

/** Maps a native capture failure to the text shown in the composer. */
export function captureFailureMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message === SCREEN_RECORDING_DENIED ? screenRecordingBlockedMessage() : message;
}
