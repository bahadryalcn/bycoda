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
