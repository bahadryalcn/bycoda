import { isDeepStrictEqual } from "node:util";
import {
  CREW_MODEL_POOL_LIMIT,
  parseCrewModelPool,
  type CrewAgent,
  type CrewCandidate,
  type CrewModelPool,
} from "../../src/features/crews/model/crew";
import type { CrewState } from "./crew-ports";
import { syncLinkedMembers } from "./crew-membership";

/**
 * Host-wide model pools: named sets of automatic candidates the owner defines once.
 * A member that references a pool (`pool: { id }`) keeps a resolved copy in `candidates`,
 * so selection and every reader work unchanged; saving a pool refreshes those copies and
 * deleting one detaches its members (they keep their last candidates). Pools live in the
 * crew state blob, so every function here mutates that state inside the caller's
 * transaction. Run snapshots are never touched.
 */

type PoolState = Pick<CrewState, "definitions" | "agents" | "pools">;

const key = (name: string) => name.trim().toLowerCase();
const bare = (candidates: readonly CrewCandidate[]) =>
  candidates.map(({ capabilities: _capabilities, ...rest }) => rest);

/** The pool's candidates as a member's own copy; capability evidence stays per member. */
function resolved(member: Pick<CrewAgent, "candidates">, pool: CrewModelPool): CrewCandidate[] {
  const evidence = new Map(member.candidates.map((c) => [c.id, c.capabilities]));
  return structuredClone(pool.candidates).map((c) => ({
    ...c,
    capabilities: evidence.get(c.id) ?? {},
  }));
}

/** Fills an automatic member's candidates from its pool before it is saved; an unknown pool is refused. */
export function applyModelPools(state: Pick<PoolState, "pools">, agents: CrewAgent[]): void {
  for (const agent of agents) {
    if (!agent.pool) continue;
    const pool = state.pools?.find((p) => p.id === agent.pool!.id);
    if (!pool) throw new Error("Unknown model pool");
    agent.candidates = resolved(agent, pool);
  }
}

/** Rewrites every library and crew member that references `poolId`; returns the changed library profiles. */
function rewriteReferencing(
  state: PoolState,
  poolId: string,
  now: number,
  change: (member: CrewAgent) => CrewAgent,
) {
  const touched: NonNullable<PoolState["agents"]> = [];
  state.agents = (state.agents ?? []).map((agent) => {
    if (agent.pool?.id !== poolId) return agent;
    const next = { ...change(agent), updatedAt: Math.max(now, agent.updatedAt + 1) };
    touched.push(next);
    return next;
  });
  state.definitions = state.definitions.map((definition) => {
    if (!definition.agents.some((member) => member.pool?.id === poolId)) return definition;
    return {
      ...definition,
      agents: definition.agents.map((member) =>
        member.pool?.id === poolId ? change(member) : member,
      ),
      updatedAt: Math.max(now, definition.updatedAt + 1),
    };
  });
  for (const agent of touched) syncLinkedMembers(state, agent);
}

export function listModelPools(state: Pick<PoolState, "pools">): CrewModelPool[] {
  return structuredClone(state.pools ?? []);
}

export function saveModelPool(
  state: PoolState,
  value: unknown,
  expectedUpdatedAt: number | undefined,
  now: number,
): CrewModelPool {
  const input = parseCrewModelPool(value);
  const pools = state.pools ?? [];
  const previous = pools.find((p) => p.id === input.id);
  if (!previous && expectedUpdatedAt !== undefined) throw new Error("This model pool was deleted");
  if (previous && previous.updatedAt !== expectedUpdatedAt)
    throw new Error("Model pool changed. Reload before saving");
  if (!previous && pools.length >= CREW_MODEL_POOL_LIMIT)
    throw new Error(`Keep at most ${CREW_MODEL_POOL_LIMIT} model pools`);
  if (pools.some((p) => p.id !== input.id && key(p.name) === key(input.name)))
    throw new Error("A model pool with this name already exists");
  for (const candidate of input.candidates) candidate.capabilities = {};
  const pool: CrewModelPool = {
    ...input,
    updatedAt: Math.max(now, (previous?.updatedAt ?? 0) + 1),
  };
  state.pools = [...pools.filter((p) => p.id !== pool.id), pool];
  if (previous && !isDeepStrictEqual(bare(previous.candidates), bare(pool.candidates)))
    rewriteReferencing(state, pool.id, pool.updatedAt, (member) => ({
      ...member,
      candidates: resolved(member, pool),
    }));
  return pool;
}

/** Members keep their last candidates and lose the reference. */
export function deleteModelPool(
  state: PoolState,
  poolId: string,
  expectedUpdatedAt: number | undefined,
  now: number,
): void {
  const pool = state.pools?.find((p) => p.id === poolId);
  if (!pool) throw new Error("Unknown model pool");
  if (pool.updatedAt !== expectedUpdatedAt)
    throw new Error("Model pool changed. Reload before deleting");
  state.pools = (state.pools ?? []).filter((p) => p !== pool);
  rewriteReferencing(state, poolId, now, ({ pool: _pool, ...member }) => member);
}

/** What `callModelPools` needs from the crews service. */
export type CrewModelPoolIo = {
  scope<T>(run: () => Promise<T>): Promise<T>;
  read(): Promise<CrewState>;
  write(state: CrewState): Promise<void>;
  now(): number;
  /** Pools are owner-only; agent principals are refused. */
  owner: boolean;
};

/** `crews.pools.list|save|delete`. */
export async function callModelPools(
  action: string,
  input: Record<string, unknown>,
  io: CrewModelPoolIo,
): Promise<unknown> {
  if (!io.owner) throw new Error("Only the owner may manage model pools");
  const expected =
    typeof input.expectedUpdatedAt === "number" ? input.expectedUpdatedAt : undefined;
  return io.scope(async () => {
    const state = await io.read();
    if (action === "crews.pools.list") return { pools: listModelPools(state) };
    if (action === "crews.pools.save") {
      const pool = saveModelPool(state, input.pool, expected, io.now());
      await io.write(state);
      return pool;
    }
    if (action === "crews.pools.delete") {
      deleteModelPool(state, String(input.poolId), expected, io.now());
      await io.write(state);
      return { deleted: true };
    }
    throw new Error("Unknown model pool action");
  });
}
