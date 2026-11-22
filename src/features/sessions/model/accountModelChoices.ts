// The React-free core keeps this model usable from the headless Host bundle.
import { t } from "../../../shared/i18n/core";
import type { AgentModel } from "./models";
import { providerAccountSignedOut } from "../../providers/public/accountUsage";
import type { ProviderRateLimits } from "../../providers/public/accountUsage";
import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  defaultProviderAccountId,
  PROVIDER_ACCOUNT_COLORS,
  PROVIDER_ACCOUNT_PROVIDERS,
  providerAccountLabel,
  providerAccounts,
  providerAccountColorValue,
  supportsProviderAccounts,
  type ProviderAccount,
} from "../../providers/public/providerAccounts";

export type AccountModelChoice = AgentModel & {
  accountId?: string;
  accountColor?: string;
  accountNumber?: number;
  /** The account's display label, kept apart from `name` so a row can truncate the model first. */
  accountLabel?: string;
};
type ModelAccountProfile = Pick<ProviderAccount, "id" | "label" | "isDefault"> & { color?: string };

export type ModelAccountCatalog = Partial<
  Record<"codex" | "claude" | "grok", readonly ModelAccountProfile[]>
>;

export function modelAccountIdentities(
  harness: AgentModel["harness"],
  accounts: readonly ModelAccountProfile[],
) {
  return accounts.map((account, index) => ({
    id: account.id,
    isDefault: account.isDefault,
    accountLabel: accountDisplayLabel(accounts, account),
    accountNumber: accounts.length > 1 ? index + 1 : undefined,
    ...(accounts.length > 1
      ? {
          accountColor: providerAccountColorValue({
            id: account.id,
            provider: harness,
            color: account.color
              ? PROVIDER_ACCOUNT_COLORS.find((entry) => entry.id === account.color)?.id
              : undefined,
          }),
        }
      : {}),
  }));
}

/**
 * Display label of one account. Accounts may share a label; the stored label stays untouched and
 * only the display gains the local account ID so same-named accounts remain distinguishable.
 */
export function accountDisplayLabel(
  accounts: readonly { id: string; label: string; isDefault?: boolean }[],
  account: { id: string; label: string },
): string {
  const key = account.label.trim().toLocaleLowerCase();
  const shared = accounts.some(
    (other) => other.id !== account.id && other.label.trim().toLocaleLowerCase() === key,
  );
  return shared ? `${account.label} · ${account.id}` : account.label;
}

/** The model name of a choice without its trailing account label. */
export function modelChoiceBaseName(choice: AccountModelChoice): string {
  const suffix = choice.accountLabel ? ` ${choice.accountLabel}` : "";
  return suffix && choice.name.endsWith(suffix)
    ? choice.name.slice(0, -suffix.length)
    : choice.name;
}

export function accountModelChoices(
  models: AgentModel[],
  enabled: boolean,
  catalog?: ModelAccountCatalog,
): AccountModelChoice[] {
  return models.flatMap((model) => {
    if (!enabled || !supportsProviderAccounts(model.harness)) return [model];
    // A Host that has not reported this provider's accounts leaves the account unknown: the
    // model stays one row and the owning Host picks its account, never this device's profiles.
    if (catalog !== undefined && catalog[model.harness] === undefined) return [model];
    const accounts =
      catalog === undefined ? providerAccounts(model.harness) : (catalog[model.harness] ?? []);
    return modelAccountIdentities(model.harness, accounts).map(
      ({ id, isDefault: _default, ...account }) => ({
        ...model,
        ...account,
        name: `${model.name} ${account.accountLabel}`,
        accountId: id,
      }),
    );
  });
}

export function modelChoiceKey(model: AccountModelChoice): string {
  return JSON.stringify([model.id, model.accountId]);
}

export function modelAccountLabel(
  model: AgentModel,
  accountId?: string,
  catalog?: ModelAccountCatalog,
): string {
  if (catalog !== undefined && supportsProviderAccounts(model.harness)) {
    const accounts = catalog[model.harness] ?? [];
    const id = accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID;
    const found = accounts.find((account) => account.id === id);
    if (!found && id === DEFAULT_PROVIDER_ACCOUNT_ID) return model.name;
    return `${model.name} ${found ? accountDisplayLabel(accounts, found) : t("Unavailable Host account")}`;
  }
  if (!supportsProviderAccounts(model.harness)) return model.name;
  const id = accountId ?? defaultProviderAccountId(model.harness);
  const accounts = providerAccounts(model.harness);
  const found = accounts.find((account) => account.id === id);
  return `${model.name} ${found ? accountDisplayLabel(accounts, found) : providerAccountLabel(model.harness, id)}`;
}

/** Every account-capable provider's accounts, keyed by provider. */
export function accountChoicesSnapshot(): string {
  return JSON.stringify(
    Object.fromEntries(
      PROVIDER_ACCOUNT_PROVIDERS.map((provider) => [provider, providerAccounts(provider)]),
    ),
  );
}

/** Local model account label from the caller's reactive accounts and translator. */
export function modelAccountLabelWith(
  model: AgentModel,
  accountId: string | undefined,
  accounts: readonly { id: string; label: string; isDefault?: boolean }[],
  translate: (message: string) => string,
): string {
  if (!supportsProviderAccounts(model.harness)) return model.name;
  const id = accountId ?? accounts.find((account) => account.isDefault)?.id ?? "default";
  const found = accounts.find((account) => account.id === id);
  return `${model.name} ${found ? accountDisplayLabel(accounts, found) : translate(id !== "default" ? "Removed account" : "Default account")}`;
}

export function signedOutAccountKeys(usage: Record<string, ProviderRateLimits>): Set<string> {
  return new Set(
    Object.entries(usage)
      .filter(([, limits]) => providerAccountSignedOut(limits))
      .map(([key]) => key),
  );
}
