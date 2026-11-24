import { Tooltip } from "../../shared/ui/Tooltip";
import { Button } from "../../shared/ui/Button";
import { useT } from "../../shared/i18n";
import { RefreshCw } from "../../shared/ui/icons";
import { Spinner } from "../../shared/ui/Spinner";
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
          <span>{t("pi · Usage unavailable")}</span>
        </span>
      </Tooltip>
    );
  }
  return <PiProviderUsage key={provider} provider={provider} now={now} />;
}

function PiProviderUsage({ provider, now }: { provider: PiUsageProvider; now: number }) {
  const t = useT();
  const source = `pi-${provider}` as const;
  const limits = useRateLimitQuery(source, "default", true);
  const fetching = limits.status === "fetching";
  return (
    <>
      <UsageProviderChip
        limits={limits}
        now={now}
        presentation={{
          sourceLabel: "Pi's saved OAuth account",
          harness: "pi",
          label: provider === "anthropic" ? "Pi · Anthropic" : "Pi · OpenAI Codex",
        }}
      />
      <Button
        iconOnly
        label={t("Refresh Pi usage")}
        variant="ghost"
        motion="none"
        type="button"
        size="sm"
        disabled={fetching}
        onClick={() => void loadRateLimitsForQuery(source, "default", true)}
        className="shrink-0"
      >
        {fetching ? <Spinner /> : <RefreshCw className="icon-sm" aria-hidden />}
      </Button>
    </>
  );
}
