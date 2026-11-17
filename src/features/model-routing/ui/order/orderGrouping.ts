import type {
  ModelRoutingEntry,
  ModelRoutingRole,
  ModelRoutingChoice,
} from "../../../../shared/model/host-contracts/model-routing";
import {
  defaultProviderAccountId,
  providerAccounts,
  supportsProviderAccounts,
  type ProviderAccount,
} from "../../../providers/public/providerAccounts";
import type { EntryKind } from "../../model/modelRoutingDraft";
import { MODEL_ROLE_METADATA } from "../../model/modelRoutingRoles";
import { entryAccountKind } from "./useEntryAccount";

/** The list an entry sits in: its account's kind, shared when the account has none. */
export const kindOf = (entry: ModelRoutingEntry): EntryKind => entryAccountKind(entry) ?? "shared";

export type AccountGroup = {
  key: string;
  harness: ModelRoutingEntry["harness"];
  /** Empty for providers without accounts. */
  accountId: string;
  /** The account, when it still exists. */
  account?: ProviderAccount;
  /** Each row keeps its priority position inside the list it was grouped from. */
  rows: { entry: ModelRoutingEntry; index: number }[];
};

/** The account id an entry runs on; empty for providers without accounts. */
export function entryAccountId(entry: Pick<ModelRoutingEntry, "harness" | "providerAccountId">) {
  return supportsProviderAccounts(entry.harness)
    ? (entry.providerAccountId ?? defaultProviderAccountId(entry.harness))
    : "";
}

/**
 * Groups one kind's entries by provider account. Groups appear in the order of their first row
 * and rows keep their priority order, so the real position is always `index + 1`.
 */
export function groupByAccount(entries: readonly ModelRoutingEntry[]): AccountGroup[] {
  const groups = new Map<string, AccountGroup>();
  entries.forEach((entry, index) => {
    const accountId = entryAccountId(entry);
    const key = `${entry.harness}\u0000${accountId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        harness: entry.harness,
        accountId,
        account: supportsProviderAccounts(entry.harness)
          ? providerAccounts(entry.harness).find((candidate) => candidate.id === accountId)
          : undefined,
        rows: [],
      };
      groups.set(key, group);
    }
    group.rows.push({ entry, index });
  });
  return [...groups.values()];
}

const usesOrder = (role: ModelRoutingRole, choice: ModelRoutingChoice | undefined) =>
  choice ? choice.kind === "order" : !role.startsWith("text.");

/**
 * How many jobs follow the model order: bound to it, or unbound. Unbound `text.*` helpers keep
 * their own cheap automatic choice and only count when bound to the order.
 */
export function jobsUsingOrder(roles: Partial<Record<ModelRoutingRole, ModelRoutingChoice>>) {
  return MODEL_ROLE_METADATA.filter(({ role }) => usesOrder(role, roles[role])).length;
}
