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
  accountSessionDefaults,
  globalProviderSessionDefaults,
  loadGlobalSessionDefaults,
  normalizeAccountDefaults,
  productSessionDefaults,
  providerSessionDefaults,
  saveAccountSessionDefaults,
  type AccountSessionDefaults,
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

/** The model a project stores for a provider; undefined when it follows global. */
export function projectModelOverride(
  settings: ProjectProviderSettings,
  harness: HarnessId,
): string | undefined {
  return (
    settings.models?.[harness] ??
    (settings.defaultHarness === harness ? settings.defaultModel : undefined)
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

/**
 * ProviderRow props that edit one account's overrides. Unset fields inherit the
 * provider's global defaults and model, exactly as new conversations resolve them.
 */
export function accountScopeRowProps(input: {
  harness: HarnessId;
  accountId: string;
  globalModel: string;
  persist: (write: () => void, verify: () => boolean) => void;
}) {
  const { harness, accountId, globalModel, persist } = input;
  const own = accountSessionDefaults(harness, accountId);
  const { model, ...defaults } = own;
  const save = (next: AccountSessionDefaults) =>
    persist(
      () => saveAccountSessionDefaults(harness, accountId, next),
      () =>
        JSON.stringify(accountSessionDefaults(harness, accountId)) ===
        JSON.stringify(normalizeAccountDefaults(next)),
    );
  return {
    selectedModel: model ?? globalModel,
    inheritedDefaults: globalProviderSessionDefaults(harness, accountId),
    scopeDefaults: defaults,
    onSessionDefaultsChange: (next: ProviderSessionDefaults) => save({ ...next, model }),
    modelOverride: model,
    globalModel,
    onModelReset: () => save(defaults),
    onModelChange: (_harness: HarnessId, next: string) => save({ ...defaults, model: next }),
    projectScope: true,
    accountId,
  };
}
