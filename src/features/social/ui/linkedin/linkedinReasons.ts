import { t } from "../../../../shared/i18n";

/** Why a LinkedIn action is blocked while its account is offline or connected on another computer. */
export const linkedInBlockedReason = () =>
  t("Use this account on the computer where it is connected, while it is online.");

/** The reason for a control disabled either by the account gate or by its own running request. */
export const linkedInBusyReason = (blocked: boolean) =>
  blocked ? linkedInBlockedReason() : t("Wait for the current action to finish.");
