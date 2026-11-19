import { useSyncExternalStore } from "react";
import {
  providerAccounts,
  providerAccountsStorageVersion,
  subscribeProviderAccounts,
  type ProviderAccount,
  type ProviderAccountProvider,
} from "./providerAccounts";

const NONE: ProviderAccount[] = [];
const snapshots = new Map<
  ProviderAccountProvider,
  { version: readonly (string | null)[]; key: string; accounts: ProviderAccount[] }
>();

function sameVersion(left: readonly (string | null)[], right: readonly (string | null)[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Referentially stable `providerAccounts(provider)`. Every render compares only the raw stored
 * strings; the record is parsed and serialised again only after storage changed, and the last
 * array is reused while its content is unchanged.
 */
function providerAccountsSnapshot(provider: ProviderAccountProvider): ProviderAccount[] {
  const version = providerAccountsStorageVersion();
  const cached = snapshots.get(provider);
  if (cached && sameVersion(cached.version, version)) return cached.accounts;
  const accounts = providerAccounts(provider);
  const key = JSON.stringify(accounts);
  if (cached?.key === key) {
    snapshots.set(provider, { version, key, accounts: cached.accounts });
    return cached.accounts;
  }
  snapshots.set(provider, { version, key, accounts });
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
