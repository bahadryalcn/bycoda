import { t } from "../../../shared/i18n/core";
import { formatResetDuration } from "../../../shared/i18n/format";
import type { BoundFormat } from "../../../shared/i18n/boundFormat";
export { formatResetDuration } from "../../../shared/i18n/format";
import {
  clampUsedPercent,
  MONTHLY_WINDOW_MINUTES,
  SESSION_WINDOW_MINUTES,
  WEEKLY_WINDOW_MINUTES,
  type ProviderRateLimits,
  type RateLimitWindow,
} from "../../../shared/model/provider-quota";
export * from "../../../shared/model/provider-quota";

export function formatUsagePercent(usedPercent: number): string {
  return `${Math.round(clampUsedPercent(usedPercent))}%`;
}

/**
 * Compact window-size label. 10080 minutes stays "wk" to match the
 * original status-bar copy.
 */
export function formatWindowLabel(windowMinutes: number): string {
  if (windowMinutes === WEEKLY_WINDOW_MINUTES) return "wk";
  if (windowMinutes === MONTHLY_WINDOW_MINUTES) return "mo";
  if (windowMinutes === SESSION_WINDOW_MINUTES) return "5h";
  if (windowMinutes === 60) return "1h";
  if (windowMinutes < 60) return `${windowMinutes}m`;
  if (windowMinutes % (60 * 24 * 7) === 0) {
    return `${windowMinutes / (60 * 24 * 7)}wk`;
  }
  if (windowMinutes % (60 * 24) === 0) {
    return `${windowMinutes / (60 * 24)}d`;
  }
  if (windowMinutes % 60 === 0) return `${windowMinutes / 60}h`;
  return `${windowMinutes}m`;
}

type Translate = (message: string, values?: Record<string, unknown>) => string;
type ResetFormat = Pick<BoundFormat, "formatResetDuration">;
const moduleFormat: ResetFormat = { formatResetDuration };

/** `formatResetCountdown` with the translator passed in, for render code that reads `useT()`. */
export function formatResetCountdownWith(
  ms: number,
  translate: Translate,
  format: ResetFormat,
): string {
  const duration = format.formatResetDuration(ms);
  return duration === "now"
    ? translate("Resets now")
    : translate("Resets in {p0}", { p0: duration });
}

export function formatResetCountdown(ms: number): string {
  return formatResetCountdownWith(ms, t, moduleFormat);
}

export type RateLimitWindowKind = "session" | "weekly" | "monthly";

/** The one localized name of a window; meters, status copy and the usage chip all read it. */
export function rateLimitWindowNameWith(kind: RateLimitWindowKind, translate: Translate): string {
  if (kind === "session") return translate("5-hour");
  if (kind === "weekly") return translate("Weekly");
  return translate("Monthly");
}

/**
 * Status-bar chip label. Prefer remaining time when resetsAt is known;
 * fall back to the fixed window size otherwise.
 */
export function formatRateLimitWindowChipLabel(window: RateLimitWindow, now = Date.now()): string {
  if (window.resetsAt != null) {
    return formatResetDuration(window.resetsAt - now);
  }
  return formatWindowLabel(window.windowMinutes);
}

export function rateLimitWindowTooltip(
  window: RateLimitWindow,
  now = Date.now(),
  showRemaining = false,
): string {
  return rateLimitWindowTooltipWith(window, now, showRemaining, t, moduleFormat);
}

/** `rateLimitWindowTooltip` with the clock and translator passed in (no hidden reads). */
export function rateLimitWindowTooltipWith(
  window: RateLimitWindow,
  now: number,
  showRemaining: boolean,
  translate: Translate,
  format: ResetFormat,
): string {
  const pct = clampUsedPercent(window.usedPercent);
  const usage = `${formatUsagePercent(showRemaining ? 100 - pct : pct)} ${showRemaining ? "remaining" : "used"}`;
  if (window.resetsAt == null) {
    return `${usage} · ${formatWindowLabel(window.windowMinutes)} window`;
  }
  return `${usage} · ${formatResetCountdownWith(window.resetsAt - now, translate, format)}`;
}

/** When a used-up window resets; the later one when several are spent. */
export function exhaustedWindowResetAt(limits: ProviderRateLimits): number | null {
  let latest: number | null = null;
  for (const window of [limits.session, limits.weekly, limits.monthly]) {
    if (!window || window.usedPercent < 100 || window.resetsAt == null) continue;
    latest = Math.max(latest ?? 0, window.resetsAt);
  }
  return latest;
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

export type AccountUsageSummary = {
  /** Used share of the tightest window, or null without usage data. */
  usedPercent: number | null;
  /** When that window resets, if known and still ahead. */
  resetsAt: number | null;
};

/**
 * Usage of the window with the least headroom. A window whose reset time has passed counts
 * as unused, matching `accountHeadroom`.
 */
export function accountUsageSummary(
  limits: ProviderRateLimits | undefined,
  now: number,
): AccountUsageSummary {
  if (
    !limits ||
    limits.status === "idle" ||
    limits.status === "unavailable" ||
    limits.reason === "signedOut" ||
    limits.reason === "cliMissing"
  ) {
    return { usedPercent: null, resetsAt: null };
  }
  let tightest: { used: number; resetsAt: number | null } | null = null;
  for (const window of [limits.session, limits.weekly, limits.monthly]) {
    if (!window) continue;
    const expired = window.resetsAt != null && window.resetsAt <= now;
    if (expired && limits.status !== "ok") continue;
    const used = expired ? 0 : Math.min(100, Math.max(0, window.usedPercent || 0));
    if (!tightest || used > tightest.used)
      tightest = { used, resetsAt: expired ? null : window.resetsAt };
  }
  return tightest
    ? { usedPercent: Math.round(tightest.used), resetsAt: tightest.resetsAt }
    : { usedPercent: null, resetsAt: null };
}
