import {
  isModelEnabled,
  showProviderInModelPicker,
  type AgentModel,
  type ModelPickerTab,
} from "../model/models";
import { isProviderHidden } from "../model/projectProviders";
import { menuSettings } from "../model/modelPickerData";
import {
  accountModelChoices,
  modelAccountIdentities,
  type ModelAccountCatalog,
} from "../model/accountModelChoices";
import {
  providerAccounts,
  supportsProviderAccounts,
} from "../../providers/public/providerAccounts";
import { HARNESS_TITLE, type HarnessId } from "../model/session";
import type { ModelSource } from "./modelSource";

// Revisions are call arguments so React Compiler retains each external store dependency.
export function modelEnabledAtRevision(source: ModelSource, id: string, _revision: number) {
  // Host catalogs already apply the preferences of the computer that runs the model.
  return source.id !== undefined || isModelEnabled(id);
}

export function pickerProviderAtRevision(
  id: HarnessId,
  project: string | undefined,
  source: ModelSource,
  _availability: number,
  _visibility: number,
  _project: number,
) {
  return (
    !isProviderHidden(project, id) &&
    showProviderInModelPicker(id, source.available(id), source.probed())
  );
}

export function menuSettingsAtRevision(
  input: Parameters<typeof menuSettings>[0],
  _revision: number,
  _accountsSnapshot: string,
) {
  return menuSettings(input);
}

/** The first number in a model name ("Opus 4.8", "GPT-5.2 Codex"), compared part by part. */
function nameVersion(name: string): number[] | undefined {
  const match = /\d+(?:\.\d+)*/.exec(name);
  return match ? match[0].split(".").map(Number) : undefined;
}

/**
 * A provider's list reads newest version first; unversioned entries (Auto, Default) lead and
 * equal versions keep the catalog order, so the one rule is predictable to scan.
 */
export function newestFirst<T extends { name: string }>(models: T[]): T[] {
  return models
    .map((item, index) => ({ item, index, version: nameVersion(item.name) }))
    .sort((a, b) => {
      if (!a.version || !b.version) return a.version ? 1 : b.version ? -1 : a.index - b.index;
      for (let i = 0; i < Math.max(a.version.length, b.version.length); i++) {
        const diff = (b.version[i] ?? 0) - (a.version[i] ?? 0);
        if (diff) return diff;
      }
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

export function visibleModelsAtSnapshot(
  {
    source,
    tab,
    favorites,
    harnesses,
    query,
    hideSettings,
    accountChoices,
    accountFor,
  }: {
    source: ModelSource;
    tab: ModelPickerTab;
    favorites: string[];
    harnesses: HarnessId[];
    query: string;
    hideSettings: boolean;
    accountChoices: boolean;
    accountFor?: (harness: HarnessId) => string;
  },
  _catalogVersion: number,
  accountsSnapshot: string,
) {
  const needle = query.trim().toLowerCase();
  const accounts = JSON.parse(accountsSnapshot) as ModelAccountCatalog;
  const pool =
    tab === "favorites"
      ? favorites
          .map((id) => source.find(id))
          .filter(
            (item): item is AgentModel =>
              item != null &&
              harnesses.includes(item.harness) &&
              modelEnabledAtRevision(source, item.id, _catalogVersion),
          )
      : newestFirst(
          source
            .modelsFor(tab)
            .filter((item) => modelEnabledAtRevision(source, item.id, _catalogVersion)),
        );
  // The panel lists each model once; the beside-picker flyout has one row per account.
  const choices = hideSettings
    ? accountModelChoices(pool, accountChoices, source.accounts)
    : tab === "favorites" && accountChoices
      ? pool.map((model) => {
          const account = modelAccountIdentityIn(
            model.harness,
            accountFor?.(model.harness),
            accounts,
          );
          return account
            ? {
                ...model,
                name: `${model.name} ${account.accountLabel}`,
                accountId: account.id,
                accountLabel: account.accountLabel,
                accountNumber: account.accountNumber,
                accountColor: account.accountColor,
              }
            : model;
        })
      : pool;
  return !needle
    ? choices
    : choices.filter((item) =>
        `${item.name} ${"accountLabel" in item ? (item.accountLabel ?? "") : ""} ${HARNESS_TITLE[item.harness]} ${item.provider?.name ?? ""} ${item.provider?.id ?? ""}`
          .toLowerCase()
          .includes(needle),
      );
}

export function modelAccountIdentityIn(
  harness: HarnessId,
  accountId: string | undefined,
  catalog: ModelAccountCatalog,
) {
  if (!supportsProviderAccounts(harness)) return undefined;
  return modelAccountIdentities(harness, catalog[harness] ?? []).find(
    (item) => item.id === accountId,
  );
}

export function providerAccountsAtSnapshot(
  harness: Parameters<typeof providerAccounts>[0],
  _snapshot: string,
) {
  return providerAccounts(harness);
}
