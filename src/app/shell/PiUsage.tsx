import { Tooltip } from "../../shared/ui/Tooltip";
import { useT } from "../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { HarnessIcon } from "../../features/sessions/ui/HarnessIcon";
import {
  fetchPiUsage,
  piBillingProvider,
  piUsageProvider,
  type PiUsageProvider,
} from "../../features/providers/model/piUsage";
import {
  idleRateLimits,
  RATE_LIMIT_MIN_REFETCH_MS,
  RATE_LIMIT_POLL_MS,
} from "../../features/providers/model/rateLimits";
import { UsageProviderChip } from "./UsageProviderChip";

export function PiUsage({ model, now }: { model?: string; now: number }) {
  const t = useT();
  const provider = piUsageProvider(model);
  if (!provider) {
    return (
      <Tooltip
        label={
          !model || model === "pi:default"
            ? t("Send a message so Pi can report its configured provider.")
            : t("Subscription usage is not supported for this Pi provider.")
        }
      >
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <HarnessIcon harness="pi" className="icon-sm shrink-0" />
        </span>
      </Tooltip>
    );
  }
  return <PiProviderUsage key={provider} provider={provider} now={now} />;
}

function PiProviderUsage({ provider, now }: { provider: PiUsageProvider; now: number }) {
  const [limits, setLimits] = useState(() => idleRateLimits(piBillingProvider(provider)));
  const refreshRef = useRef<(force?: boolean) => Promise<void>>(async () => {});
  useEffect(() => {
    let disposed = false;
    let inflight = false;
    let lastFetchAt = 0;
    const refresh = async (force = false) => {
      if (disposed || inflight) return;
      if (
        !force &&
        (document.visibilityState !== "visible" ||
          Date.now() - lastFetchAt < RATE_LIMIT_MIN_REFETCH_MS)
      )
        return;
      inflight = true;
      setLimits({
        ...idleRateLimits(piBillingProvider(provider)),
        status: "fetching",
      });
      try {
        const result = await fetchPiUsage(provider);
        if (!disposed) setLimits(result);
      } finally {
        inflight = false;
        lastFetchAt = Date.now();
      }
    };
    refreshRef.current = refresh;
    const onVisible = () => void refresh().catch(console.error);
    onVisible();
    const timer = window.setInterval(onVisible, RATE_LIMIT_POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [provider]);
  return (
      <UsageProviderChip
        limits={limits}
        now={now}
        onRefresh={() => refreshRef.current(true).catch(console.error)}
        refreshing={limits.status === "fetching"}
        presentation={{
          sourceLabel: "Pi's saved OAuth account",
          harness: "pi",
          label: provider === "anthropic" ? "Pi · Anthropic" : "Pi · OpenAI Codex",
        }}
      />
  );
}
