import type { ModelRoutingPool } from "./host-contracts/model-routing";

type PoolRefs = Pick<ModelRoutingPool, "id" | "entryIds" | "poolIds">;

/**
 * The entries a pool resolves to: its own `entryIds` first, then each included pool in order,
 * depth-first. Every entry appears once, at its first position. Unknown and repeated pools
 * are ignored, so a cycle in an unvalidated document still terminates.
 */
export function modelRoutingPoolEntryIds(pools: readonly PoolRefs[], poolId: string): string[] {
  const byId = new Map(pools.map((pool) => [pool.id, pool]));
  const visited = new Set<string>();
  const entryIds = new Set<string>();
  const visit = (id: string) => {
    const pool = byId.get(id);
    if (!pool || visited.has(id)) return;
    visited.add(id);
    for (const entryId of pool.entryIds) entryIds.add(entryId);
    for (const included of pool.poolIds ?? []) visit(included);
  };
  visit(poolId);
  return [...entryIds];
}

/** Whether `poolId` reaches `targetId` through `poolIds` (a pool reaches itself). */
export function modelRoutingPoolReaches(
  pools: readonly PoolRefs[],
  poolId: string,
  targetId: string,
): boolean {
  const byId = new Map(pools.map((pool) => [pool.id, pool]));
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (id === targetId) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return (byId.get(id)?.poolIds ?? []).some(visit);
  };
  return visit(poolId);
}

/** The id of a pool that includes itself directly or through other pools, if any. */
export function modelRoutingPoolCycle(pools: readonly PoolRefs[]): string | undefined {
  return pools.find((pool) =>
    (pool.poolIds ?? []).some((included) => modelRoutingPoolReaches(pools, included, pool.id)),
  )?.id;
}

/**
 * The `projectKinds` key of a project folder. Renderer and Host must agree on it.
 * shortcut: case-folds every path, upgrade when two projects on a case-sensitive volume
 * differ only by case.
 */
export function modelRoutingProjectKey(cwd: string): string {
  const key = cwd.trim().replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  return key || "/";
}
