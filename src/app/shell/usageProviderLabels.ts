import type {
  ProviderRateLimits,
  RateLimitWindow,
} from "../../features/providers/model/rateLimits";

export function usageErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
export function updatedLabel(
  limits: ProviderRateLimits,
  now: number,
  t: (message: string, values?: Record<string, unknown>) => string,
): string {
  if (limits.updatedAt <= 0) return t("Rate-limit details");
  const elapsedMinutes = Math.max(0, Math.floor((now - limits.updatedAt) / 60_000));
  // Without any windows, the time is the last check rather than data age.
  if (!limits.session && !limits.weekly && !limits.monthly && !limits.resetCredits) {
    if (elapsedMinutes === 0) return t("Checked just now");
    if (elapsedMinutes < 60) return t("Checked {p0}m ago", { p0: elapsedMinutes });
    return t("Checked {p0}h ago", { p0: Math.floor(elapsedMinutes / 60) });
  }
  if (elapsedMinutes === 0) return t("Updated just now");
  if (elapsedMinutes < 60) return t("Updated {p0}m ago", { p0: elapsedMinutes });
  return t("Updated {p0}h ago", { p0: Math.floor(elapsedMinutes / 60) });
}

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
