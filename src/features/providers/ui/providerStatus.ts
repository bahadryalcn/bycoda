import { t } from "../../../shared/i18n";
import { accountStatus, providerAccountSignedOut } from "../model/accountUsage";
import {
  exhaustedWindowResetAt,
  formatResetDuration,
  type ProviderRateLimits,
  type RateLimitWindow,
} from "../model/rateLimits";

export type ProviderAuthTone = "ready" | "low" | "exhausted" | "signedOut";

export type ProviderAuthState = {
  tone: ProviderAuthTone;
  /** Short word for a badge or list line: Signed in, Running low, Exhausted, Signed out. */
  label: string;
};

/** A window counts as used up until its reset time passes. */
function windowIsFull(window: RateLimitWindow | null, now: number): window is RateLimitWindow {
  return (
    window != null &&
    window.usedPercent >= 100 &&
    (window.resetsAt == null || window.resetsAt > now)
  );
}

/**
 * Sign-in state of one account from its cached usage, or null when nothing is known yet.
 * Never starts a probe: callers pass what the shared usage cache already holds.
 */
export function providerAuthState(
  limits: ProviderRateLimits | undefined,
  now: number,
): ProviderAuthState | null {
  if (!limits || limits.status === "idle" || limits.status === "fetching") return null;
  if (providerAccountSignedOut(limits)) return { tone: "signedOut", label: t("Signed out") };
  const status = accountStatus(limits, now);
  if (status.tone === "exhausted") return { tone: "exhausted", label: t("Exhausted") };
  if (status.tone === "low") return { tone: "low", label: t("Running low") };
  if (status.tone === "ready") return { tone: "ready", label: t("Signed in") };
  return null;
}

/**
 * Says which limit is used up and when it frees, for an account whose headroom is gone.
 * Null when no window is full.
 */
export function exhaustedExplanation(
  limits: ProviderRateLimits | undefined,
  now: number,
): string | null {
  if (!limits) return null;
  const names = [
    windowIsFull(limits.session, now) ? t("5-hour") : null,
    windowIsFull(limits.weekly, now) ? t("weekly") : null,
    windowIsFull(limits.monthly, now) ? t("monthly") : null,
  ].filter((name): name is string => name != null);
  if (names.length === 0) return null;
  const resetAt = exhaustedWindowResetAt(limits);
  const limit = names.join(" + ");
  return resetAt != null && resetAt > now
    ? t("The {p0} limit is used up. Back in {p1}.", {
        p0: limit,
        p1: formatResetDuration(resetAt - now),
      })
    : t("The {p0} limit is used up.", { p0: limit });
}
