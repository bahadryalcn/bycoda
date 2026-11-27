import { t } from "../../../shared/i18n";
import { useEffect } from "react";
import { loadRateLimits, useCachedRateLimits } from "../model/rateLimitsCache";
import { accountStatus, providerAccountSignedOut } from "../model/accountUsage";
import {
  rateLimitWindowNameWith,
  type ProviderRateLimits,
  type RateLimitWindow,
} from "../model/rateLimits";

export type ProviderAuthTone = "ready" | "low" | "exhausted" | "signedOut" | "checking" | "unknown";

export type ProviderAuthState = {
  tone: ProviderAuthTone;
  /** Short word for a badge or list line: Signed in, 15% left, Exhausted, Signed out. */
  label: string;
  /** A low account at or below the critical headroom: red instead of yellow. */
  critical?: boolean;
};

/** Only an authenticated billing result proves Grok sign-in; transport failures do not. */
export function grokSignInState(limits: ProviderRateLimits | undefined): ProviderAuthState {
  if (!limits || limits.status === "idle" || limits.status === "fetching")
    return { tone: "checking", label: t("Checking…") };
  if (providerAccountSignedOut(limits)) return { tone: "signedOut", label: t("Signed out") };
  if (limits.status === "ok") return { tone: "ready", label: t("Signed in") };
  return { tone: "unknown", label: t("Not checked") };
}

/** Grok has one CLI-owned identity, stored under `grok:default` in the usage cache. */
export function useGrokSignInState(enabled: boolean, signInCompleted = false): ProviderAuthState {
  const limits = useCachedRateLimits("grok");
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Sync the shared CLI auth probe with provider visibility and completed sign-in, before Usage is opened.
  useEffect(() => {
    if (enabled)
      void loadRateLimits("grok", "default", signInCompleted).catch((error) => {
        console.debug("[bycoda] Grok sign-in probe failed", error);
      });
  }, [enabled, signInCompleted]);
  return grokSignInState(limits);
}

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
  if (limits?.provider === "grok") return grokSignInState(limits);
  if (!limits || limits.status === "idle" || limits.status === "fetching") return null;
  if (providerAccountSignedOut(limits)) return { tone: "signedOut", label: t("Signed out") };
  const status = accountStatus(limits, now);
  if (status.tone === "exhausted") return { tone: "exhausted", label: t("Exhausted") };
  if (status.tone === "low")
    return { tone: "low", label: status.detail ?? t("Running low"), critical: status.critical };
  if (status.tone === "ready") return { tone: "ready", label: t("Signed in") };
  return null;
}

/**
 * Names the used-up windows. The account status displays the reset time.
 * Null when no window is full.
 */
export function exhaustedExplanation(
  limits: ProviderRateLimits | undefined,
  now: number,
): string | null {
  if (!limits) return null;
  const names = [
    windowIsFull(limits.session, now) ? rateLimitWindowNameWith("session", t) : null,
    windowIsFull(limits.weekly, now) ? rateLimitWindowNameWith("weekly", t) : null,
    windowIsFull(limits.monthly, now) ? rateLimitWindowNameWith("monthly", t) : null,
  ].filter((name): name is string => name != null);
  if (names.length === 0) return null;
  return t("The {p0} limit is used up.", { p0: names.join(" + ") });
}
