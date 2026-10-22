import type { AgentModel } from "./models";
import {
  defaultProviderAccountId,
  providerAccountLabel,
  providerAccounts,
  providerAccountColorValue,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";

export type AccountModelChoice = AgentModel & { accountId?: string; accountColor?: string };

export function accountModelChoices(models: AgentModel[], enabled: boolean): AccountModelChoice[] {
  return models.flatMap((model) =>
    enabled && supportsProviderAccounts(model.harness)
      ? providerAccounts(model.harness).map((account) => ({
          ...model,
          name: `${model.name} ${account.label}`,
          accountId: account.id,
          accountColor: providerAccountColorValue(account),
        }))
      : [model],
  );
}

export function modelChoiceKey(model: AccountModelChoice): string {
  return JSON.stringify([model.id, model.accountId]);
}

export function modelAccountLabel(model: AgentModel, accountId?: string): string {
  return supportsProviderAccounts(model.harness)
    ? `${model.name} ${providerAccountLabel(model.harness, accountId ?? defaultProviderAccountId(model.harness))}`
    : model.name;
}

export function accountChoicesSnapshot(): string {
  return JSON.stringify([providerAccounts("claude"), providerAccounts("codex")]);
}
