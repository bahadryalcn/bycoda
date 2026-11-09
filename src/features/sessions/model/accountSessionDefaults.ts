import {
  defaultProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/public/providerAccounts";
import { normalizeProviderDefaults, type ProviderSessionDefaults } from "./projectProviders";
import type { HarnessId } from "./session";

/** One account's own new-conversation defaults; unset fields follow the provider's. */
export type AccountSessionDefaults = ProviderSessionDefaults & { model?: string };

export const ACCOUNT_DEFAULTS_KEY = "bycoda.providerAccountSessionDefaults.v1";
/** Shared with provider defaults so every listener refreshes on either change. */
export const SESSION_DEFAULTS_CHANGE = "bycoda:provider-session-defaults";

type Stored = Partial<Record<HarnessId, Record<string, AccountSessionDefaults>>>;

export function normalizeAccountDefaults(value: AccountSessionDefaults): AccountSessionDefaults {
  const next: AccountSessionDefaults = normalizeProviderDefaults(value);
  if (typeof value.model === "string" && value.model) next.model = value.model;
  return next;
}

function loadAll(): Stored {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(ACCOUNT_DEFAULTS_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Stored = {};
    for (const [harness, accounts] of Object.entries(value)) {
      if (!accounts || typeof accounts !== "object" || Array.isArray(accounts)) continue;
      const entries = Object.entries(accounts as Record<string, unknown>).flatMap(([id, entry]) =>
        id && entry && typeof entry === "object" && !Array.isArray(entry)
          ? [[id, normalizeAccountDefaults(entry as AccountSessionDefaults)] as const]
          : [],
      );
      out[harness as HarnessId] = Object.fromEntries(entries);
    }
    return out;
  } catch {
    return {};
  }
}

/** The account a new conversation of `harness` uses when none was picked. */
export function newSessionAccountId(harness: HarnessId, accountId?: string): string | undefined {
  if (!supportsProviderAccounts(harness)) return undefined;
  return accountId ?? defaultProviderAccountId(harness);
}

/** Saved defaults of one account; empty when it follows the provider. */
export function accountSessionDefaults(
  harness: HarnessId,
  accountId?: string,
): AccountSessionDefaults {
  const id = newSessionAccountId(harness, accountId);
  return (id && loadAll()[harness]?.[id]) || {};
}

export function saveAccountSessionDefaults(
  harness: HarnessId,
  accountId: string,
  defaults: AccountSessionDefaults,
): void {
  const all = loadAll();
  const accounts = { ...all[harness] };
  const next = normalizeAccountDefaults(defaults);
  if (Object.keys(next).length) accounts[accountId] = next;
  else delete accounts[accountId];
  try {
    localStorage.setItem(ACCOUNT_DEFAULTS_KEY, JSON.stringify({ ...all, [harness]: accounts }));
  } catch {
    // Private mode / quota: the caller verifies and reports the unsaved value.
  }
  window.dispatchEvent(new CustomEvent(SESSION_DEFAULTS_CHANGE));
}

export function accountSessionDefaultsSnapshot(): string {
  return JSON.stringify(loadAll());
}
