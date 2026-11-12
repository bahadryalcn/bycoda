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
  const label = `${formatWindowLabel(window.windowMinutes)} · ${rateLimitWindowTooltipWith(window, now, showRemaining, t, format)}`;
  const tone = pct >= 90 ? "danger" : pct >= 80 ? "warning" : "neutral";
  return (
    <Tooltip label={label}>
      <span className="inline-flex items-center gap-1.5 tabular-nums">
        <Text aria-hidden="true" size="micro" tone="secondary">
          {formatWindowLabel(window.windowMinutes)} · {formatUsagePercent(shown)}
        </Text>
        <UsageMeter
          compact
          showLegend={false}
          showRemaining={showRemaining}
          label={label}
          valueText={label}
          className="w-11 shrink-0"
          segments={[{ id: "used", label: t("used"), value: pct }]}
          limit={100}
          unit="%"
          decimals={0}
          tone={tone}
        />
        {window.resetsAt != null ? (
          <Text size="inherit" tone="secondary">
            {formatResetDuration(window.resetsAt - now)}
          </Text>
        ) : null}
      </span>
    </Tooltip>
  );
}
