import { useSyncExternalStore } from "react";
import { t } from "../../../shared/i18n";
import type { HarnessId } from "../../../shared/model/harnessIdentity";
import { AccountColorDot } from "../../providers/public/accountIdentity";
import {
  providerAccounts,
  subscribeProviderAccounts,
  supportsProviderAccounts,
} from "../../providers/public/providerAccounts";
import type {
  ProjectProviderSettings,
  ProviderSessionDefaults,
} from "../../sessions/public/projectProviders";
import {
  loadGlobalSessionDefaults,
  productSessionDefaults,
  providerSessionDefaults,
} from "../../sessions/public/providerSessionDefaults";
import { Row, Select } from "./settingsControls";

export function inheritedProviderDefaults(harness: HarnessId, projectScope: boolean) {
  return projectScope ? providerSessionDefaults(harness) : productSessionDefaults(harness);
}

/** True when a project stores anything that "Use global defaults" would clear. */
export function hasProjectOverrides(settings: ProjectProviderSettings): boolean {
  return Boolean(
    settings.defaultHarness ||
    settings.defaultModel ||
    Object.keys(settings.models ?? {}).length > 0 ||
    Object.keys(settings.defaults ?? {}).length > 0,
  );
}

const accountsSnapshot = () =>
  JSON.stringify([providerAccounts("claude"), providerAccounts("codex")]);

/** Accounts whose defaults can be set apart; none when the provider has one account. */
export function defaultsAccounts(harness: HarnessId) {
  if (!supportsProviderAccounts(harness)) return [];
  const accounts = providerAccounts(harness);
  return accounts.length > 1 ? accounts : [];
}

/** "All accounts" edits the provider's defaults; an account edits its own overrides. */
export function AccountDefaultsScope({
  harness,
  value,
  onChange,
}: {
  harness: HarnessId;
  value: string;
  onChange: (accountId: string) => void;
}) {
  useSyncExternalStore(subscribeProviderAccounts, accountsSnapshot, accountsSnapshot);
  const accounts = defaultsAccounts(harness);
  if (!accounts.length) return null;
  return (
    <Row label={t("Account")}>
      <Select
        hideLabel
        label={t("Account")}
        value={accounts.some((account) => account.id === value) ? value : ""}
        options={[
          { value: "", label: t("All accounts") },
          ...accounts.map((account) => ({
            value: account.id,
            label: account.label,
            icon: <AccountColorDot account={account} />,
          })),
        ]}
        onChange={onChange}
      />
    </Row>
  );
}

/** Provider-level defaults only, without any account's overrides. */
export function globalProviderDefaults(harness: HarnessId): ProviderSessionDefaults {
  return loadGlobalSessionDefaults()[harness] ?? {};
}
