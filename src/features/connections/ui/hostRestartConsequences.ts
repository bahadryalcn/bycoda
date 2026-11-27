import { t } from "../../../shared/i18n";

/**
 * The one consequence every local Host restart (update or mode switch) shares. Kept in one place
 * so the confirmations in the update notice, the version prompt and the mode switch never drift.
 */
export function hostRestartConsequences() {
  return [
    {
      tone: "warning" as const,
      content: t("Running sessions and shells on this computer are interrupted."),
    },
  ];
}
