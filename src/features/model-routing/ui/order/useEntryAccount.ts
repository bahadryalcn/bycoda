import type { ModelRoutingEntry } from "../../../../shared/model/host-contracts/model-routing";
import {
  defaultProviderAccountId,
  providerAccounts,
  supportsProviderAccounts,
  type ProviderAccount,
} from "../../../providers/public/providerAccounts";
import { useProviderAccounts } from "../../../providers/public/useProviderAccounts";

export type EntryAccount = {
  /** Only Claude and Codex entries carry accounts. */
  supported: boolean;
  id: string;
  accounts: ProviderAccount[];
  /** The selected account, when it still exists. */
  account?: ProviderAccount;
  /** The account's type, with Personal for legacy profiles. */
  kind?: "personal" | "work";
};

/**
 * The provider account an entry runs on, read outside React (e.g. to build menu rows);
 * undefined for shared accounts.
 */
export function entryProviderAccount(
  entry: Pick<ModelRoutingEntry, "harness" | "providerAccountId">,
): ProviderAccount | undefined {
  if (!supportsProviderAccounts(entry.harness)) return undefined;
  const id = entry.providerAccountId ?? defaultProviderAccountId(entry.harness);
  return providerAccounts(entry.harness).find((candidate) => candidate.id === id);
}

/** The Personal/Work kind of the account an entry runs on; undefined for shared accounts. */
export function entryAccountKind(
  entry: Pick<ModelRoutingEntry, "harness" | "providerAccountId">,
): "personal" | "work" | undefined {
  const account = entryProviderAccount(entry);
  return account ? (account.kind ?? "personal") : undefined;
}

/** The account an order entry runs on, with its Personal/Work kind. */
export function useEntryAccount(
  entry: Pick<ModelRoutingEntry, "harness" | "providerAccountId">,
): EntryAccount {
  const provider = supportsProviderAccounts(entry.harness) ? entry.harness : undefined;
  // Shared store snapshot: rows get the same array identity, so no per-row parse.
  const accounts = useProviderAccounts(provider ?? null);
  const id = entry.providerAccountId ?? (provider ? defaultProviderAccountId(provider) : "");
  const account = accounts.find((candidate) => candidate.id === id);
  return {
    supported: provider !== undefined,
    id,
    accounts,
    account,
    kind: account ? (account.kind ?? "personal") : undefined,
  };
}
