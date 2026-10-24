import { useEffect, useState } from "react";
import { useT } from "../../../shared/i18n";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import {
  providerAccounts,
  subscribeProviderAccounts,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";
import type { HarnessId } from "../../sessions/model/session";

/** Local profile choices must never be offered as accounts on another computer. */
export function TaskAccountPicker({
  harness,
  accountId,
  local,
  onChange,
}: {
  harness: HarnessId;
  accountId?: string;
  local: boolean;
  onChange: (id: string) => void;
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
  const accounts = providerAccounts(harness);
  const options = [
    { value: "default", label: t("Host default account") },
    ...accounts
      .filter((account) => account.id !== "default")
      .map((account) => ({ value: account.id, label: account.label })),
  ];
  if (accountId && !options.some((option) => option.value === accountId))
    options.push({ value: accountId, label: t("Unavailable account") });
  return (
    <SearchableSelect
      label={t("Account")}
      value={accountId ?? "default"}
      options={options}
      onChange={onChange}
    />
  );
}
