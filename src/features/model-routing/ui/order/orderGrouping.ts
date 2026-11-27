import type {
  ModelRoutingEntry,
  ModelRoutingRole,
  ModelRoutingChoice,
} from "../../../../shared/model/host-contracts/model-routing";
import type { ModelSource } from "../../../sessions/public/modelSource";
import type { EntryKind } from "../../model/modelRoutingDraft";
import { MODEL_ROLE_METADATA } from "../../model/modelRoutingRoles";
import { entryAccountId, entryAccountKind, entryProviderAccount } from "./useEntryAccount";

/** The list an entry sits in: its account's kind, shared when the account has none. */
export const kindOf = (entry: ModelRoutingEntry, source?: ModelSource): EntryKind =>
  entryAccountKind(entry, source) ?? "shared";

export type AccountGroup = {
  key: string;
  harness: ModelRoutingEntry["harness"];
  /** Empty for providers without accounts. */
  accountId: string;
  /** The account, when it still exists. */
  account?: ReturnType<typeof entryProviderAccount>;
  accountsKnown?: boolean;
  /** Each row keeps its priority position inside the list it was grouped from. */
  rows: { entry: ModelRoutingEntry; index: number }[];
};

/**
 * Groups one kind's entries by provider account. Groups appear in the order of their first row
 * and rows keep their priority order, so the real position is always `index + 1`.
 */
export function groupByAccount(
  entries: readonly ModelRoutingEntry[],
  source?: ModelSource,
): AccountGroup[] {
  const groups = new Map<string, AccountGroup>();
  entries.forEach((entry, index) => {
    const accountId = entryAccountId(entry, source);
    const key = `${entry.harness}\u0000${accountId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        harness: entry.harness,
        accountId,
        account: entryProviderAccount(entry, source),
        accountsKnown: source?.accountsKnown?.(entry.harness),
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
 * The jobs that follow the model order: bound to it, or unbound. Unbound `text.*` helpers keep
 * their own cheap automatic choice and only count when bound to the order.
 */
export function jobsUsingOrder(roles: Partial<Record<ModelRoutingRole, ModelRoutingChoice>>) {
  return MODEL_ROLE_METADATA.filter(({ role }) => usesOrder(role, roles[role]));
}
