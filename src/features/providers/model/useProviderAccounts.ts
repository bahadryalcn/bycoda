import { useSyncExternalStore } from "react";
import {
  providerAccounts,
  subscribeProviderAccounts,
  type ProviderAccount,
  type ProviderAccountProvider,
} from "./providerAccounts";

const NONE: ProviderAccount[] = [];
const snapshots = new Map<ProviderAccountProvider, { key: string; accounts: ProviderAccount[] }>();

/**
 * Referentially stable `providerAccounts(provider)`: `providerAccounts` builds a fresh array
 * on every call, so the last array is reused while its serialised content is unchanged.
 */
function providerAccountsSnapshot(provider: ProviderAccountProvider): ProviderAccount[] {
  const accounts = providerAccounts(provider);
  const key = JSON.stringify(accounts);
  const cached = snapshots.get(provider);
  if (cached?.key === key) return cached.accounts;
  snapshots.set(provider, { key, accounts });
  return accounts;
}

/**
 * Accounts of one provider, re-rendering the caller whenever the account store changes
 * (any writer in this window, or another window through `storage`). `null` reads nothing and
 * returns an empty list. Do not mutate the result.
 */
export function useProviderAccounts(provider: ProviderAccountProvider | null): ProviderAccount[] {
  const read = () => (provider ? providerAccountsSnapshot(provider) : NONE);
  return useSyncExternalStore(subscribeProviderAccounts, read, read);
}
