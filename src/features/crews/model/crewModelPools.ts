import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { remoteRequest } from "../../connections/public/connections";
import {
  CREW_MODEL_POOL_LIMIT,
  HOST_CREW_MODEL_POOLS,
  HOST_CREWS,
  parseCrewModelPool,
  type CrewCandidate,
  type CrewModelPool,
} from "./crew";
import type { ProjectCrews } from "./crewClient";

export type { CrewModelPool };

/** A pool being edited; `updatedAt` is absent until the Host has stored it. */
export type CrewModelPoolDraft = Omit<CrewModelPool, "updatedAt"> & { updatedAt?: number };

/** How many library profiles and crew members reference `poolId`. */
export function modelPoolUsage(
  poolId: string,
  data: Pick<ProjectCrews, "agents" | "definitions">,
): { profiles: number; members: number } {
  return {
    profiles: data.agents.filter((agent) => agent.pool?.id === poolId).length,
    members: data.definitions.reduce(
      (total, crew) => total + crew.agents.filter((agent) => agent.pool?.id === poolId).length,
      0,
    ),
  };
}

export function newModelPoolDraft(
  id: string,
  candidates: CrewCandidate[] = [],
): CrewModelPoolDraft {
  return { id, name: "", candidates };
}

/** Whether a draft can be saved: a name and 1 to 20 models, and a free name slot. */
export function modelPoolDraftIssue(
  draft: CrewModelPoolDraft,
  pools: readonly CrewModelPool[],
): "name" | "duplicate" | "models" | "limit" | undefined {
  const name = draft.name.trim().toLowerCase();
  if (!name || draft.name.length > 80) return "name";
  if (pools.some((pool) => pool.id !== draft.id && pool.name.trim().toLowerCase() === name))
    return "duplicate";
  if (!draft.candidates.length || draft.candidates.length > 20) return "models";
  if (!pools.some((pool) => pool.id === draft.id) && pools.length >= CREW_MODEL_POOL_LIMIT)
    return "limit";
  return undefined;
}

/**
 * The Host's model pools for one machine. `supported` is false (and nothing is fetched)
 * when that Host lacks `crews.model-pools.v1`, so callers hide pool controls.
 * Saving or deleting a pool also refreshes the crews, because the Host rewrites the
 * candidates of every member that uses it.
 */
export function useCrewModelPools(machineId: string | undefined, supported: boolean) {
  const client = useQueryClient();
  const key = [HOST_CREW_MODEL_POOLS, machineId];
  const enabled = supported && !!machineId;
  const query = useQuery({
    queryKey: key,
    enabled,
    queryFn: async (): Promise<CrewModelPool[]> => {
      const { pools } = await remoteRequest<{ pools: unknown[] }>(
        machineId!,
        "crews.pools.list",
        {},
      );
      return pools.map(parseCrewModelPool);
    },
    staleTime: 3000,
    retry: false,
  });
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: key }),
      client.invalidateQueries({ queryKey: [HOST_CREWS] }),
    ]);
  };
  const save = useMutation({
    mutationFn: async (draft: CrewModelPoolDraft): Promise<CrewModelPool> =>
      parseCrewModelPool(
        await remoteRequest(
          machineId!,
          "crews.pools.save",
          {
            pool: { id: draft.id, name: draft.name.trim(), candidates: draft.candidates },
            ...(draft.updatedAt === undefined ? {} : { expectedUpdatedAt: draft.updatedAt }),
          },
          false,
          true,
        ),
      ),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: async (pool: CrewModelPool) => {
      await remoteRequest(
        machineId!,
        "crews.pools.delete",
        { poolId: pool.id, expectedUpdatedAt: pool.updatedAt },
        false,
        true,
      );
    },
    onSettled: refresh,
  });
  return {
    supported: enabled,
    pools: query.data ?? [],
    loading: enabled && query.isPending,
    error: query.error instanceof Error ? query.error.message : undefined,
    save,
    remove,
  };
}
