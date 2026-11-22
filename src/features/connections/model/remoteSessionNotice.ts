import { t } from "../../../shared/i18n";
import { queueReadFailureDetail, type QueueReadFailure } from "./remoteQueueReadFailure";

/**
 * Queue read failures hold sending; retry only reads the saved queue again. The failure carries
 * machine, environment, session, operation, time and class, kept behind Details and in history.
 */
export function remoteQueueReadNotice(
  error: string,
  retry: () => void,
  failure?: QueueReadFailure,
  machineName?: string,
) {
  const text = t(
    "Could not load queued messages. Sending is held until the saved queue can be read.",
  );
  const details = failure ? queueReadFailureDetail(failure, machineName) : undefined;
  return {
    text,
    detail: error,
    details,
    /** Plain text for the notification log: the card's sentence plus its class and cause. */
    history: failure ? `${text} ${failure.code}: ${failure.message}` : text,
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
        : t("Your message is saved and will be sent automatically."),
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
