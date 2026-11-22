import { useEffect, useSyncExternalStore } from "react";
import {
  focusManager,
  useQueryClient,
  type QueryFilters,
  type QueryKey,
} from "@tanstack/react-query";
import { startForegroundPolling } from "../lib/foregroundPolling";

const subscribe = (listener: () => void) => focusManager.subscribe(listener);
const snapshot = () => focusManager.isFocused();

/** Also gates the initial fetch, which refetchIntervalInBackground does not. */
export function useQueryVisible() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

/** Leave initial loading and structural sharing to Query; keep its observer updates off the clock. */
export function useForegroundQueryPolling(
  refetch: (options: { cancelRefetch: boolean }) => Promise<unknown>,
  period: number,
  enabled: boolean,
  urgent = false,
) {
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keeps one foreground timer subscribed while this query needs periodic reads.
  useEffect(() => {
    if (!enabled) return;
    return startForegroundPolling(() => refetch({ cancelRefetch: false }), period, {
      immediate: false,
      urgent,
    }).stop;
  }, [enabled, period, refetch, urgent]);
}

/** One clock for a view's dynamic set of query observers. */
export function useForegroundQueryFamilyPolling(
  queryKey: QueryKey,
  period: number,
  {
    predicate,
    enabled = true,
    urgent = false,
  }: {
    predicate?: QueryFilters["predicate"];
    enabled?: boolean;
    urgent?: boolean;
  } = {},
) {
  const client = useQueryClient();
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keeps one foreground refresh timer for the mounted collection of queries.
  useEffect(() => {
    if (!enabled) return;
    const filter = { queryKey, predicate, type: "active" as const };
    const options = { cancelRefetch: false };
    return startForegroundPolling(
      (wake) =>
        wake
          ? client.invalidateQueries({ queryKey, predicate, refetchType: "active" }, options)
          : client.refetchQueries(filter, options),
      period,
      { immediate: false, urgent },
    ).stop;
  }, [client, enabled, period, predicate, queryKey, urgent]);
}
