import {
  isModelEnabled,
  showProviderInModelPicker,
  type AgentModel,
  type ModelPickerTab,
} from "../model/models";
import { isProviderHidden } from "../model/projectProviders";
import { menuSettings } from "../model/modelPickerData";
import { accountModelChoices } from "../model/accountModelChoices";
import { providerAccounts } from "../../providers/public/providerAccounts";
import { HARNESS_TITLE, type HarnessId } from "../model/session";
import type { ModelSource } from "./modelSource";

// Revisions are call arguments so React Compiler retains each external store dependency.
export function modelEnabledAtRevision(id: string, _revision: number) {
  return isModelEnabled(id);
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
) {
  return menuSettings(input);
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
  }: {
    source: ModelSource;
    tab: ModelPickerTab;
    favorites: string[];
    harnesses: HarnessId[];
    query: string;
    hideSettings: boolean;
    accountChoices: boolean;
  },
  _catalogVersion: number,
  _accountsSnapshot: string,
) {
  const needle = query.trim().toLowerCase();
  const pool =
    tab === "favorites"
      ? favorites
          .map((id) => source.find(id))
          .filter(
            (item): item is AgentModel =>
              item != null && harnesses.includes(item.harness) && isModelEnabled(item.id),
          )
      : source.modelsFor(tab).filter((item) => isModelEnabled(item.id));
  // The panel lists each model once; the beside-picker flyout has one row per account.
  const choices = hideSettings ? accountModelChoices(pool, accountChoices, source.accounts) : pool;
  return !needle
    ? choices
    : choices.filter((item) =>
        `${item.name} ${HARNESS_TITLE[item.harness]} ${item.provider?.name ?? ""} ${item.provider?.id ?? ""}`
          .toLowerCase()
          .includes(needle),
      );
}

export function providerAccountsAtSnapshot(
  harness: Parameters<typeof providerAccounts>[0],
  _snapshot: string,
) {
  return providerAccounts(harness);
}
