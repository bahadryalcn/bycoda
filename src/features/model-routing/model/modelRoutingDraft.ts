import {
  MODEL_ROUTING_DELEGATION_KEYS,
  ModelRoutingDraftSchema,
  type ModelRoutingDraft,
  type ModelRoutingEntry,
  type ModelRoutingPool,
  type ModelRoutingState,
  type WorkCalendarCaps,
} from "../../../shared/model/host-contracts/model-routing";
import {
  modelRoutingPoolCycle,
  modelRoutingPoolReaches,
} from "../../../shared/model/modelRoutingPools";
import { parseHostSettings, type HostSettings } from "../../tasks/public/hostSettings";

export type CapDraft = {
  daily: { tokens: string; costUsd: string };
  monthly: { tokens: string; costUsd: string };
};

export type OrderDraft = {
  workCaps: { total: CapDraft; providers: Record<string, CapDraft> };
  routing: ModelRoutingDraft;
  percentages: Record<string, string>;
  maxRunMinutes: string;
  limits: { maxRunningTasks: string; dailyAgentMinutes: string };
};

function capDraft(caps?: WorkCalendarCaps): CapDraft {
  return {
    daily: {
      tokens: String(caps?.daily?.tokens ?? ""),
      costUsd: String(caps?.daily?.costUsd ?? ""),
    },
    monthly: {
      tokens: String(caps?.monthly?.tokens ?? ""),
      costUsd: String(caps?.monthly?.costUsd ?? ""),
    },
  };
}

function parseCaps(caps: CapDraft): WorkCalendarCaps | undefined {
  const period = (value: CapDraft["daily"]) => {
    const tokens = value.tokens.trim()
      ? integer(
          value.tokens,
          0,
          Number.MAX_SAFE_INTEGER,
          "Token limits must be nonnegative whole numbers.",
        )
      : undefined;
    const costUsd = value.costUsd.trim() ? Number(value.costUsd) : undefined;
    if (costUsd !== undefined && (!Number.isFinite(costUsd) || costUsd < 0))
      throw new Error("Cost limits must be nonnegative finite numbers.");
    return tokens === undefined && costUsd === undefined ? undefined : { tokens, costUsd };
  };
  const daily = period(caps.daily);
  const monthly = period(caps.monthly);
  return daily || monthly ? { daily, monthly } : undefined;
}

/** Delegation belongs to its own layers, including when picker defaults contain it. */
export function entrySettings(settings: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(settings).filter(
      ([key]) => !MODEL_ROUTING_DELEGATION_KEYS.some((reserved) => reserved === key),
    ),
  );
}

export function orderDraft(state: ModelRoutingState, limits: HostSettings): OrderDraft {
  const { version: _version, updatedAt: _updatedAt, ...routing } = state;
  return {
    routing: structuredClone(routing),
    workCaps: {
      total: capDraft(state.workCaps?.total),
      providers: Object.fromEntries(
        Object.entries(state.workCaps?.providers ?? {}).map(([provider, caps]) => [
          provider,
          capDraft(caps),
        ]),
      ),
    },
    percentages: Object.fromEntries(
      state.entries.map((entry) => [entry.id, String(entry.minRemainingPercent ?? 0)]),
    ),
    maxRunMinutes: String(state.defaultMaxRunMinutes ?? ""),
    limits: {
      maxRunningTasks: String(limits.maxRunningTasks),
      dailyAgentMinutes: String(limits.dailyAgentMinutes),
    },
  };
}

function integer(text: string, min: number, max: number, message: string): number {
  const value = Number(text);
  if (!text.trim() || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(message);
  return value;
}

/** Parses only at save; invalid or partially typed numbers stay visible in the draft. */
export function prepareOrderSave(draft: OrderDraft): {
  routing: ModelRoutingDraft;
  limits: HostSettings;
} {
  const total = parseCaps(draft.workCaps.total);
  const providers = Object.fromEntries(
    Object.entries(draft.workCaps.providers)
      .map(([provider, caps]) => [provider, parseCaps(caps)])
      .filter(([, caps]) => caps !== undefined),
  );
  const workCaps = total || Object.keys(providers).length ? { total, providers } : undefined;
  const { workCaps: _previousCaps, ...otherRouting } = draft.routing;
  const routing: ModelRoutingDraft = {
    ...otherRouting,
    ...(workCaps ? { workCaps } : {}),
    entries: draft.routing.entries.map((entry) => ({
      ...entry,
      modelSettings: entrySettings(entry.modelSettings),
      minRemainingPercent: integer(
        draft.percentages[entry.id] ?? "0",
        0,
        100,
        "Keep for my own use must be a whole percentage from 0 to 100.",
      ),
    })),
    defaultMaxRunMinutes: draft.maxRunMinutes.trim()
      ? integer(draft.maxRunMinutes, 1, 10080, "Run time must be 1 to 10080 whole minutes.")
      : undefined,
  };
  if (!ModelRoutingDraftSchema.safeParse(routing).success)
    throw new Error(
      "Choose a model for every entry and a name and at least one model or pool for every pool.",
    );
  const entries = new Set(routing.entries.map((entry) => entry.id));
  const pools = new Set(routing.pools.map((pool) => pool.id));
  if (entries.size !== routing.entries.length || pools.size !== routing.pools.length)
    throw new Error("Model and pool IDs must be unique.");
  for (const entry of routing.entries) {
    if (entry.providerAccountId && entry.harness !== "claude" && entry.harness !== "codex")
      throw new Error("Only Claude and Codex support an account choice.");
  }
  for (const pool of routing.pools) {
    if (!pool.name.trim()) throw new Error("Give every pool a name.");
    if (!pool.entryIds.length && !pool.poolIds?.length)
      throw new Error("Every pool needs at least one model or pool.");
    if (
      new Set(pool.entryIds).size !== pool.entryIds.length ||
      pool.entryIds.some((id) => !entries.has(id))
    )
      throw new Error("Pools must contain unique models from the main order.");
    const included = pool.poolIds ?? [];
    if (
      new Set(included).size !== included.length ||
      included.some((id) => id === pool.id || !pools.has(id))
    )
      throw new Error("A pool can include each other pool once, and only pools that exist.");
  }
  if (modelRoutingPoolCycle(routing.pools))
    throw new Error("Pools cannot include each other in a loop.");
  for (const choice of Object.values(routing.roles)) {
    if (choice?.kind === "pool" && !pools.has(choice.poolId))
      throw new Error("A role uses a pool that no longer exists.");
  }
  return {
    routing,
    limits: parseHostSettings({
      maxRunningTasks: integer(
        draft.limits.maxRunningTasks,
        1,
        Number.MAX_SAFE_INTEGER,
        "Concurrent tasks must be a positive safe integer.",
      ),
      dailyAgentMinutes: integer(
        draft.limits.dailyAgentMinutes,
        0,
        Number.MAX_SAFE_INTEGER,
        "Daily agent time must be zero or a positive whole number of minutes.",
      ),
    }),
  };
}

export function replaceOrderEntry(draft: OrderDraft, entry: ModelRoutingEntry): OrderDraft {
  return {
    ...draft,
    routing: {
      ...draft.routing,
      entries: draft.routing.entries.map((current) =>
        current.id === entry.id
          ? { ...entry, modelSettings: entrySettings(entry.modelSettings) }
          : current,
      ),
    },
  };
}

export function removeOrderEntry(draft: OrderDraft, id: string): OrderDraft {
  if (
    draft.routing.pools.some(
      (pool) => pool.entryIds.includes(id) && pool.entryIds.length === 1 && !pool.poolIds?.length,
    )
  )
    throw new Error(
      "This model is the last model in a pool. Add another model to that pool or delete the pool first.",
    );
  const { [id]: _removed, ...percentages } = draft.percentages;
  return {
    ...draft,
    percentages,
    routing: {
      ...draft.routing,
      entries: draft.routing.entries.filter((entry) => entry.id !== id),
      pools: draft.routing.pools.map((pool) => ({
        ...pool,
        entryIds: pool.entryIds.filter((entryId) => entryId !== id),
      })),
    },
  };
}

export function removeOrderPool(draft: OrderDraft, id: string): OrderDraft {
  if (
    Object.values(draft.routing.roles).some(
      (choice) => choice?.kind === "pool" && choice.poolId === id,
    )
  )
    throw new Error("A role uses this pool. Change it in Assignments before deleting the pool.");
  if (draft.routing.pools.some((pool) => pool.poolIds?.includes(id)))
    throw new Error("Another pool includes this pool. Remove it from that pool first.");
  return {
    ...draft,
    routing: {
      ...draft.routing,
      pools: draft.routing.pools.filter((pool) => pool.id !== id),
    },
  };
}

/** Replace a pool's own models and included pools. Throws when it would be empty or cyclic. */
export function setPoolMembers(
  draft: OrderDraft,
  poolId: string,
  members: { entryIds: string[]; poolIds: string[] },
): OrderDraft {
  if (!members.entryIds.length && !members.poolIds.length)
    throw new Error("Keep at least one model or pool in a pool.");
  const pools = draft.routing.pools.map((pool) => {
    if (pool.id !== poolId) return pool;
    const { poolIds: _previous, ...rest } = pool;
    return {
      ...rest,
      entryIds: members.entryIds,
      ...(members.poolIds.length ? { poolIds: members.poolIds } : {}),
    };
  });
  if (modelRoutingPoolCycle(pools)) throw new Error("Pools cannot include each other in a loop.");
  return { ...draft, routing: { ...draft.routing, pools } };
}

/** Pools that can be included in `poolId` without creating a loop. */
export function includablePools(draft: OrderDraft, poolId: string): ModelRoutingPool[] {
  return draft.routing.pools.filter(
    (pool) => pool.id !== poolId && !modelRoutingPoolReaches(draft.routing.pools, pool.id, poolId),
  );
}

/** @deprecated Use `setPoolMembers`; kept until the UI stops calling it. */
export function setPoolEntries(draft: OrderDraft, id: string, entryIds: string[]): OrderDraft {
  const poolIds = draft.routing.pools.find((pool) => pool.id === id)?.poolIds ?? [];
  return setPoolMembers(draft, id, { entryIds, poolIds });
}

export const sameOrderDraft = (a: OrderDraft, b: OrderDraft) =>
  JSON.stringify(a) === JSON.stringify(b);
