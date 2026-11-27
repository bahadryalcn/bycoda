import { t } from "../../../../shared/i18n";

/**
 * Why an account write control is off: the account's computer is not reachable (`offline`), or
 * another write on the same card is still running. Pass it as `disabledReason`; the control shows
 * it only while it is disabled.
 */
export function accountBlockedReason(offline: boolean): string {
  return offline
    ? t("Connect to this computer to change this account.")
    : t("Wait for the current change to finish.");
}
