import { Text } from "../../../shared/ui/Text";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { useEffect, useState } from "react";
import { useT } from "../../../shared/i18n";
import {
  providerAccounts,
  subscribeProviderAccounts,
  supportsProviderAccounts,
} from "../../providers/public/providerAccounts";
import type { HarnessId } from "../../sessions/public/session";

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
  // Refresh the warning when the local provider account catalog changes.
  useEffect(() => subscribeProviderAccounts(() => refresh((version) => version + 1)), []);
  if (!supportsProviderAccounts(harness)) return null;
  if (!local)
    // The host's default account is the unremarkable case and says nothing.
    return accountId && accountId !== "default" ? (
      <Text size="caption" tone="secondary" className="task-account-context">
        {t("Account selected on the host")}
      </Text>
    ) : null;
  const missing =
    accountId !== undefined &&
    accountId !== "default" &&
    !providerAccounts(harness).some((account) => account.id === accountId);
  if (!missing) return null;
  return (
    <InlineMessage tone="warning" className="task-account-context">
      {t("Unavailable account")}
    </InlineMessage>
  );
}
