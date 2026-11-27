import { optionalTextAttributes, Text, type TextRoles } from "../../../shared/ui/Text";
import { OverflowTooltip, Tooltip } from "../../../shared/ui/Tooltip";
import { formatDate, t, useLocale } from "../../../shared/i18n";
import {
  clampUsedPercent,
  formatResetDuration,
  formatUsagePercent,
  formatWindowLabel,
  rateLimitWindowNameWith,
  type ProviderRateLimits,
  type RateLimitWindow,
} from "../model/rateLimits";
import type { AccountStatus, AccountStatusTone, AccountUsage } from "../model/accountUsage";
import { RefreshCw } from "../../../shared/ui/icons";
import { Button } from "../../../shared/ui/Button";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { UsageMeter as QuotaMeter } from "../../../shared/ui/UsageMeter";
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
/** The account status label in the current language; the model keeps its fixed labels in English. */
function statusText(label: string): string {
  switch (label) {
    case "Checking…":
      return t("Checking…");
    case "Ready":
      return t("Ready");
    case "Running low":
      return t("Running low");
    case "Exhausted":
      return t("Exhausted");
    case "Not signed in":
      return t("Not signed in");
    case "Usage unavailable":
      return t("Usage unavailable");
    default:
      return label;
  }
}

export function AccountStatusLabel({
  status,
  className = "",
  size,
  tone,
  truncate,
}: {
  status: AccountStatus;
  className?: string;
  /** Text roles of the line: `size` and `truncate` apply to the root, `tone` to the detail text (default muted); the badge keeps its own. */
} & Pick<TextRoles, "size" | "tone" | "truncate">) {
  useLocale();
  // A low account shows only its remaining percent, yellow or red, instead of a "Running low" badge.
  if (status.tone === "low" && status.detail) {
    return (
      <Text
        size={size ?? "inherit"}
        tone={status.critical ? "danger" : "warning"}
        weight="medium"
        truncate={truncate}
        className={`min-w-0 tabular-nums ${className}`}
      >
        {status.detail}
      </Text>
    );
  }
  return (
    <span
      {...optionalTextAttributes(
        { size, truncate },
        `inline-flex min-w-0 items-center gap-1.5 ${className}`,
      )}
    >
      <Badge tone={STATUS_TONE[status.tone]} size="sm">
        {statusText(status.label)}
      </Badge>
      {status.detail ? (
        <OverflowTooltip label={status.detail}>
          <Text size="inherit" tone={tone ?? "muted"} truncate className="min-w-0">
            {status.detail}
          </Text>
        </OverflowTooltip>
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
      onClick={usage.refresh}
    >
      <RefreshCw className="icon-sm" strokeWidth={1.75} />
    </Button>
  );
}

/** Titled 5-hour / weekly / monthly windows an account has data for, titled with `translate`. */
export function meterWindowsWith(
  limits: ProviderRateLimits | undefined,
  translate: (message: string, values?: Record<string, unknown>) => string,
): { title: string; window: RateLimitWindow }[] {
  return [
    limits?.session
      ? { title: rateLimitWindowNameWith("session", translate), window: limits.session }
      : null,
    limits?.weekly
      ? { title: rateLimitWindowNameWith("weekly", translate), window: limits.weekly }
      : null,
    limits?.monthly
      ? { title: rateLimitWindowNameWith("monthly", translate), window: limits.monthly }
      : null,
  ].filter((entry) => entry != null);
}

/** Titled 5-hour / weekly / monthly windows an account has data for. */
export function meterWindows(
  limits: ProviderRateLimits | undefined,
): { title: string; window: RateLimitWindow }[] {
  return meterWindowsWith(limits, t);
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
    // The row's status line already explains why there is no data, so nothing reserves its space.
    if (!loading) return null;
    return (
      <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-2">
        <MeterSkeleton />
        <MeterSkeleton />
      </div>
    );
  }

  return (
    // Meters wrap below the account name when the row is narrow instead of disappearing.
    <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-2">
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
  const full = pct >= 100 && (window.resetsAt == null || window.resetsAt > now);
  const reset =
    window.resetsAt == null
      ? formatWindowLabel(window.windowMinutes)
      : window.resetsAt <= now
        ? t("Resets now")
        : formatResetDuration(window.resetsAt - now);
  const resetsAtLabel =
    window.resetsAt == null
      ? undefined
      : t("Resets {p0}", {
          p0: formatDate(window.resetsAt, { dateStyle: "medium", timeStyle: "short" }),
        });
  return (
    <Tooltip label={resetsAtLabel} describe={false} asChild>
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Focus reveals the exact reset time tooltip for keyboard users. */}
      <div className={className} tabIndex={resetsAtLabel ? 0 : undefined}>
        {resetsAtLabel ? <span className="sr-only">{resetsAtLabel}</span> : null}
        <Text as="div" className="flex items-baseline justify-between gap-2">
          <Text size="inherit" tone="secondary" truncate className="min-w-0">
            {title} · <span className="tabular-nums">{reset}</span>
          </Text>
          <Text
            as="span"
            size="inherit"
            tone={full ? "danger" : "secondary"}
            weight={full ? "medium" : undefined}
            className="shrink-0 tabular-nums"
          >
            {showRemaining
              ? t("{p0} left", { p0: formatUsagePercent(remaining) })
              : full
                ? t("Full")
                : formatUsagePercent(pct)}
          </Text>
        </Text>
        <QuotaMeter
          compact
          showLegend={false}
          showRemaining={showRemaining}
          segments={[{ id: "usage", label: title, value: Math.round(pct) }]}
          limit={100}
          decimals={0}
          tone={pct >= 90 ? "danger" : pct >= 80 ? "warning" : "neutral"}
          className="mt-1.5"
          label={
            showRemaining
              ? t("{p0} limit remaining", { p0: title })
              : t("{p0} limit used", { p0: title })
          }
        />
      </div>
    </Tooltip>
  );
}

function MeterSkeleton() {
  useLocale();
  return <Skeleton className="w-36" lines={2} label={t("Loading…")} />;
}
