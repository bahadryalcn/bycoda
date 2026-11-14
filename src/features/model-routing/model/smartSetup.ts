import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import {
  MODEL_ROUTING_MAX_ENTRIES,
  MODEL_ROUTING_MAX_POOLS,
  type ModelRoutingEntry,
  type ModelRoutingPool,
  type ModelRoutingRole,
  type ModelRoutingScope,
  type ModelRoutingTarget,
} from "../../../shared/model/host-contracts/model-routing";
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
} from "../../sessions/public/models";
import type { ModelSource } from "../../sessions/public/modelSource";
import { catalogModelFacts, valueScore } from "./modelCatalogFacts";
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

/**
 * The researched baseline: models capable of unattended work (intelligence 3+) first, each
 * group by benefit per cost, then the default account; stable for equal candidates.
 */
export function baselineOrder(candidates: SetupCandidate[]): number[] {
  return candidates
    .map((candidate, index) => ({ candidate, index, value: candidateValue(candidate) }))
    .sort(
      (a, b) =>
        Number(b.candidate.profile.intelligence >= 3) -
          Number(a.candidate.profile.intelligence >= 3) ||
        b.value - a.value ||
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

export function rulePlan(candidates: SetupCandidate[], names: SetupPoolNames): SetupPlan {
  const order = baselineOrder(candidates);
  const pick = (include: (candidate: SetupCandidate) => boolean) =>
    order.filter((index) => include(candidates[index]!));
  const smartest = pick((c) => c.profile.intelligence >= 4).sort(
    (a, b) =>
      candidates[b]!.profile.intelligence - candidates[a]!.profile.intelligence ||
      order.indexOf(a) - order.indexOf(b),
  );
  let balanced = pick((c) => c.profile.intelligence >= 3 && c.profile.cost <= 2);
  if (!balanced.length) balanced = pick((c) => c.profile.intelligence === 3);
  let fast = pick((c) => c.profile.intelligence <= 2).sort(
    (a, b) => candidates[a]!.profile.cost - candidates[b]!.profile.cost,
  );
  if (!fast.length) fast = pick((c) => c.profile.cost === 1 && c.profile.intelligence <= 3);
  const withKinds = candidates.some((candidate) => candidate.account?.kind);
  const pools: SetupPlan["pools"] = [
    { name: names.smartest, members: smartest, includes: [] },
    { name: names.balanced, members: balanced, includes: [] },
    { name: names.fast, members: fast, includes: [] },
    ...(withKinds
      ? [
          { name: names.work, members: pick((c) => c.account?.kind !== "personal"), includes: [] },
          { name: names.personal, members: pick((c) => c.account?.kind !== "work"), includes: [] },
        ]
      : []),
  ].filter((pool) => pool.members.length);
  const first = (...choices: string[]) => {
    const name = choices.find((choice) => pools.some((pool) => pool.name === choice));
    return name ? { pool: name } : ("order" as const);
  };
  const preference = {
    light: [names.fast, names.balanced],
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
  const orderHead = [...plan.order, ...baselineOrder(candidates)].find(valid);
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

/** Add every missing candidate; returns the entry id of each candidate by index. */
function addCandidates(draft: OrderDraft, candidates: SetupCandidate[]) {
  const entries = [...draft.routing.entries];
  const percentages = { ...draft.percentages };
  const ids = new Map<string, string>();
  for (const entry of entries) {
    const key = targetKey(entry);
    if (!ids.has(key)) ids.set(key, entry.id);
  }
  const entryIds = candidates.map((candidate) => {
    const key = targetKey(candidate.target);
    const known = ids.get(key);
    if (known) return known;
    if (entries.length >= MODEL_ROUTING_MAX_ENTRIES)
      throw new Error(
        "Not enough room in the model order. Disable unused catalog models and try again.",
      );
    const id = crypto.randomUUID();
    entries.push({
      ...candidate.target,
      id,
      modelSettings: entrySettings(candidate.target.modelSettings),
      unknownLimit: "use",
    });
    percentages[id] = "0";
    ids.set(key, id);
    return id;
  });
  return { entries, percentages, entryIds };
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
    const existing = byName(proposal.name);
    if (existing) {
      const { poolIds: _previous, ...rest } = existing;
      pools = pools.map((pool) => (pool.id === existing.id ? { ...rest, entryIds } : pool));
      planned.set(existing.id, proposal.includes);
      continue;
    }
    if (pools.length >= MODEL_ROUTING_MAX_POOLS)
      throw new Error("Not enough room for catalog pools. Remove unused pools and try again.");
    const pool: ModelRoutingPool = {
      id: crypto.randomUUID(),
      name: poolName(proposal.name),
      entryIds,
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
 * Apply a plan: add every missing candidate, put the planned order first, create or refill the
 * planned pools by name and bind the planned roles. Existing entries keep their ids, limits
 * and settings; pools and roles the plan does not name are untouched.
 */
export function applySmartSetup(
  draft: OrderDraft,
  candidates: SetupCandidate[],
  plan: SetupPlan,
): OrderDraft {
  const { entries, percentages, entryIds } = addCandidates(draft, candidates);
  const memberIds = (indexes: number[]) => [
    ...new Set(
      indexes
        .filter((index) => Number.isInteger(index) && index >= 0 && index < candidates.length)
        .map((index) => entryIds[index]!),
    ),
  ];
  const planned = memberIds([...plan.order, ...baselineOrder(candidates)]);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const sorted = [
    ...planned.map((id) => byId.get(id)!),
    ...entries.filter((entry) => !planned.includes(entry.id)),
  ];
  const { pools, byName } = planPools(draft.routing.pools, plan, memberIds);
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
    routing: { ...draft.routing, entries: sorted, pools, roles },
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
