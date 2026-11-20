import { useQuery, type QueryKey } from "@tanstack/react-query";
import { withTimeout } from "../../../shared/lib/withTimeout";
import { resolveModelRouting } from "./modelRoutingClient";

/** Remote Hosts can legitimately take several seconds; a slower answer is "unknown", not a fallback. */
const PREVIEW_DEADLINE_MS = 8_000;

/**
 * Shared "which model would this run on now" preview. A timeout or failure surfaces as
 * `isError` so callers can say the model could not be checked instead of claiming a routing fact.
 */
export function useModelRoutingPreview(
  machineId: string,
  queryKey: QueryKey,
  input: Parameters<typeof resolveModelRouting>[1],
) {
  return useQuery({
    queryKey,
    queryFn: () =>
      withTimeout(resolveModelRouting(machineId, input), PREVIEW_DEADLINE_MS, "Model preview"),
    retry: false,
    staleTime: 3000,
    refetchInterval: 60_000,
  });
}
