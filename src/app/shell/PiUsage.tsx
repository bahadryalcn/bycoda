import { Tooltip } from "../../shared/ui/Tooltip";
import { useT } from "../../shared/i18n";
import { HarnessIcon } from "../../features/sessions/ui/HarnessIcon";
import { piUsageProvider, type PiUsageProvider } from "../../features/providers/model/piUsage";
import {
  loadRateLimitsForQuery,
  useRateLimitQuery,
} from "../../features/providers/model/useRateLimitQuery";
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
  const source = `pi-${provider}` as const;
  const limits = useRateLimitQuery(source, "default", true);
  return (
    <UsageProviderChip
      limits={limits}
      now={now}
      onRefresh={async () => {
        await loadRateLimitsForQuery(source, "default", true);
      }}
      refreshing={limits.status === "fetching"}
      presentation={{
        sourceLabel: "Pi's saved OAuth account",
        harness: "pi",
        label: provider === "anthropic" ? "Pi · Anthropic" : "Pi · OpenAI Codex",
      }}
    />
  );
}
