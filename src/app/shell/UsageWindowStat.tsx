import { useFormat, useT } from "../../shared/i18n";
import { UsageMeter } from "../../shared/ui/UsageMeter";
import { Text } from "../../shared/ui/Text";
import { Tooltip } from "../../shared/ui/Tooltip";
import { useShowRemainingUsage } from "../../features/settings/model/displayPrefs";
import {
  clampUsedPercent,
  formatResetDuration,
  formatUsagePercent,
  formatWindowLabel,
  rateLimitWindowTooltipWith,
  type RateLimitWindow,
} from "../../features/providers/model/rateLimits";

export function UsageWindowStat({ window, now }: { window: RateLimitWindow; now: number }) {
  const t = useT();
  const format = useFormat();
  const showRemaining = useShowRemainingUsage();
  const pct = clampUsedPercent(window.usedPercent);
  const shown = showRemaining ? 100 - pct : pct;
  const label = formatWindowLabel(window.windowMinutes);
  const valueText = rateLimitWindowTooltipWith(window, now, showRemaining, t, format);
  const resetTime = window.resetsAt == null ? undefined : format.formatDate(window.resetsAt, {
    hour: "numeric",
    minute: "2-digit",
  });
  const tone = pct >= 90 ? "danger" : pct >= 80 ? "warning" : "neutral";
  return (
    <Tooltip label={resetTime ? t("Resets at {p0}", { p0: resetTime }) : undefined}>
      <span className="inline-flex items-center gap-1.5 tabular-nums">
        <Text aria-hidden="true" size="micro" tone="secondary" className="@max-[320px]/usage:hidden">
          {label} · {formatUsagePercent(shown)}
        </Text>
        <UsageMeter
          compact
          showLegend={false}
          showRemaining={showRemaining}
          label={label}
          valueText={valueText}
          className="w-11 shrink-0"
          segments={[{ id: "used", label: t("used"), value: pct }]}
          limit={100}
          unit="%"
          decimals={0}
          tone={tone}
        />
        {window.resetsAt != null ? (
          <Text aria-hidden="true" size="inherit" tone="secondary" className="@max-[320px]/usage:hidden">
            {formatResetDuration(window.resetsAt - now)}
          </Text>
        ) : null}
      </span>
    </Tooltip>
  );
}
