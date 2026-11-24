import type {
  ProviderRateLimits,
  RateLimitWindow,
} from "../../features/providers/model/rateLimits";

export function usageErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
export { updatedLabel } from "../../features/providers/model/rateLimits";

export type UsageWindowEntry = {
  key: "session" | "weekly" | "monthly";
  window: RateLimitWindow;
};
export function usageWindows(limits: ProviderRateLimits): UsageWindowEntry[] {
  return [
    limits.session ? ({ key: "session", window: limits.session } as const) : null,
    limits.weekly ? ({ key: "weekly", window: limits.weekly } as const) : null,
    limits.monthly ? ({ key: "monthly", window: limits.monthly } as const) : null,
  ].filter((entry): entry is UsageWindowEntry => entry != null);
}
