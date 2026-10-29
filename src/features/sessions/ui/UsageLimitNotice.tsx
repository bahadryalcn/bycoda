import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { useEffect, useState } from "react";
import { Clock, Gauge, Play, Replace, X } from "../../../shared/ui/icons";
import type { ProviderAccountProvider } from "../../providers/model/providerAccounts";
import type { UsageLimit } from "../model/session";
import { formatUsageLimitReset } from "../model/usageLimit";
import { ProviderAccountMenu } from "./ProviderAccountMenu";

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
  const t = useT();
  const [now, setNow] = useState(Date.now);
  const waiting = limit.resetsAt != null && limit.resetsAt > now;
  // Tick the countdown, and flip to "Resume" once the window resets.
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [waiting]);

  const resetText =
    limit.resetsAt == null
      ? ""
      : waiting
        ? t("Resets {p0}", { p0: formatUsageLimitReset(limit.resetsAt, now) })
        : t("Limit has reset");

  return (
    <div className="px-4 py-1" data-usage-limit>
      <Alert
        inline
        tone="warning"
        icon={<Gauge className="icon-sm" aria-hidden />}
        title={t("Usage limit reached")}
        action={
          <>
            {provider && onSwitchAccount ? (
              <ProviderAccountMenu
                variant="notice"
                provider={provider}
                accountId={accountId}
                onSelect={onSwitchAccount}
              />
            ) : null}
            {onSwitchModel ? (
              <Button
                variant="ghost"
                type="button"
                title={t("Continue this conversation with another model")}
                onClick={onSwitchModel}
              >
                <Replace className="size-3.5" />
                {t("Switch model")}
              </Button>
            ) : null}
            {!waiting && !onResume ? (
              <span className="text-ui-caption text-(--ui-text-secondary)">
                {t("Send a message to continue.")}
              </span>
            ) : !waiting ? (
              <Button variant="secondary" type="button" onClick={onResume}>
                <Play className="size-3.5" />
                {t("Resume")}
              </Button>
            ) : !onResumeAtReset ? null : limit.resumeAtReset ? (
              <Button
                variant="ghost"
                type="button"
                title={t("Cancel the automatic resume")}
                onClick={() => onResumeAtReset?.(false)}
              >
                <Clock className="size-3.5" />
                {t("Resuming at reset")}
              </Button>
            ) : (
              <Button
                variant="ghost"
                type="button"
                title={t("Continue this session once the limit resets")}
                onClick={() => onResumeAtReset?.(true)}
              >
                <Clock className="size-3.5" />
                {t("Resume at reset")}
              </Button>
            )}
            <Button
              iconOnly
              label={t("Dismiss usage limit notice")}
              variant="ghost"
              type="button"
              title={t("Dismiss")}
              aria-label={t("Dismiss usage limit notice")}
              onClick={onDismiss}
              className="shrink-0"
            >
              <X className="size-3.5" />
            </Button>
          </>
        }
      >
        {resetText}
      </Alert>
    </div>
  );
}
