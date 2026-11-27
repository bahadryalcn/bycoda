import { t } from "../../../shared/i18n/technical";

type StatusInput = {
  state?: { open: boolean; controlling: boolean; heldBy?: object };
  error: string;
  busy: boolean;
  setupRequired: boolean;
};

/** Explain input availability without treating a missing frame as a successful action. */
export function browserInputDisabledReason({
  busy,
  state,
  frameCurrent,
  inputBlocked,
  selecting,
}: {
  busy: boolean;
  state?: { open: boolean; controlling: boolean };
  frameCurrent: boolean;
  inputBlocked: boolean;
  selecting: boolean;
}) {
  return busy
    ? t("Working on the host…")
    : !state?.open
      ? t("Open a website")
      : !state.controlling
        ? t("Browser control is unavailable. Try again when the other device releases it.")
        : !frameCurrent || inputBlocked
          ? t("Refresh the frame to view this page.")
          : selecting
            ? t("Cancel selection")
            : undefined;
}

/** Labels and tone for the host browser's single status dot and its tooltip. */
export function browserStatusPresentation({ state, error, busy, setupRequired }: StatusInput) {
  const browserStatus = !state
    ? error
      ? t("Browser unavailable")
      : t("Checking browser…")
    : state.open
      ? t("Browser open")
      : t("Browser closed");
  const errorSummary = error.startsWith(t("Action completed. Refresh the frame to see the result."))
    ? t("Action completed. Refresh the frame to see the result.")
    : error.length <= 180 && !/[\r\n]/.test(error)
      ? error
      : t("Browser unavailable");
  // Red for a failure or missing setup, green while a page is open, yellow while closed or working.
  const statusTone: "danger" | "success" | "warning" =
    error || setupRequired || (!state && !busy)
      ? "danger"
      : state?.open && !busy && (!state.heldBy || state.controlling)
        ? "success"
        : "warning";
  const statusLabel = busy
    ? t("Working on the host…")
    : setupRequired
      ? t("Browser setup required")
      : state?.open && state.heldBy && !state.controlling
        ? t("Browser control is unavailable. Try again when the other device releases it.")
        : browserStatus;
  return { errorSummary, statusTone, statusLabel };
}
