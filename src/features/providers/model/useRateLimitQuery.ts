import { useEffect } from "react";
import { focusManager, useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { bridgeQueryEvents } from "../../../shared/lib/queryClient";
import { getCachedRateLimits, loadRateLimits, subscribeRateLimits } from "./rateLimitsCache";
import type { RateLimitProvider } from "./rateLimits";

export const rateLimitQueryKey = (provider: RateLimitProvider, accountId: string) =>
  ["rate-limits", provider, accountId] as const;

export const loadRateLimitsForQuery = (
  provider: RateLimitProvider,
  accountId = "default",
  force = false,
) => loadRateLimits(provider, accountId, force, () => focusManager.isFocused(), true);

export function useRateLimitQuery(
  provider: RateLimitProvider,
  accountId: string,
  enabled: boolean,
) {
  const client = useQueryClient();
  const visible = useQueryVisible();
  const queryKey = rateLimitQueryKey(provider, accountId);
  const query = useQuery({
    queryKey,
    enabled: enabled && visible,
    staleTime: 120_000,
    queryFn: () =>
      loadRateLimitsForQuery(provider, accountId, client.getQueryData(queryKey) !== undefined),
    refetchInterval: 120_000,
  });
  useEffect(() => {
    let previous = getCachedRateLimits(provider, accountId);
    return bridgeQueryEvents(
      client,
      (receive) =>
        subscribeRateLimits(() => {
          const value = getCachedRateLimits(provider, accountId);
          if (value === previous) return;
          previous = value;
          // Loading presentation is owned by explicit actions; polling retains its snapshot.
          if (value.status !== "fetching" && value.status !== "idle") receive(value);
        }),
      (data) => ({ queryKey: rateLimitQueryKey(provider, accountId), data }),
    );
  }, [client, provider, accountId]);
  return query.data ?? getCachedRateLimits(provider, accountId);
}
