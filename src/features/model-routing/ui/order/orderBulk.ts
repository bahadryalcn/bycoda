import {
  MODEL_ROUTING_MAX_ENTRIES,
  type ModelRoutingEntry,
} from "../../../../shared/model/host-contracts/model-routing";
import { modelEffortSetting, resolveModel } from "../../../sessions/public/models";
import {
  entrySettings,
  removeOrderEntry,
  setPoolMembers,
  type OrderDraft,
} from "../../model/modelRoutingDraft";
import type { SetupCandidate } from "../../model/smartSetup";
import { entryAccountId } from "./orderGrouping";

/** Removes every listed entry; the first model that would empty a group stops the whole edit. */
export function removeEntries(draft: OrderDraft, ids: readonly string[]): OrderDraft {
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
      ...Object.fromEntries(added.map((entry) => [entry.id, "0"])),
    },
    routing: { ...draft.routing, entries: [...draft.routing.entries, ...added] },
  };
}
