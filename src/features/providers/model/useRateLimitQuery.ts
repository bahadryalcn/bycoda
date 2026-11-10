import { useEffect } from "react";
import { focusManager, useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { bridgeQueryEvents } from "../../../shared/lib/queryClient";
import { getCachedRateLimits, loadRateLimits, subscribeRateLimits } from "./rateLimitsCache";
import type { RateLimitProvider } from "./rateLimits";

/** Claude reads a cheap endpoint; Codex starts a `codex app-server` process per read, so it is polled rarely.
 * The footer's Refresh button and sign-in flows still read on demand. */
const POLL_MS: Record<RateLimitProvider, number> = {
  claude: 120_000,
  codex: 600_000,
  opencode: 120_000,
  grok: 600_000,
};

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
    staleTime: POLL_MS[provider],
    queryFn: () =>
      loadRateLimitsForQuery(provider, accountId, client.getQueryData(queryKey) !== undefined),
    refetchInterval: POLL_MS[provider],
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
