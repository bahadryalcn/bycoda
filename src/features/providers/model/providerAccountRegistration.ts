import { loginHarness } from "../../../integrations/harness/core/auth";
import { providerAccounts, saveProviderAccount, type ProviderAccount } from "./providerAccounts";
import {
  readProviderAccountIdentity,
  type ProviderAccountIdentity,
} from "./providerAccountIdentity";
import { removeProviderAccountCredentials } from "./providerAccountCredentials";
import { clearCachedRateLimits } from "./rateLimitsCache";

export function sameSignedInIdentity(
  left: ProviderAccountIdentity | null,
  right: ProviderAccountIdentity | null,
): boolean {
  const email = left?.email?.trim().toLowerCase();
  return Boolean(
    email &&
    email === right?.email?.trim().toLowerCase() &&
    (left?.organization?.trim().toLowerCase() ?? "") ===
      (right?.organization?.trim().toLowerCase() ?? ""),
  );
}

export async function assertUniqueProviderAccount(account: ProviderAccount): Promise<void> {
  const identity = await readProviderAccountIdentity(account.provider, account.id);
  if (!identity?.email?.trim())
    throw new Error("Could not verify the signed-in account. Please try again.");
  const existing = providerAccounts(account.provider).filter((entry) => entry.id !== account.id);
  const identities = await Promise.all(
    existing.map((entry) => readProviderAccountIdentity(entry.provider, entry.id)),
  );
  const duplicate = existing.find((_, index) => sameSignedInIdentity(identity, identities[index]));
  if (duplicate) throw new Error(`This account is already added as “${duplicate.label}”.`);
}

const registering = new Set<string>();

/** Do not publish a profile until login and identity checks succeed. */
export async function registerProviderAccount(
  account: ProviderAccount,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (registering.has(account.provider))
    throw new Error("An account sign-in is already in progress for this provider.");
  registering.add(account.provider);
  try {
    if (typeof navigator !== "undefined" && navigator.locks) {
      await navigator.locks.request(
        `bycoda-account-registration:${account.provider}`,
        { signal },
        () => register(account, signal),
      );
    } else {
      await register(account, signal);
    }
  } finally {
    registering.delete(account.provider);
  }
}

async function register(account: ProviderAccount, signal?: AbortSignal): Promise<void> {
  try {
    if (signal) await loginHarness(account.provider, account.id, signal);
    else await loginHarness(account.provider, account.id);
    signal?.throwIfAborted();
    await assertUniqueProviderAccount(account);
    signal?.throwIfAborted();
    saveProviderAccount(account);
  } catch (error) {
    try {
      await removeProviderAccountCredentials(account.provider, account.id);
    } catch {
      throw new Error(
        `${error instanceof Error ? error.message : "Could not add account"} Temporary profile cleanup failed; retry before adding another account.`,
      );
    } finally {
      clearCachedRateLimits(account.provider, account.id);
    }
    throw error;
  }
}
