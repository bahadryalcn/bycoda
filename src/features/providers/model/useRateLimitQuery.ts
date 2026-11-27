import { useQuery } from "@tanstack/react-query";
import { useForegroundQueryPolling, useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { foregroundPollsVisible } from "../../../shared/lib/foregroundPolling";
import {
  loadPolledRateLimits,
  loadRateLimits,
  useCachedRateLimits,
  QUOTA_POLL_MS,
  type QuotaSource,
} from "./rateLimitsCache";

export const rateLimitQueryKey = (provider: QuotaSource, accountId: string) =>
  ["rate-limits", provider, accountId] as const;

export const loadRateLimitsForQuery = (
  provider: QuotaSource,
  accountId = "default",
  force = false,
) => loadRateLimits(provider, accountId, force, foregroundPollsVisible);

export function useRateLimitQuery(provider: QuotaSource, accountId: string, enabled: boolean) {
  const visible = useQueryVisible();
  const queryKey = rateLimitQueryKey(provider, accountId);
  const query = useQuery({
    queryKey,
    enabled: enabled && visible,
    staleTime: QUOTA_POLL_MS[provider],
    queryFn: () => loadPolledRateLimits(provider, accountId, foregroundPollsVisible),
    refetchOnWindowFocus: false,
  });
  useForegroundQueryPolling(query.refetch, QUOTA_POLL_MS[provider], enabled);
  return useCachedRateLimits(provider, accountId);
}
