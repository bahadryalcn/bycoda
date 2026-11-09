import {
  defaultProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/public/providerAccounts";
import { defaultSessionChoice, resolveModel } from "./models";
import { loadProjectProviderSettings, projectDefaultAccountId } from "./projectProviders";
import type { HarnessId } from "./session";

/** Where a new conversation in a project starts: provider, account and model. */
export type ModelDefault = {
  harness: HarnessId;
  /** Catalog id, so it compares with picker rows. */
  model: string;
  /** Undefined for providers without accounts. */
  accountId?: string;
  /** True when the project pins it; false when it follows the global choice. */
  pinned: boolean;
};

/** A real project folder; the home fallback and empty scopes have no project defaults. */
export function hasProjectDefaults(project: string | undefined): project is string {
  return !!project && project !== "~";
}

/**
 * The default the model picker marks for `project`. Host catalogs name their own accounts, so
 * there the provider's `default` account stands in for the local one.
 */
export function modelDefault(project: string, hostAccounts: boolean): ModelDefault {
  const choice = defaultSessionChoice(project);
  const accountId = !supportsProviderAccounts(choice.harness)
    ? undefined
    : hostAccounts
      ? "default"
      : (projectDefaultAccountId(project, choice.harness) ??
        defaultProviderAccountId(choice.harness));
  return {
    harness: choice.harness,
    model: resolveModel(choice.harness, choice.model).id,
    accountId,
    pinned: loadProjectProviderSettings(project).defaultHarness === choice.harness,
  };
}

/**
 * True when a picker row is the default. `accountId` is the account the row would run on;
 * leave it undefined where the row has no account choice, so the account is not compared.
 */
export function isModelDefault(
  value: ModelDefault,
  harness: HarnessId,
  model: string,
  accountId?: string,
): boolean {
  if (value.harness !== harness || value.model !== model) return false;
  return accountId === undefined || value.accountId === undefined || value.accountId === accountId;
}
