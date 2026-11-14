import { useSyncExternalStore } from "react";
import type { ModelRoutingEntry } from "../../../../shared/model/host-contracts/model-routing";
import {
  defaultProviderAccountId,
  providerAccounts,
  subscribeProviderAccounts,
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

/** The account an order entry runs on, with its Personal/Work kind. */
export function useEntryAccount(
  entry: Pick<ModelRoutingEntry, "harness" | "providerAccountId">,
): EntryAccount {
  const provider =
    entry.harness === "claude" || entry.harness === "codex" ? entry.harness : undefined;
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
