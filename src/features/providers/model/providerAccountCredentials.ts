import { invoke } from "@tauri-apps/api/core";
import type { ProviderAccountProvider } from "./providerAccounts";

/** Remove a named profile's native credentials before its UI metadata. */
export async function removeProviderAccountCredentials(
  provider: ProviderAccountProvider,
  accountId: string,
): Promise<void> {
  await invoke("provider_account_remove", { provider, accountId });
}

/** Clear a re-login without deleting the existing profile's settings or history. */
export async function signOutProviderAccountCredentials(
  provider: ProviderAccountProvider,
  accountId: string,
): Promise<void> {
  await invoke("provider_account_remove", {
    provider,
    accountId,
    credentialsOnly: true,
  });
}
