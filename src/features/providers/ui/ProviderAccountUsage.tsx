import { t, useLocale, getLocale } from "../../../shared/i18n";
import {
  clampUsedPercent,
  formatResetDuration,
  formatUsagePercent,
  formatWindowLabel,
  type ProviderRateLimits,
  type RateLimitWindow,
} from "../model/rateLimits";
import type { AccountStatus, AccountStatusTone, AccountUsage } from "../model/accountUsage";
import { RefreshCw } from "../../../shared/ui/icons";
import { Button } from "../../../shared/ui/Button";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { Progress } from "../../../shared/ui/Progress";
import { Skeleton } from "../../../shared/ui/Skeleton";
import { useShowRemainingUsage } from "../../settings/model/displayPrefs";

const STATUS_TONE: Record<AccountStatusTone, BadgeTone> = {
  ready: "success",
  low: "warning",
  exhausted: "danger",
  checking: "neutral",
  unknown: "neutral",
};

/** Dot + word, e.g. "● Ready" or "● Exhausted back in 31m". */
export function AccountStatusLabel({
  status,
  className = "",
}: {
  status: AccountStatus;
  className?: string;
}) {
  useLocale();
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}
      title={status.detail ? `${status.label} · ${status.detail}` : status.label}
    >
      <Badge tone={STATUS_TONE[status.tone]} size="sm">
        {status.label}
      </Badge>
      {status.detail ? (
        <span className="min-w-0 truncate text-[var(--ui-text-muted)]">{status.detail}</span>
      ) : null}
    </span>
  );
}

export function AccountUsageRefresh({ usage }: { usage: AccountUsage }) {
  useLocale();
  return (
    <Button
      type="button"
      variant="ghost"
      iconOnly
      label={t("Refresh usage limits")}
      loading={usage.refreshing}
      disabled={usage.refreshing}
      onClick={usage.refresh}
      aria-label={t("Refresh usage limits")}
      title={t("Refresh usage limits")}
    >
      <RefreshCw className="size-3.5" strokeWidth={1.75} />
    </Button>
  );
}

/** Titled 5h / weekly / monthly windows an account has data for. */
export function meterWindows(
  limits: ProviderRateLimits | undefined,
): { title: string; window: RateLimitWindow }[] {
  return [
    limits?.session ? { title: "5h", window: limits.session } : null,
    limits?.weekly
      ? {
          get title() {
            return t("Weekly");
          },
          window: limits.weekly,
        }
      : null,
    limits?.monthly
      ? {
          get title() {
            return t("Monthly");
          },
          window: limits.monthly,
        }
      : null,
  ].filter((entry) => entry != null);
}

/** Compact 5h / weekly meters for one account row. */
export function AccountUsageMeters({
  limits,
  now,
}: {
  limits: ProviderRateLimits | undefined;
  now: number;
}) {
  useLocale();
  const windows = meterWindows(limits);

  if (windows.length === 0) {
    const loading = !limits || limits.status === "idle" || limits.status === "fetching";
    return (
      <div className="hidden shrink-0 gap-4 sm:flex">
        {loading ? (
          <>
            <MeterSkeleton />
            <MeterSkeleton />
          </>
        ) : (
          // The row's status line already explains why there is no data.
          <span className="w-[19rem]" aria-hidden />
        )}
      </div>
    );
  }

  return (
    <div className="hidden shrink-0 gap-4 sm:flex">
      {windows.map((entry) => (
        <UsageMeter key={entry.title} title={entry.title} window={entry.window} now={now} />
      ))}
    </div>
  );
}

export function UsageMeter({
  title,
  window,
  now,
  className = "w-36",
}: {
  title: string;
  window: RateLimitWindow;
  now: number;
  className?: string;
}) {
  useLocale();
  const showRemaining = useShowRemainingUsage();
  const pct = clampUsedPercent(window.usedPercent);
  const remaining = 100 - pct;
  const shown = showRemaining ? remaining : pct;
  const full = pct >= 100 && (window.resetsAt == null || window.resetsAt > now);
  const reset =
    window.resetsAt == null
      ? formatWindowLabel(window.windowMinutes)
      : window.resetsAt <= now
        ? "reset due"
        : formatResetDuration(window.resetsAt - now);
  return (
    <div
      className={className}
      title={
        window.resetsAt == null
          ? undefined
          : t("Resets {p0}", { p0: new Date(window.resetsAt).toLocaleString(getLocale()) })
      }
    >
      <div className="flex items-baseline justify-between gap-2 text-(length:--ui-font-caption) leading-4">
        <span className="min-w-0 truncate text-[var(--ui-text-secondary)]">
          {title} · <span className="tabular-nums">{reset}</span>
        </span>
        <span
          className={`shrink-0 tabular-nums ${full ? "font-medium text-danger" : "text-[var(--ui-text-secondary)]"}`}
        >
          {showRemaining
            ? t("{p0} left", { p0: formatUsagePercent(remaining) })
            : full
              ? t("Full")
              : formatUsagePercent(pct)}
        </span>
      </div>
      <Progress
        compact
        tone={pct >= 90 ? "danger" : pct >= 80 ? "warning" : "neutral"}
        className="mt-1.5"
        value={Math.round(shown)}
        aria-label={t(showRemaining ? "{p0} limit remaining" : "{p0} limit used", { p0: title })}
      />
    </div>
  );
}

function MeterSkeleton() {
  useLocale();
  return <Skeleton className="w-36" lines={2} label={t("Loading…")} />;
}

/** Bar colour by percent used; shared with the footer usage chip. */
export function barClass(pct: number): string {
  if (pct >= 90) return "bg-danger";
  if (pct >= 80) return "bg-warning";
  return "bg-content/45";
}
