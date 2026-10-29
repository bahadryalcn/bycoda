import { useEffect, useState } from "react";
import { useT } from "../../../shared/i18n";
import {
  providerAccounts,
  subscribeProviderAccounts,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";
import type { HarnessId } from "../../sessions/model/session";

/**
 * Account context beside a task or goal model picker. On this computer the account is chosen
 * inside the picker itself (`accountChoices`), so this only flags a saved account that no longer
 * exists. Local profile choices must never be offered as accounts on another computer, so other
 * hosts show where the account is selected instead.
 */
export function TaskAccountPicker({
  harness,
  accountId,
  local,
}: {
  harness: HarnessId;
  accountId?: string;
  local: boolean;
}) {
  const t = useT();
  const [, refresh] = useState(0);
  useEffect(() => subscribeProviderAccounts(() => refresh((version) => version + 1)), []);
  if (!supportsProviderAccounts(harness)) return null;
  if (!local)
    return (
      <span className="task-account-context">
        {accountId && accountId !== "default"
          ? t("Account selected on the host")
          : t("Host default account")}
      </span>
    );
  const missing =
    accountId !== undefined &&
    accountId !== "default" &&
    !providerAccounts(harness).some((account) => account.id === accountId);
  if (!missing) return null;
  return (
    <span role="status" className="task-account-context text-(--ui-tone-warning-fg)">
      {t("Unavailable account")}
    </span>
  );
}
