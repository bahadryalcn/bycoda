import type { CSSProperties } from "react";
import { useFormat, useT } from "../../shared/i18n";
import { Progress } from "../../shared/ui/Progress";
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
  // The compact meter keeps the value inside; at rest its fill is a quiet selection tone
  // instead of the solid content colour, so ambient usage never outshines the workspace.
  const quiet =
    tone === "neutral"
      ? ({
          "--progress-fill": "var(--ui-surface-selected)",
          "--progress-ink": "var(--color-content)",
        } as CSSProperties)
      : undefined;
  return (
    <Tooltip label={label}>
      <span className="inline-flex items-center gap-1.5 tabular-nums">
        <Text aria-hidden="true" size="micro" tone="secondary">
          {formatWindowLabel(window.windowMinutes)}
        </Text>
        <Progress
          compact
          showValue
          valuePlacement="inside"
          valueLabel={formatUsagePercent(shown)}
          aria-label={label}
          aria-valuetext={label}
          className="w-11 shrink-0"
          style={quiet}
          value={shown}
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
