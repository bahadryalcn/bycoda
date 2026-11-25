import type { ModelRoutingEntry } from "../../../../shared/model/host-contracts/model-routing";
import {
  defaultProviderAccountId,
  providerAccounts,
  supportsProviderAccounts,
  type ProviderAccount,
} from "../../../providers/public/providerAccounts";
import { useProviderAccounts } from "../../../providers/public/useProviderAccounts";
import { useModelSource, type ModelSource } from "../../../sessions/public/modelSource";

type EntryAccountProfile = Pick<ProviderAccount, "id" | "label" | "isDefault" | "kind"> & {
  color?: string;
};

export type EntryAccount = {
  supported: boolean;
  id: string;
  accounts: readonly EntryAccountProfile[];
  known: boolean;
  /** The selected account, when it still exists. */
  account?: EntryAccountProfile;
  /** The account's type, with Personal for legacy profiles. */
  kind?: "personal" | "work";
};

/**
 * The provider account an entry runs on, read outside React (e.g. to build menu rows);
 * undefined for shared accounts.
 */
export function entryProviderAccount(
  entry: Pick<ModelRoutingEntry, "harness" | "providerAccountId">,
  source?: ModelSource,
): EntryAccountProfile | undefined {
  if (!supportsProviderAccounts(entry.harness)) return undefined;
  const accounts =
    source?.accounts === undefined
      ? providerAccounts(entry.harness)
      : (source.accounts[entry.harness] ?? []);
  return accounts.find((candidate) => candidate.id === entryAccountId(entry, source));
}

export function entryAccountId(
  entry: Pick<ModelRoutingEntry, "harness" | "providerAccountId">,
  source?: ModelSource,
) {
  if (!supportsProviderAccounts(entry.harness)) return "";
  return (
    entry.providerAccountId ??
    (source?.accounts === undefined
      ? defaultProviderAccountId(entry.harness)
      : (source.accounts[entry.harness]?.find((account) => account.isDefault)?.id ?? "default"))
  );
}

/** The Personal/Work kind of the account an entry runs on; undefined for shared accounts. */
export function entryAccountKind(
  entry: Pick<ModelRoutingEntry, "harness" | "providerAccountId">,
  source?: ModelSource,
): "personal" | "work" | undefined {
  const account = entryProviderAccount(entry, source);
  return account ? (account.kind ?? "personal") : undefined;
}

/** The account an order entry runs on, with its Personal/Work kind. */
export function useEntryAccount(
  entry: Pick<ModelRoutingEntry, "harness" | "providerAccountId">,
): EntryAccount {
  const source = useModelSource();
  const provider = supportsProviderAccounts(entry.harness) ? entry.harness : undefined;
  // Shared store snapshot: rows get the same array identity, so no per-row parse.
  const localAccounts = useProviderAccounts(
    source.accounts === undefined ? (provider ?? null) : null,
  );
  const accounts =
    provider && source.accounts !== undefined ? (source.accounts[provider] ?? []) : localAccounts;
  const id = entryAccountId(entry, source);
  const account = accounts.find((candidate) => candidate.id === id);
  return {
    supported: provider !== undefined,
    id,
    accounts,
    known: source.accountsKnown?.(entry.harness) !== false,
    account,
    kind: account ? (account.kind ?? "personal") : undefined,
  };
}
