import { t } from "../../../shared/i18n";

/** Queue read failures hold sending; retry only reads the saved queue again. */
export function remoteQueueReadNotice(error: string, retry: () => void) {
  return {
    text: t("Could not load queued messages. Sending is held until the saved queue can be read."),
    detail: error,
    action: {
      kind: "retry" as const,
      get label() {
        return t("Retry");
      },
      run: retry,
    },
  };
}

/** Saved requests retain their retry action while waiting for host confirmation. */
export function remotePendingRequestNotice(
  retryStopped: boolean | undefined,
  online: boolean,
  needsConfirmation: boolean | undefined,
  error: string,
  retry: () => void,
) {
  return {
    // Saved and not yet confirmed: it goes out again by itself once the machine answers.
    text: retryStopped
      ? t("Saved requests need review before continuing.")
      : online || needsConfirmation
        ? t("Waiting for the host to confirm your request.")
        : t("Reconnecting. Your message will be sent automatically."),
    detail: error,
    action: {
      kind: "retry" as const,
      get label() {
        return t("Retry");
      },
      run: retry,
    },
  };
}
