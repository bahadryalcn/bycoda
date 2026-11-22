import { useQuery, type QueryKey } from "@tanstack/react-query";
import { useForegroundQueryPolling, useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { withTimeout } from "../../../shared/lib/withTimeout";
import { resolveModelRouting } from "./modelRoutingClient";

/** Remote Hosts can legitimately take several seconds; a slower answer is "unknown", not a fallback. */
const PREVIEW_DEADLINE_MS = 8_000;
/** Previews refresh on the foreground clock, never while the window is hidden. */
export const MODEL_ROUTING_PREVIEW_POLL_MS = 60_000;

/**
 * Shared "which model would this run on now" preview. A timeout or failure surfaces as
 * `isError` so callers can say the model could not be checked instead of claiming a routing fact.
 */
export function useModelRoutingPreview(
  machineId: string,
  queryKey: QueryKey,
  input: Parameters<typeof resolveModelRouting>[1],
) {
  const visible = useQueryVisible();
  const query = useQuery({
    ...modelRoutingPreviewOptions(machineId, queryKey, input),
    enabled: visible,
  });
  useForegroundQueryPolling(query.refetch, MODEL_ROUTING_PREVIEW_POLL_MS, true);
  return query;
}

/** Query options shared by the single preview hook and the per-list `useQueries` readers. */
export function modelRoutingPreviewOptions(
  machineId: string,
  queryKey: QueryKey,
  input: Parameters<typeof resolveModelRouting>[1],
) {
  return {
    queryKey,
    queryFn: () =>
      withTimeout(resolveModelRouting(machineId, input), PREVIEW_DEADLINE_MS, "Model preview"),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  };
}
