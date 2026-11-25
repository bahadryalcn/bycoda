import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import {
  MODEL_ROUTING_MAX_ENTRIES,
  MODEL_ROUTING_MAX_POOLS,
  type ModelRoutingDelegation,
  type ModelRoutingEntry,
  type ModelRoutingPool,
  type ModelRoutingRole,
  type ModelRoutingScope,
  type ModelRoutingTarget,
} from "../../../shared/model/host-contracts/model-routing";
import type { SetupCatalog } from "./smartSetupCatalog";
import {
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENT_MAX_EFFORT_KEY,
  CROSS_SUBAGENTS_KEY,
  EFFORT_LEVELS,
  encodeSubagents,
} from "../../../shared/model/host-contracts/delegation";
import { modelRoutingPoolCycle } from "../../../shared/model/modelRoutingPools";
import { REMOTE_PROVIDERS } from "../../connections/public/protocol";
import {
  providerAccounts,
  supportsProviderAccounts,
} from "../../providers/public/providerAccounts";
import {
  defaultModelSettings,
  isModelEnabled,
  loadHiddenPickerProviders,
  modelEffortSetting,
} from "../../sessions/public/models";
import type { ModelSource } from "../../sessions/public/modelSource";
import { catalogModelFacts, valueScore } from "./modelCatalogFacts";
import { entrySettings, type OrderDraft } from "./modelRoutingDraft";
import { modelProfile, type ModelProfile } from "./modelProfile";

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
  /** The model's reasoning-effort setting and the values it accepts, when it has one. */
  effort?: { id: string; options: string[] };
};
export type SetupPoolNames = Record<
  "smartest" | "balanced" | "light" | "work" | "personal",
  string
>;

/**
 * A complete setup proposal over the candidate list: candidate indexes in priority order,
 * pools by name, and role bindings by pool name. The AI planner and the researched rules
 * both produce one; `applySmartSetup` validates it against the draft.
 */
export type SetupPlan = {
  order: number[];
  pools: { name: string; members: number[]; includes: string[] }[];
  roles: Partial<Record<ModelRoutingRole, { pool: string } | "order">>;
};

const targetKey = (target: ModelRoutingTarget) =>
  JSON.stringify([target.harness, target.providerAccountId ?? "default", target.model]);
const accountKey = (target: ModelRoutingTarget) =>
  JSON.stringify([target.harness, target.providerAccountId ?? "default"]);

function poolName(value: string): string {
  let budget = 80;
  let name = truncateGraphemes(value.trim(), budget);
  // The wire schema counts UTF-16 units; keep whole graphemes within that budget.
  while (name.length > 80) name = truncateGraphemes(value.trim(), --budget);
  return name;
}

/** Every active account x enabled model of the source, with its profile and account kind. */
export function setupCandidates(source: ModelSource, catalog?: SetupCatalog): SetupCandidate[] {
  // Explicit Host sources never read this device's account profiles or visibility preferences.
  const hidden = source.id ? [] : loadHiddenPickerProviders();
  return REMOTE_PROVIDERS.flatMap((harness) => {
    if (!source.available(harness) || hidden.includes(harness)) return [];
    const hostModels = catalog?.models[harness];
    const models = (
      hostModels?.length
        ? hostModels.map((model) => ({ ...model, harness }))
        : source.modelsFor(harness)
    ).filter((model) => model.harness === harness && (source.id || isModelEnabled(model.id)));
    const modelIdentity = (id: string) => {
      const native = id.replace(new RegExp(`^${harness}:`), "");
      return harness === "claude" ? native.replace(/^claude-/, "").replace(/\./g, "-") : native;
    };
    const concrete = new Set(
      models
        .filter((model) => !model.aliasTarget)
        .map((model) => modelIdentity(model.nativeId ?? model.id)),
    );
    const preferred = new Map(
      models
        .filter((model) => !model.aliasTarget || !concrete.has(modelIdentity(model.aliasTarget)))
        .map((model) => [model.id, model]),
    );
    const accounts = supportsProviderAccounts(harness)
      ? source.accounts !== undefined
        ? (source.accounts[harness] ?? [])
        : source.id
          ? []
          : providerAccounts(harness)
      : [undefined];
    return accounts.flatMap((account) =>
      [...preferred.values()].map((model): SetupCandidate => {
        const effort = modelEffortSetting(model);
        const explicit =
          account && "kind" in account
            ? (account.kind as ModelRoutingScope | undefined)
            : undefined;
        const kind = account ? (explicit ?? "personal") : undefined;
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
          ...(effort
            ? { effort: { id: effort.id, options: effort.options.map((option) => option.value) } }
            : {}),
        };
      }),
    );
  });
}

const isDefaultAccount = (entry: ModelRoutingTarget) =>
  !entry.providerAccountId || entry.providerAccountId === "default";

// Midpoint list price of each cost bucket, for models the researched table does not know.
const BUCKET_USD = { 1: 2, 2: 7, 3: 15, 4: 30 } as const;

/** Benefit per cost of one candidate: researched facts when known, else its profile. */
export function candidateValue(candidate: SetupCandidate): number {
  const facts = catalogModelFacts(candidate.target.model);
  if (facts) return valueScore(facts);
  const { intelligence, cost } = candidate.profile;
  const usd = BUCKET_USD[cost];
  return valueScore({ score: 40 + intelligence * 11, inputUsd: usd, outputUsd: usd });
}

/** Researched capability score, else the profile's estimate on the same 0-100 scale. */
function candidateScore(candidate: SetupCandidate): number {
  return (
    catalogModelFacts(candidate.target.model)?.score ?? 40 + candidate.profile.intelligence * 11
  );
}

/**
 * Where a model belongs in the main order. Owner decision 2026-11-17: strong models at a
 * moderate price (Opus, Sol) do most work; cheaper capable models (Sonnet, Terra) come next;
 * top-priced models (Fable, Astra) are kept for when those run out; light models come last.
 */
export type SetupTier = "workhorse" | "standard" | "premium" | "light";
const TIER_RANK: Record<SetupTier, number> = { workhorse: 0, standard: 1, premium: 2, light: 3 };
export function candidateTier(candidate: SetupCandidate): SetupTier {
  const { intelligence, cost } = candidate.profile;
  if (intelligence <= 2) return "light";
  if (intelligence === 3) return "standard";
  return cost >= 4 ? "premium" : "workhorse";
}

/**
 * The researched baseline: tier first, then capability within the tier, cheaper on ties,
 * then the default account; stable for equal candidates.
 */
export function baselineOrder(candidates: SetupCandidate[]): number[] {
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (a, b) =>
        TIER_RANK[candidateTier(a.candidate)] - TIER_RANK[candidateTier(b.candidate)] ||
        candidateScore(b.candidate) - candidateScore(a.candidate) ||
        a.candidate.profile.cost - b.candidate.profile.cost ||
        Number(isDefaultAccount(b.candidate.target)) -
          Number(isDefaultAccount(a.candidate.target)) ||
        a.index - b.index,
    )
    .map(({ index }) => index);
}

/**
 * What each job needs from its model. Light jobs (titles, commit text, translation, quick
 * replies) must run on cheap, fast models; heavy jobs (reviews, planning) on the strongest;
 * standard jobs on the best benefit per cost among capable models.
 */
export type RoleNeed = "light" | "standard" | "heavy";
export const ROLE_NEED: Record<ModelRoutingRole, RoleNeed> = {
  "task.worker": "standard",
  "task.reviewer": "heavy",
  "goal.planner": "heavy",
  "goal.finalReview": "heavy",
  steward: "standard",
  automation: "standard",
  "crew.member": "standard",
  "assistant.worker": "standard",
  "assistant.planning": "heavy",
  "assistant.chief": "heavy",
  "assistant.reply": "light",
  "voice.reply": "light",
  "text.translation": "light",
  "text.reprompt": "light",
  "text.title": "light",
  "text.git": "light",
  "text.skillGrouping": "light",
  "text.themeGenerator": "light",
  "text.routingSetup": "standard",
};

/** Whether a model suits a need: light is cheap and quick, heavy is strong, standard is capable and not top-priced. */
export function fitsNeed(candidate: SetupCandidate, need: RoleNeed): boolean {
  const { intelligence, cost } = candidate.profile;
  return need === "light"
    ? cost <= 1 && intelligence <= 3
    : need === "heavy"
      ? intelligence >= 4
      : intelligence >= 3 && cost <= 3;
}

/**
 * The reasoning effort smart setup picks per need: light jobs low, standard jobs medium, heavy
 * jobs high. Smart setup never goes above high; higher levels stay the owner's own choice.
 */
type SetupEffort = NonNullable<ModelRoutingPool["effort"]>;
const effortRank = (value: string | undefined) => (value ? EFFORT_LEVELS.indexOf(value) : -1);
const CEILING = effortRank("high");

/** The candidate's settings at the supported level closest to `effort`, never above high. */
export function settingsAtEffort(
  candidate: SetupCandidate,
  effort: SetupEffort,
): Record<string, string> {
  const setting = candidate.effort;
  const want = effortRank(effort);
  const usable = (setting?.options ?? []).filter((value) => {
    const rank = effortRank(value);
    return rank > effortRank("none") && rank <= CEILING;
  });
  const best = usable.sort(
    (a, b) =>
      Math.abs(effortRank(a) - want) - Math.abs(effortRank(b) - want) ||
      effortRank(b) - effortRank(a),
  )[0];
  return setting && best
    ? { ...candidate.target.modelSettings, [setting.id]: best }
    : candidate.target.modelSettings;
}

/** A pool runs at the effort of its jobs: light-only pools low, any heavy job high, else medium. */
export function poolEffort(plan: SetupPlan, name: string): SetupEffort {
  const lower = name.trim().toLowerCase();
  const needs = (
    Object.entries(plan.roles) as [ModelRoutingRole, SetupPlan["roles"][ModelRoutingRole]][]
  )
    .filter(
      ([, choice]) => choice && choice !== "order" && choice.pool.trim().toLowerCase() === lower,
    )
    .map(([role]) => ROLE_NEED[role]);
  if (needs.includes("heavy")) return "high";
  return needs.length && needs.every((need) => need === "light") ? "low" : "medium";
}

export function rulePlan(candidates: SetupCandidate[], names: SetupPoolNames): SetupPlan {
  const order = baselineOrder(candidates);
  const pick = (include: (candidate: SetupCandidate) => boolean) =>
    order.filter((index) => include(candidates[index]!));
  const smartest = pick((c) => c.profile.intelligence >= 4).sort(
    (a, b) => candidateScore(candidates[b]!) - candidateScore(candidates[a]!),
  );
  const balanced = pick((c) => ["workhorse", "standard"].includes(candidateTier(c)));
  let light = pick((c) => c.profile.intelligence <= 2).sort(
    (a, b) => candidates[a]!.profile.cost - candidates[b]!.profile.cost,
  );
  if (!light.length) light = pick((c) => c.profile.cost === 1 && c.profile.intelligence <= 3);
  const withKinds = candidates.some((candidate) => candidate.account?.kind);
  const pools: SetupPlan["pools"] = [
    { name: names.smartest, members: smartest, includes: [] },
    { name: names.balanced, members: balanced, includes: [] },
    { name: names.light, members: light, includes: [] },
    ...(withKinds
      ? [
          { name: names.work, members: pick((c) => c.account?.kind !== "personal"), includes: [] },
          { name: names.personal, members: pick((c) => c.account?.kind !== "work"), includes: [] },
        ]
      : []),
  ]
    .filter((pool) => pool.members.length)
    .map((pool) => ({ ...pool, members: fallbackOrder(candidates, pool.members) }));
  const first = (...choices: string[]) => {
    const name = choices.find((choice) => pools.some((pool) => pool.name === choice));
    return name ? { pool: name } : ("order" as const);
  };
  const preference = {
    light: [names.light, names.balanced],
    standard: [names.balanced, names.smartest],
    heavy: [names.smartest, names.balanced],
  };
  const roles: SetupPlan["roles"] = {};
  for (const [role, need] of Object.entries(ROLE_NEED) as [ModelRoutingRole, RoleNeed][])
    roles[role] = first(...preference[need]);
  return { order, pools, roles };
}

/**
 * Hold every role to its need: a role bound to a pool (or the order) whose first model does
 * not fit is moved to the planned pool that fits it best. Without a fitting pool it stays.
 */
export function enforceRoleNeeds(candidates: SetupCandidate[], plan: SetupPlan): SetupPlan {
  const valid = (index: number) => index >= 0 && index < candidates.length;
  const headOf = (name: string, seen = new Set<string>()): SetupCandidate | undefined => {
    const lower = name.trim().toLowerCase();
    const pool = plan.pools.find((item) => item.name.trim().toLowerCase() === lower);
    if (!pool || seen.has(lower)) return undefined;
    seen.add(lower);
    const own = pool.members.find(valid);
    if (own !== undefined) return candidates[own];
    for (const included of pool.includes) {
      const head = headOf(included, seen);
      if (head) return head;
    }
    return undefined;
  };
  const orderHead = plannedOrder(candidates, plan)[0];
  const heads = plan.pools.flatMap((pool) => {
    const head = headOf(pool.name);
    return head ? [{ name: pool.name, head }] : [];
  });
  const rank = (need: RoleNeed) => (a: SetupCandidate, b: SetupCandidate) =>
    need === "light"
      ? a.profile.cost - b.profile.cost || a.profile.intelligence - b.profile.intelligence
      : need === "heavy"
        ? b.profile.intelligence - a.profile.intelligence || a.profile.cost - b.profile.cost
        : candidateValue(b) - candidateValue(a);
  const roles = { ...plan.roles };
  for (const [role, choice] of Object.entries(roles) as [
    ModelRoutingRole,
    SetupPlan["roles"][ModelRoutingRole],
  ][]) {
    if (!choice) continue;
    const need = ROLE_NEED[role];
    const head =
      choice === "order"
        ? orderHead === undefined
          ? undefined
          : candidates[orderHead]
        : headOf(choice.pool);
    if (head && fitsNeed(head, need)) continue;
    const best = heads
      .filter((item) => fitsNeed(item.head, need))
      .sort((a, b) => rank(need)(a.head, b.head))[0];
    if (best) roles[role] = { pool: best.name };
  }
  return { ...plan, roles };
}

/** Best candidate per provider account and tier in the researched baseline. */
function fallbackOrder(candidates: SetupCandidate[], order = baselineOrder(candidates)): number[] {
  const used = new Set<string>();
  return order.filter((index) => {
    const candidate = candidates[index]!;
    const key = `${accountKey(candidate.target)}:${candidateTier(candidate)}`;
    if (used.has(key)) return false;
    used.add(key);
    return true;
  });
}

function plannedOrder(candidates: SetupCandidate[], plan: SetupPlan): number[] {
  const baseline = baselineOrder(candidates);
  const used = new Set([
    ...fallbackOrder(candidates, baseline),
    ...plan.pools.filter((pool) => pool.name.trim()).flatMap((pool) => pool.members),
  ]);
  return [...new Set([...plan.order, ...baseline])].filter(
    (index) =>
      Number.isInteger(index) && index >= 0 && index < candidates.length && used.has(index),
  );
}

/** Reuse one existing row per target, preferring the medium row in legacy orders. */
function candidateEntries(draft: OrderDraft, candidates: SetupCandidate[]) {
  const entries = [...draft.routing.entries];
  const percentages = { ...draft.percentages };
  const cache = new Map<string, string>();
  const entryFor = (index: number) => {
    const candidate = candidates[index]!;
    const key = targetKey(candidate.target);
    const cached = cache.get(key);
    if (cached) return cached;
    const settings = settingsAtEffort(candidate, "medium");
    const id = candidate.effort?.id;
    const same = entries.filter((entry) => targetKey(entry) === key);
    const known = (id && same.find((entry) => entry.modelSettings[id] === settings[id])) || same[0];
    let entryId = known?.id;
    if (!entryId) {
      if (entries.length >= MODEL_ROUTING_MAX_ENTRIES)
        throw new Error(
          "Not enough room in the model order. Disable unused catalog models and try again.",
        );
      entryId = crypto.randomUUID();
      entries.push({
        ...candidate.target,
        id: entryId,
        modelSettings: entrySettings(settings),
        unknownLimit: "use",
      });
      percentages[entryId] = "";
    }
    cache.set(key, entryId);
    return entryId;
  };
  return { entries, percentages, entryFor };
}

/** Create or refill each planned pool by name; resolve includes after every pool exists. */
function planPools(
  current: ModelRoutingPool[],
  plan: SetupPlan,
  memberIds: (indexes: number[]) => string[],
) {
  let pools = [...current];
  const byName = (name: string) => {
    const lower = poolName(name).toLowerCase();
    return pools.find((pool) => pool.name.trim().toLowerCase() === lower);
  };
  const planned = new Map<string, string[]>();
  for (const proposal of plan.pools) {
    const entryIds = memberIds(proposal.members);
    if (!proposal.name.trim() || (!entryIds.length && !proposal.includes.length)) continue;
    const effort = poolEffort(plan, proposal.name);
    const existing = byName(proposal.name);
    if (existing) {
      const { poolIds: _previous, ...rest } = existing;
      pools = pools.map((pool) => (pool.id === existing.id ? { ...rest, entryIds, effort } : pool));
      planned.set(existing.id, proposal.includes);
      continue;
    }
    if (pools.length >= MODEL_ROUTING_MAX_POOLS)
      throw new Error("Not enough room for catalog pools. Remove unused pools and try again.");
    const pool: ModelRoutingPool = {
      id: crypto.randomUUID(),
      name: poolName(proposal.name),
      entryIds,
      effort,
    };
    pools.push(pool);
    planned.set(pool.id, proposal.includes);
  }
  const included = pools.map((pool) => {
    const names = planned.get(pool.id);
    if (!names) return pool;
    const poolIds = [
      ...new Set(names.map((name) => byName(name)?.id).filter((id) => id && id !== pool.id)),
    ] as string[];
    return poolIds.length ? { ...pool, poolIds } : pool;
  });
  // A loop from the plan drops the plan's includes, never the owner's pools.
  const result = (modelRoutingPoolCycle(included) ? pools : included).filter(
    (pool) => pool.entryIds.length || pool.poolIds?.length,
  );
  return { pools: result, byName };
}

/**
 * Apply a plan: add pool members and per-account tier fallbacks at medium effort in the
 * planned order, create or refill the planned pools by name, and bind the planned roles.
 * Existing entries keep their ids, limits and other settings; pools and roles the plan does not name
 * are untouched.
 */
export function applySmartSetup(
  draft: OrderDraft,
  candidates: SetupCandidate[],
  plan: SetupPlan,
): OrderDraft {
  const { entries, percentages, entryFor } = candidateEntries(draft, candidates);
  const memberIds = (indexes: number[]) => [
    ...new Set(
      indexes
        .filter((index) => Number.isInteger(index) && index >= 0 && index < candidates.length)
        .map(entryFor),
    ),
  ];
  const planned = memberIds(plannedOrder(candidates, plan));
  const { pools, byName } = planPools(draft.routing.pools, plan, memberIds);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const sorted = [
    ...planned.map((id) => byId.get(id)!),
    ...entries.filter((entry) => !planned.includes(entry.id)),
  ];
  const roles = { ...draft.routing.roles };
  for (const [role, choice] of Object.entries(plan.roles) as [
    ModelRoutingRole,
    SetupPlan["roles"][ModelRoutingRole],
  ][]) {
    if (!choice) continue;
    const pool = choice === "order" ? undefined : byName(choice.pool);
    if (pool && pools.some((item) => item.id === pool.id))
      roles[role] = { kind: "pool", poolId: pool.id };
    else if (role.startsWith("text.")) roles[role] = { kind: "order" };
    else delete roles[role];
  }
  return {
    ...draft,
    percentages,
    routing: {
      ...draft.routing,
      entries: sorted.map((entry) => {
        const modelSettings = withoutSetupAcceleration(entry.modelSettings);
        return modelSettings === entry.modelSettings ? entry : { ...entry, modelSettings };
      }),
      pools,
      roles,
      delegation: planDelegation(draft.routing.delegation, candidates),
    },
  };
}

/** Smart Setup uses the standard provider speed for planning and generated routing. */
export function withoutSetupAcceleration(settings: Record<string, string>): Record<string, string> {
  const fast = settings.fast !== undefined && settings.fast !== "false";
  const tier = settings.serviceTier !== undefined && settings.serviceTier !== "default";
  return fast || tier
    ? {
        ...settings,
        ...(fast ? { fast: "false" } : {}),
        ...(tier ? { serviceTier: "default" } : {}),
      }
    : settings;
}

/**
 * Subagents and advisor for every run: the strongest model advises; each provider's best
 * standard and light model are the subagents, on its default account; subagents are capped at
 * medium effort. Provider and account overrides of these keys are cleared so the plan applies.
 * Without candidates for a part, that part keeps its current value.
 */
export function planDelegation(
  current: ModelRoutingDelegation,
  candidates: SetupCandidate[],
): ModelRoutingDelegation {
  const order = baselineOrder(candidates).map((index) => candidates[index]!);
  const ref = (candidate: SetupCandidate) => ({
    harness: candidate.target.harness,
    model: candidate.target.model,
  });
  const advisor = order
    .filter((candidate) => candidate.profile.intelligence >= 4)
    .sort((a, b) => candidateScore(b) - candidateScore(a))[0];
  const subagents = new Map<string, ReturnType<typeof ref>>();
  for (const tier of ["standard", "light"] as const)
    for (const candidate of order.filter((item) => candidateTier(item) === tier)) {
      const key = `${candidate.target.harness}:${tier}`;
      if (!subagents.has(key)) subagents.set(key, ref(candidate));
    }
  const refs = [
    ...new Map([...subagents.values()].map((item) => [JSON.stringify(item), item])).values(),
  ];
  const planned: Record<string, string> = {
    [CROSS_SUBAGENT_MAX_EFFORT_KEY]: "medium",
    ...(advisor ? { [CROSS_ADVISOR_KEY]: JSON.stringify(ref(advisor)) } : {}),
    ...(refs.length ? { [CROSS_SUBAGENTS_KEY]: encodeSubagents(refs)! } : {}),
  };
  const clear = (settings: Record<string, string>) => {
    const next = { ...settings };
    for (const key of Object.keys(planned)) delete next[key];
    return next;
  };
  const layer = <K extends string>(values: Partial<Record<K, Record<string, string>>>) =>
    Object.fromEntries(
      Object.entries(values)
        .map(([id, settings]) => [id, clear(settings as Record<string, string>)] as const)
        .filter(([, settings]) => Object.keys(settings).length),
    ) as Partial<Record<K, Record<string, string>>>;
  return {
    global: { ...current.global, ...planned },
    providers: layer(current.providers),
    accounts: layer(current.accounts) as Record<string, Record<string, string>>,
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
