import { Text } from "../../../shared/ui/Text";
import { useEffect } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Heading } from "../../../shared/ui/Heading";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { useRateLimitQuery, loadRateLimits } from "../../providers/public/rateLimitsCache";
import { useShowRemainingUsage } from "../../settings/public/settings";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";
import { UsageQuotaWindows } from "./UsageQuotaWindows";

/** Grok exposes one CLI login, not isolated provider-account profiles. */
export function GrokLimits({ refresh }: { refresh: number }) {
  useLocale();
  const limits = useRateLimitQuery("grok", "default", true);
  const showRemaining = useShowRemainingUsage();
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Sync the shared Grok quota cache with the parent refresh generation.
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
      <UsageQuotaWindows name="Grok" windows={windows} showRemaining={showRemaining} />
      {/* The stale windows stay visible while refreshing; only an empty card shows a loading line. */}
      {loading && !windows.length ? <LoadingText>{t("Loading usage…")}</LoadingText> : null}
      {limits.error ? (
        <InlineError
          details={limits.error}
          retry={{ onRetry: () => void loadRateLimits("grok", "default", true), pending: loading }}
        >
          {t("Usage unavailable")}
        </InlineError>
      ) : null}
    </section>
  );
}
