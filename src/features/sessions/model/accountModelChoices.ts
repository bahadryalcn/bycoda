// The React-free core keeps this model usable from the headless Host bundle.
import { t } from "../../../shared/i18n/core";
import type { AgentModel } from "./models";
import { providerAccountSignedOut } from "../../providers/public/accountUsage";
import type { ProviderRateLimits } from "../../providers/public/accountUsage";
import {
  defaultProviderAccountId,
  providerAccountLabel,
  providerAccounts,
  providerAccountColorValue,
  supportsProviderAccounts,
} from "../../providers/public/providerAccounts";

export type AccountModelChoice = AgentModel & {
  accountId?: string;
  accountColor?: string;
  /** The account's display label, kept apart from `name` so a row can truncate the model first. */
  accountLabel?: string;
};
export type ModelAccountCatalog = Partial<
  Record<"codex" | "claude", readonly { id: string; label: string }[]>
>;

/**
 * Display label of one account. Accounts may share a label; the stored label stays untouched and
 * only the display gains the local account ID so same-named accounts remain distinguishable.
 */
export function accountDisplayLabel(
  accounts: readonly { id: string; label: string }[],
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
    const accounts: readonly { id: string; label: string; accountColor?: string }[] =
      catalog === undefined
        ? providerAccounts(model.harness).map((account) => ({
            id: account.id,
            label: account.label,
            accountColor: providerAccountColorValue(account),
          }))
        : (catalog[model.harness] ?? []);
    return accounts.map((account) => {
      const accountLabel = accountDisplayLabel(accounts, account);
      return {
        ...model,
        name: `${model.name} ${accountLabel}`,
        accountLabel,
        accountId: account.id,
        ...(account.accountColor ? { accountColor: account.accountColor } : {}),
      };
    });
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
    const found = accounts.find((account) => account.id === (accountId ?? "default"));
    return `${model.name} ${found ? accountDisplayLabel(accounts, found) : t("Unavailable Host account")}`;
  }
  if (!supportsProviderAccounts(model.harness)) return model.name;
  const id = accountId ?? defaultProviderAccountId(model.harness);
  const accounts = providerAccounts(model.harness);
  const found = accounts.find((account) => account.id === id);
  return `${model.name} ${found ? accountDisplayLabel(accounts, found) : providerAccountLabel(model.harness, id)}`;
}

export function accountChoicesSnapshot(): string {
  return JSON.stringify([providerAccounts("claude"), providerAccounts("codex")]);
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
