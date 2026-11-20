import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import {
  editProviderAccount,
  providerAccounts,
  type ProviderAccount,
  type ProviderAccountProvider,
} from "./providerAccounts";

/** Who the profile is signed in as; the CLI's on-disk cache when offline. */
export type ProviderAccountIdentity = {
  email?: string | null;
  name?: string | null;
  plan?: string | null;
  organization?: string | null;
};

export async function readProviderAccountIdentity(
  provider: ProviderAccountProvider,
  accountId: string,
): Promise<ProviderAccountIdentity | null> {
  try {
    return await invoke<ProviderAccountIdentity | null>("provider_account_identity", {
      provider,
      accountId,
    });
  } catch {
    return null;
  }
}

/** Refresh the profile and assign Work to unclassified accounts on a known team plan. */
export async function refreshProviderAccountIdentity(
  provider: ProviderAccountProvider,
  accountId: string,
): Promise<ProviderAccountIdentity | null> {
  const identity = await readProviderAccountIdentity(provider, accountId);
  const value = identity?.plan?.trim().toLowerCase();
  const team =
    (provider === "claude" && value === "team") ||
    (provider === "codex" && (value === "team" || value === "business"));
  if (team) {
    // Re-read after the native request so an owner's edit during the lookup wins.
    const account = providerAccounts(provider).find((entry) => entry.id === accountId);
    if (account && !account.kind) {
      try {
        editProviderAccount(provider, accountId, { ...account, kind: "work" });
      } catch {
        console.warn("Could not save the detected provider account kind");
      }
    }
  }
  return identity;
}

export function identityKey(account: ProviderAccount): string {
  return `${account.provider}:${account.id}`;
}

/**
 * Load identities for `accounts`, keyed by `identityKey`. Re-reads whenever
 * `refreshKey` changes.
 */
export function useProviderAccountIdentities(
  accounts: ProviderAccount[],
  refreshKey?: unknown,
): Record<string, ProviderAccountIdentity | null> {
  const [identities, setIdentities] = useState<Record<string, ProviderAccountIdentity | null>>({});
  const key = accounts.map(identityKey).join("|");

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      accounts.map(
        async (account) =>
          [
            identityKey(account),
            await refreshProviderAccountIdentity(account.provider, account.id),
          ] as const,
      ),
    ).then((entries) => {
      if (!cancelled) setIdentities(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshKey]);

  return identities;
}

/** Same person and org; Claude lets one email hold several organizations. */
function signInKey(identity: ProviderAccountIdentity | null | undefined) {
  const email = identity?.email?.trim().toLowerCase();
  if (!email) return null;
  return `${email}|${identity?.organization?.trim().toLowerCase() ?? ""}`;
}

/**
 * Accounts of one provider that resolve to the same sign-in as an earlier
 * account in the list, keyed by `identityKey` of the later one.
 */
export function duplicateAccountSignIns(
  accounts: ProviderAccount[],
  identities: Record<string, ProviderAccountIdentity | null | undefined>,
): Record<string, ProviderAccount> {
  const firstSeen = new Map<string, ProviderAccount>();
  const duplicates: Record<string, ProviderAccount> = {};
  for (const account of accounts) {
    const key = signInKey(identities[identityKey(account)]);
    if (!key) continue;
    const scoped = `${account.provider}|${key}`;
    const original = firstSeen.get(scoped);
    if (original) duplicates[identityKey(account)] = original;
    else firstSeen.set(scoped, account);
  }
  return duplicates;
}
