import { Text } from "../../../shared/ui/Text";
import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { useMinuteNow } from "../../../shared/hooks/useMinuteNow";
import { Heading } from "../../../shared/ui/Heading";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { UsageMeter } from "../../../shared/ui/UsageMeter";
import {
  useRateLimitQuery,
  loadRateLimits,
  formatResetCountdown,
  formatWindowLabel,
} from "../../providers/public/rateLimitsCache";
import { useShowRemainingUsage } from "../../settings/public/settings";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";

/** Grok exposes one CLI login, not isolated provider-account profiles. */
export function GrokLimits({ refresh }: { refresh: number }) {
  useLocale();
  const limits = useRateLimitQuery("grok", "default", true);
  const [initialNow] = useState(Date.now);
  const now = useMinuteNow(true) || initialNow;
  const showRemaining = useShowRemainingUsage();
  useEffect(() => {
    if (refresh > 0) void loadRateLimits("grok", "default", true);
  }, [refresh]);
  const loading = limits.status === "idle" || limits.status === "fetching";
  const windows = (["session", "weekly", "monthly"] as const).flatMap((kind) =>
    limits[kind] ? [{ kind, window: limits[kind]! }] : [],
  );
  return (
    <section className="usage-account" aria-label="Grok" aria-busy={loading}>
      <div className="usage-account-heading">
        <Heading size="item" level={3} className="inline-flex items-center gap-2">
          <HarnessIcon harness="grok" className="icon-sm" />
          Grok
        </Heading>
        {limits.updatedAt > 0 ? (
          <Text size="caption" tone="muted" leading="inherit" className="usage-account-observed">
            <span className="sr-only">{t("Last observed")}: </span>
            <Timestamp value={limits.updatedAt} format="relative" />
          </Text>
        ) : null}
      </div>
      <div className="usage-quota-list">
        {windows.map(({ kind, window }) => (
          <div className="usage-quota" key={kind}>
            <Text
              as="div"
              size="caption"
              tone="inherit"
              leading="inherit"
              className="usage-quota-heading"
            >
              <Heading size="item" level={4}>
                {kind === "weekly"
                  ? t("Weekly")
                  : kind === "monthly"
                    ? t("Monthly")
                    : formatWindowLabel(window.windowMinutes)}
                <Text size="inherit" tone="muted" weight="regular" className="usage-quota-reset">
                  {window.resetsAt == null
                    ? t("Reset time unavailable")
                    : formatResetCountdown(window.resetsAt - now)}
                </Text>
              </Heading>
              <Text as="p" size="inherit" tone="secondary">
                <Text as="strong" size="body" tone="primary" weight="medium" leading="inherit">
                  {Math.round(showRemaining ? 100 - window.usedPercent : window.usedPercent)}%
                </Text>
                <span>{showRemaining ? t("left") : t("used")}</span>
              </Text>
            </Text>
            <UsageMeter
              label={`Grok ${kind}`}
              segments={[{ id: "used", label: t("used"), value: window.usedPercent }]}
              limit={100}
              unit="%"
              decimals={0}
              compact
              showLegend={false}
              showRemaining={showRemaining}
            />
          </div>
        ))}
      </div>
      {loading ? <LoadingText presentation="text">{t("Loading usage…")}</LoadingText> : null}
      {limits.error ? (
        <InlineError
          retry={{ onRetry: () => void loadRateLimits("grok", "default", true), pending: loading }}
        >
          {limits.error}
        </InlineError>
      ) : null}
    </section>
  );
}
