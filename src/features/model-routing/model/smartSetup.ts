import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import {
  MODEL_ROUTING_MAX_ENTRIES,
  MODEL_ROUTING_MAX_POOLS,
  type ModelRoutingEntry,
  type ModelRoutingPool,
  type ModelRoutingScope,
  type ModelRoutingTarget,
} from "../../../shared/model/host-contracts/model-routing";
import { REMOTE_PROVIDERS } from "../../connections/public/protocol";
import {
  providerAccounts,
  supportsProviderAccounts,
} from "../../providers/public/providerAccounts";
import {
  defaultModelSettings,
  isModelEnabled,
  loadHiddenPickerProviders,
} from "../../sessions/public/models";
import type { ModelSource } from "../../sessions/public/modelSource";
import { entrySettings, type OrderDraft } from "./modelRoutingDraft";
import { inferAccountKind, modelProfile, type ModelProfile } from "./modelProfile";

export type SetupAccount = {
  id?: string;
  label: string;
  kind?: ModelRoutingScope;
};
export type SetupCandidate = {
  target: ModelRoutingTarget;
  modelName: string;
  account?: SetupAccount;
  profile: ModelProfile;
};
export type SetupPoolNames = Record<"smartest" | "balanced" | "fast" | "work" | "personal", string>;

const targetKey = (target: ModelRoutingTarget) =>
  JSON.stringify([target.harness, target.providerAccountId ?? "default", target.model]);

function poolName(value: string): string {
  let budget = 80;
  let name = truncateGraphemes(value.trim(), budget);
  // The wire schema counts UTF-16 units; keep whole graphemes within that budget.
  while (name.length > 80) name = truncateGraphemes(value.trim(), --budget);
  return name;
}

/** Every active account x enabled model of the source, with its profile and account kind. */
export function setupCandidates(source: ModelSource): SetupCandidate[] {
  // Explicit Host sources never read this device's account profiles or visibility preferences.
  const hidden = source.id ? [] : loadHiddenPickerProviders();
  return REMOTE_PROVIDERS.flatMap((harness) => {
    if (!source.available(harness) || hidden.includes(harness)) return [];
    const models = source
      .modelsFor(harness)
      .filter((model) => model.harness === harness && (source.id || isModelEnabled(model.id)));
    const accounts = supportsProviderAccounts(harness)
      ? source.accounts !== undefined
        ? (source.accounts[harness] ?? [])
        : source.id
          ? []
          : providerAccounts(harness)
      : [undefined];
    return accounts.flatMap((account) =>
      models.map((model): SetupCandidate => {
        const explicit =
          account && "kind" in account
            ? (account.kind as ModelRoutingScope | undefined)
            : undefined;
        const kind = account ? (explicit ?? inferAccountKind(account.label)) : undefined;
        return {
          target: {
            harness,
            model: model.id,
            ...(account ? { providerAccountId: account.id } : {}),
            modelSettings: defaultModelSettings(model),
          },
          modelName: model.name,
          ...(account
            ? {
                account: {
                  id: account.id,
                  label: account.label,
                  ...(kind ? { kind } : {}),
                },
              }
            : {}),
          profile: modelProfile(harness, model.id),
        };
      }),
    );
  });
}

const isDefaultAccount = (entry: ModelRoutingTarget) =>
  !entry.providerAccountId || entry.providerAccountId === "default";

/** Smartest first, then cheaper, then the default account; stable. */
function compareEntries(a: ModelRoutingEntry, b: ModelRoutingEntry): number {
  const x = modelProfile(a.harness, a.model);
  const y = modelProfile(b.harness, b.model);
  return (
    y.intelligence - x.intelligence ||
    x.cost - y.cost ||
    Number(isDefaultAccount(b)) - Number(isDefaultAccount(a))
  );
}

/**
 * Add every missing candidate, sort the order and create the missing tier and scope pools.
 * Existing entries keep their ids, limits and settings; existing pools are never changed.
 */
export function applySmartSetup(
  draft: OrderDraft,
  candidates: SetupCandidate[],
  names: SetupPoolNames,
): OrderDraft {
  const entries = [...draft.routing.entries];
  const pools = [...draft.routing.pools];
  const percentages = { ...draft.percentages };
  const ids = new Map<string, string>();
  for (const entry of entries) {
    const key = targetKey(entry);
    if (!ids.has(key)) ids.set(key, entry.id);
  }
  const byEntryId = new Map<string, SetupCandidate>();
  for (const candidate of candidates) {
    const key = targetKey(candidate.target);
    let id = ids.get(key);
    if (!id) {
      if (entries.length >= MODEL_ROUTING_MAX_ENTRIES)
        throw new Error(
          "Not enough room in the model order. Disable unused catalog models and try again.",
        );
      id = crypto.randomUUID();
      entries.push({
        ...candidate.target,
        id,
        modelSettings: entrySettings(candidate.target.modelSettings),
        unknownLimit: "use",
      });
      percentages[id] = "0";
      ids.set(key, id);
    }
    if (!byEntryId.has(id)) byEntryId.set(id, candidate);
  }
  const sorted = [
    ...entries.filter((entry) => byEntryId.has(entry.id)).sort(compareEntries),
    ...entries.filter((entry) => !byEntryId.has(entry.id)),
  ];

  const membersOf = (include: (candidate: SetupCandidate) => boolean) =>
    sorted.filter((entry) => byEntryId.has(entry.id) && include(byEntryId.get(entry.id)!));
  const withKinds = candidates.some((candidate) => candidate.account?.kind);
  const wanted: [string, string[]][] = [
    [names.smartest, membersOf((c) => c.profile.intelligence >= 4).map((e) => e.id)],
    [names.balanced, membersOf((c) => c.profile.intelligence === 3).map((e) => e.id)],
    [names.fast, membersOf((c) => c.profile.intelligence <= 2).map((e) => e.id)],
    ...(withKinds
      ? ([
          [names.work, membersOf((c) => c.account?.kind !== "personal").map((e) => e.id)],
          [names.personal, membersOf((c) => c.account?.kind !== "work").map((e) => e.id)],
        ] satisfies [string, string[]][])
      : []),
  ];
  for (const [name, entryIds] of wanted) {
    const lower = poolName(name).toLowerCase();
    if (!entryIds.length || pools.some((pool) => pool.name.trim().toLowerCase() === lower))
      continue;
    if (pools.length >= MODEL_ROUTING_MAX_POOLS)
      throw new Error("Not enough room for catalog pools. Remove unused pools and try again.");
    pools.push({
      id: crypto.randomUUID(),
      name: poolName(name),
      entryIds,
    } satisfies ModelRoutingPool);
  }
  return {
    ...draft,
    percentages,
    routing: { ...draft.routing, entries: sorted, pools },
  };
}

/** Reorder the main order only; pools, limits and settings are untouched. */
export function sortOrderDraft(draft: OrderDraft, by: "intelligence" | "cost"): OrderDraft {
  const compare = (a: ModelRoutingEntry, b: ModelRoutingEntry) => {
    const x = modelProfile(a.harness, a.model);
    const y = modelProfile(b.harness, b.model);
    return by === "intelligence"
      ? y.intelligence - x.intelligence || x.cost - y.cost
      : x.cost - y.cost || y.intelligence - x.intelligence;
  };
  return {
    ...draft,
    routing: {
      ...draft.routing,
      entries: [...draft.routing.entries].sort(compare),
    },
  };
}
