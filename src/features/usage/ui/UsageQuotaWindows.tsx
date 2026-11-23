import { useState } from "react";
import { formatDate, t, useLocale } from "../../../shared/i18n";
import { useMinuteNow } from "../../../shared/hooks/useMinuteNow";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Text } from "../../../shared/ui/Text";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { UsageMeter } from "../../../shared/ui/UsageMeter";
import {
  clampUsedPercent,
  formatResetCountdown,
  type RateLimitWindow,
  type RateLimitWindowKind,
} from "../../providers/model/rateLimits";

/**
 * Reset countdown on the shared minute clock. Only this text re-renders each minute, and the
 * clock stops while the window is hidden, so the section never re-renders for time alone.
 * The absolute reset time is the tooltip, not a second line.
 */
function ResetCountdown({ resetsAt }: { resetsAt: number }) {
  const tick = useMinuteNow();
  const [mountedAt] = useState(Date.now);
  return (
    <Tooltip label={formatDate(resetsAt, { dateStyle: "medium", timeStyle: "short" })} asChild>
      <span>{formatResetCountdown(resetsAt - (tick || mountedAt))}</span>
    </Tooltip>
  );
}

function windowLabel(kind: RateLimitWindowKind, window: RateLimitWindow): string {
  if (kind === "weekly") return t("Weekly");
  if (kind === "monthly") return t("Monthly");
  return window.windowMinutes === 300 ? t("5 hours") : t("Session");
}

/**
 * The quota windows (5 hours, weekly, monthly) of one provider account: title and reset
 * countdown, the percent used or left, and its meter. Shared by account and Grok limits.
 */
export function UsageQuotaWindows({
  name,
  windows,
  showRemaining,
  color,
}: {
  /** Account name used in each meter's accessible label. */
  name: string;
  windows: { kind: RateLimitWindowKind; window: RateLimitWindow }[];
  showRemaining: boolean;
  color?: string;
}) {
  useLocale();
  return (
    <div className="usage-quota-list">
      {windows.map(({ kind, window }) => {
        const used = clampUsedPercent(window.usedPercent);
        const shown = showRemaining ? 100 - used : used;
        const direction = showRemaining ? t("left") : t("used");
        const label = windowLabel(kind, window);
        return (
          <div key={kind} className="usage-quota">
            <Text
              as="div"
              size="caption"
              tone="inherit"
              leading="inherit"
              className="usage-quota-heading"
            >
              <SectionLabel as="h4" classNames={{ label: "usage-quota-title" }}>
                {label}
                <Text size="inherit" tone="muted" weight="regular" className="usage-quota-reset">
                  {window.resetsAt == null ? (
                    t("Reset time unavailable")
                  ) : (
                    <ResetCountdown resetsAt={window.resetsAt} />
                  )}
                </Text>
              </SectionLabel>
              <Text as="p" size="inherit" tone="secondary">
                <Text as="strong" size="body" tone="primary" weight="medium" leading="inherit">
                  {Math.round(shown)}%
                </Text>
                <span>{direction}</span>
              </Text>
            </Text>
            <UsageMeter
              label={`${name} · ${label} · ${direction}`}
              segments={[{ id: "used", label: t("used"), value: used }]}
              limit={100}
              unit="%"
              decimals={0}
              compact
              showLegend={false}
              showRemaining={showRemaining}
              color={color}
            />
          </div>
        );
      })}
    </div>
  );
}
