import type { AgentModel } from "./models";
import {
  defaultProviderAccountId,
  providerAccountLabel,
  providerAccounts,
  providerAccountColorValue,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";

export type AccountModelChoice = AgentModel & { accountId?: string; accountColor?: string };
export type ModelAccountCatalog = Partial<
  Record<"codex" | "claude", readonly { id: string; label: string }[]>
>;

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
    return accounts.map((account) => ({
      ...model,
      name: `${model.name} ${account.label}`,
      accountId: account.id,
      ...(account.accountColor ? { accountColor: account.accountColor } : {}),
    }));
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
  if (catalog !== undefined && supportsProviderAccounts(model.harness))
    return `${model.name} ${catalog[model.harness]?.find((account) => account.id === (accountId ?? "default"))?.label ?? "Unavailable Host account"}`;
  return supportsProviderAccounts(model.harness)
    ? `${model.name} ${providerAccountLabel(model.harness, accountId ?? defaultProviderAccountId(model.harness))}`
    : model.name;
}

export function accountChoicesSnapshot(): string {
  return JSON.stringify([providerAccounts("claude"), providerAccounts("codex")]);
}
