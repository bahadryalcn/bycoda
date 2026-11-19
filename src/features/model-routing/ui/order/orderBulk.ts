import {
  MODEL_ROUTING_MAX_ENTRIES,
  type ModelRoutingEntry,
} from "../../../../shared/model/host-contracts/model-routing";
import { t } from "../../../../shared/i18n";
import { modelEffortSetting, resolveModel } from "../../../sessions/public/models";
import {
  entrySettings,
  removeOrderEntry,
  setPoolMembers,
  type OrderDraft,
} from "../../model/modelRoutingDraft";
import type { SetupCandidate } from "../../model/smartSetup";
import { entryAccountId } from "./orderGrouping";

/**
 * The choice "Add model" starts from: the last entry's provider when the Host still offers it,
 * otherwise the first offered choice. Undefined when the Host offers none.
 */
export function addChoiceFor(
  candidates: readonly SetupCandidate[],
  lastHarness?: string,
): SetupCandidate | undefined {
  return candidates.find((candidate) => candidate.target.harness === lastHarness) ?? candidates[0];
}

/** Removes every listed entry; a group the whole selection would empty stops the edit and is named. */
export function removeEntries(draft: OrderDraft, ids: readonly string[]): OrderDraft {
  const gone = new Set(ids);
  const emptied = draft.routing.pools.find(
    (pool) =>
      pool.entryIds.length > 0 &&
      !pool.poolIds?.length &&
      pool.entryIds.every((entryId) => gone.has(entryId)),
  );
  if (emptied)
    throw new Error(
      t('Group "{p0}" would be empty. Remove it or keep one of its models.', {
        p0: emptied.name || emptied.id,
      }),
    );
  return ids.reduce((current, id) => removeOrderEntry(current, id), draft);
}

const effortOf = (entry: Pick<ModelRoutingEntry, "harness" | "model">) =>
  modelEffortSetting(resolveModel(entry.harness, entry.model));

/** Effort values any of the entries accepts, in the order the models list them. */
export function effortChoices(entries: readonly ModelRoutingEntry[]) {
  const choices = new Map<string, string>();
  for (const entry of entries)
    for (const option of effortOf(entry)?.options ?? [])
      if (!choices.has(option.value)) choices.set(option.value, option.label ?? option.value);
  return [...choices].map(([value, label]) => ({ value, label }));
}

/** Sets the effort on every listed entry that accepts the value; the others keep theirs. */
export function setEntriesEffort(
  draft: OrderDraft,
  ids: ReadonlySet<string>,
  value: string,
): OrderDraft {
  return {
    ...draft,
    routing: {
      ...draft.routing,
      entries: draft.routing.entries.map((entry) => {
        const setting = ids.has(entry.id) ? effortOf(entry) : undefined;
        if (!setting?.options.some((option) => option.value === value)) return entry;
        return {
          ...entry,
          modelSettings: entrySettings({ ...entry.modelSettings, [setting.id]: value }),
        };
      }),
    },
  };
}

/** Appends the listed entries to a group, skipping those it already has. */
export function addEntriesToPool(
  draft: OrderDraft,
  poolId: string,
  ids: readonly string[],
): OrderDraft {
  const pool = draft.routing.pools.find((candidate) => candidate.id === poolId);
  if (!pool) return draft;
  const known = new Set(pool.entryIds);
  return setPoolMembers(draft, poolId, {
    entryIds: [...pool.entryIds, ...ids.filter((id) => !known.has(id))],
    poolIds: pool.poolIds ?? [],
  });
}

/** Adds the catalog models one account can run that the order does not list for it yet. */
export function addAccountModels(
  draft: OrderDraft,
  candidates: readonly SetupCandidate[],
  harness: ModelRoutingEntry["harness"],
  accountId: string,
): OrderDraft {
  const listed = new Set(
    draft.routing.entries
      .filter((entry) => entry.harness === harness && entryAccountId(entry) === accountId)
      .map((entry) => entry.model),
  );
  const missing = candidates.filter(
    (candidate) =>
      candidate.target.harness === harness &&
      entryAccountId(candidate.target) === accountId &&
      !listed.has(candidate.target.model),
  );
  if (draft.routing.entries.length + missing.length > MODEL_ROUTING_MAX_ENTRIES)
    throw new Error("The model list is full.");
  const added = missing.map((candidate) => ({
    ...candidate.target,
    id: crypto.randomUUID(),
    modelSettings: entrySettings(candidate.target.modelSettings),
    unknownLimit: "use" as const,
  }));
  return {
    ...draft,
    percentages: {
      ...draft.percentages,
      ...Object.fromEntries(added.map((entry) => [entry.id, ""])),
    },
    routing: { ...draft.routing, entries: [...draft.routing.entries, ...added] },
  };
}
