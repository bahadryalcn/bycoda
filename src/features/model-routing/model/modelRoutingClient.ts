import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForegroundQueryPolling, useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import {
  HOST_MODEL_ROUTING,
  ModelRoutingGetResultSchema,
  ModelRoutingResolveResultSchema,
  ModelRoutingStatusResultSchema,
  type ModelRoutingDraft,
  type ModelRoutingEntryStatus,
  type ModelRoutingItemChoice,
  type ModelRoutingResolution,
  type ModelRoutingRole,
  type ModelRoutingState,
  type ModelRoutingTarget,
} from "../../../shared/model/host-contracts/model-routing";
import { remoteRequest } from "../../connections/public/connections";

const stateKey = (machineId: string | undefined) => [HOST_MODEL_ROUTING, machineId];
const statusKey = (machineId: string | undefined) => [HOST_MODEL_ROUTING, machineId, "status"];

/**
 * One machine's model routing. `supported` is false (and nothing is fetched) when that Host
 * lacks `models.routing.v1`, so callers hide routing controls and keep the item's own model.
 */
export function useModelRouting(machineId: string | undefined, supported: boolean, pollMs = 0) {
  const client = useQueryClient();
  const visible = useQueryVisible();
  const enabled = supported && !!machineId;
  const query = useQuery({
    queryKey: stateKey(machineId),
    enabled: enabled && visible,
    queryFn: async (): Promise<ModelRoutingState> =>
      ModelRoutingGetResultSchema.parse(await remoteRequest(machineId!, "modelRouting.get", {}))
        .state,
    staleTime: 30_000,
    refetchOnWindowFocus: pollMs === 0,
    retry: false,
  });
  useForegroundQueryPolling(query.refetch, pollMs, enabled && pollMs > 0);
  const save = useMutation({
    /** Rejects with the Host's conflict message when `expectedVersion` is stale. */
    mutationFn: async (input: {
      expectedVersion: number;
      draft: ModelRoutingDraft;
    }): Promise<ModelRoutingState> =>
      ModelRoutingGetResultSchema.parse(
        await remoteRequest(machineId!, "modelRouting.save", input, false, true),
      ).state,
    onSuccess: (state) => client.setQueryData(stateKey(machineId), state),
    onSettled: () => client.invalidateQueries({ queryKey: [HOST_MODEL_ROUTING, machineId] }),
  });
  return {
    supported: enabled,
    state: query.data,
    loading: enabled && query.isPending,
    error: query.error instanceof Error ? query.error.message : undefined,
    refetch: query.refetch,
    save,
  };
}

/** Live quota and availability of every entry of the main order, for the settings screen. */
export function useModelRoutingStatus(machineId: string | undefined, supported: boolean) {
  const enabled = supported && !!machineId;
  const visible = useQueryVisible();
  const query = useQuery({
    queryKey: statusKey(machineId),
    enabled: enabled && visible,
    queryFn: async (): Promise<ModelRoutingEntryStatus[]> =>
      ModelRoutingStatusResultSchema.parse(
        await remoteRequest(machineId!, "modelRouting.status", {}),
      ).entries,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  useForegroundQueryPolling(query.refetch, 60_000, enabled);
  return {
    entries: query.data ?? [],
    loading: enabled && query.isPending,
    error: query.error,
    refetch: query.refetch,
  };
}

/** Asks the Host which model a role (or one item's choice) would run on right now. */
export async function resolveModelRouting(
  machineId: string,
  input: { role: ModelRoutingRole; choice?: ModelRoutingItemChoice; fixed?: ModelRoutingTarget },
): Promise<ModelRoutingResolution> {
  return ModelRoutingResolveResultSchema.parse(
    await remoteRequest(machineId, "modelRouting.resolve", input),
  ).resolution;
}
