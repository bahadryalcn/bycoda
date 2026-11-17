import { useSyncExternalStore } from "react";
import type { ModelRoutingEntry } from "../../../../shared/model/host-contracts/model-routing";
import {
  defaultProviderAccountId,
  providerAccounts,
  subscribeProviderAccounts,
  supportsProviderAccounts,
  type ProviderAccount,
} from "../../../providers/public/providerAccounts";
import { inferAccountKind } from "../../model/modelProfile";

export type EntryAccount = {
  /** Only Claude and Codex entries carry accounts. */
  supported: boolean;
  id: string;
  accounts: ProviderAccount[];
  /** The selected account, when it still exists. */
  account?: ProviderAccount;
  /** The account's own kind, else the kind its label implies. */
  kind?: "personal" | "work";
};

/** The Personal/Work kind of the account an entry runs on; undefined for shared accounts. */
export function entryAccountKind(
  entry: Pick<ModelRoutingEntry, "harness" | "providerAccountId">,
): "personal" | "work" | undefined {
  if (!supportsProviderAccounts(entry.harness)) return undefined;
  const id = entry.providerAccountId ?? defaultProviderAccountId(entry.harness);
  const account = providerAccounts(entry.harness).find((candidate) => candidate.id === id);
  return account ? (account.kind ?? inferAccountKind(account.label)) : undefined;
}

/** The account an order entry runs on, with its Personal/Work kind. */
export function useEntryAccount(
  entry: Pick<ModelRoutingEntry, "harness" | "providerAccountId">,
): EntryAccount {
  const provider = supportsProviderAccounts(entry.harness) ? entry.harness : undefined;
  const snapshot = useSyncExternalStore(subscribeProviderAccounts, () =>
    JSON.stringify(provider ? providerAccounts(provider) : []),
  );
  const accounts: ProviderAccount[] = JSON.parse(snapshot);
  const id = entry.providerAccountId ?? (provider ? defaultProviderAccountId(provider) : "");
  const account = accounts.find((candidate) => candidate.id === id);
  return {
    supported: provider !== undefined,
    id,
    accounts,
    account,
    kind: account ? (account.kind ?? inferAccountKind(account.label)) : undefined,
  };
}
