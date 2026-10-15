import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useState } from "react";
import { Clock, Gauge, Play, Replace, X } from "../../../shared/ui/icons";
import type { ProviderAccountProvider } from "../../providers/model/providerAccounts";
import type { UsageLimit } from "../model/session";
import { formatUsageLimitReset } from "../model/usageLimit";
import { ProviderAccountMenu } from "./ProviderAccountMenu";

const BUTTON =
  "flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 hover:bg-content/10 hover:text-content";

export function UsageLimitNotice({
  limit,
  provider,
  accountId,
  onResume,
  onResumeAtReset,
  onSwitchAccount,
  onSwitchModel,
  onDismiss,
}: {
  limit: UsageLimit;
  /** Set for claude/codex; with `accountId`, other accounts can take over. */
  provider?: ProviderAccountProvider;
  accountId?: string;
  onResume?: () => void;
  onResumeAtReset?: (enabled: boolean) => void;
  onSwitchAccount?: (accountId: string) => void;
  /** Opens the composer's model picker to continue on another model. */
  onSwitchModel?: () => void;
  onDismiss?: () => void;
}) {
  useLocale();
  const [now, setNow] = useState(Date.now);
  const waiting = limit.resetsAt != null && limit.resetsAt > now;
  // Tick the countdown, and flip to "Resume" once the window resets.
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [waiting]);

  return (
    <div className="px-2 text-content/55" data-usage-limit>
      <div className="relative z-0 flex h-8 items-center gap-2 rounded-t-[10px] border border-b-0 border-warning/25 bg-warning/10 px-2 text-[12px]">
        <Gauge className="size-3.5 shrink-0 text-warning" />
        <span className="shrink-0 text-content/85">{t("Usage limit reached")}</span>
        <span className="min-w-0 flex-1 truncate">
          {limit.resetsAt == null
            ? ""
            : waiting
              ? t("Resets {p0}", { p0: formatUsageLimitReset(limit.resetsAt, now) })
              : t("Limit has reset")}
        </span>
        {provider && onSwitchAccount ? (
          <ProviderAccountMenu
            variant="notice"
            provider={provider}
            accountId={accountId}
            onSelect={onSwitchAccount}
          />
        ) : null}
        {onSwitchModel ? (
          <button
            type="button"
            title={t("Continue this conversation with another model")}
            onClick={onSwitchModel}
            className={BUTTON}
          >
            <Replace className="size-3.5" />
            {t("Switch model")}
          </button>
        ) : null}
        {!waiting ? (
          <button type="button" onClick={onResume} className={BUTTON}>
            <Play className="size-3.5" />
            {t("Resume")}
          </button>
        ) : limit.resumeAtReset ? (
          <button
            type="button"
            title={t("Cancel the automatic resume")}
            onClick={() => onResumeAtReset?.(false)}
            className={`${BUTTON} text-warning`}
          >
            <Clock className="size-3.5" />
            {t("Resuming at reset")}
          </button>
        ) : (
          <button
            type="button"
            title={t("Continue this session once the limit resets")}
            onClick={() => onResumeAtReset?.(true)}
            className={BUTTON}
          >
            <Clock className="size-3.5" />
            {t("Resume at reset")}
          </button>
        )}
        <button
          type="button"
          title={t("Dismiss")}
          aria-label={t("Dismiss usage limit notice")}
          onClick={onDismiss}
          className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-content/10 hover:text-content"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
