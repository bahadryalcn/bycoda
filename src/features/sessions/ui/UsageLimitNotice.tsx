import { InlineMessage } from "../../../shared/ui/InlineError";
import type { NoticeAction } from "../../../shared/ui/Notice";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { useEffect, useState } from "react";
import { Gauge, X } from "../../../shared/ui/icons";
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

  const resume: NoticeAction | undefined = !waiting
    ? onResume
      ? { label: t("Resume"), onClick: onResume }
      : undefined
    : onResumeAtReset
      ? limit.resumeAtReset
        ? { label: t("Resuming at reset"), onClick: () => onResumeAtReset(false) }
        : { label: t("Resume at reset"), onClick: () => onResumeAtReset(true) }
      : undefined;
  const switchModel: NoticeAction | undefined = onSwitchModel
    ? { label: t("Switch model"), onClick: onSwitchModel }
    : undefined;

  return (
    <div className="px-4 py-1" data-usage-limit>
      <InlineMessage
        tone="warning"
        icon={<Gauge className="icon-sm" aria-hidden />}
        action={resume ?? switchModel}
        secondaryAction={resume ? switchModel : undefined}
        extra={
          <>
            {provider && onSwitchAccount ? (
              <ProviderAccountMenu
                variant="notice"
                provider={provider}
                accountId={accountId}
                onSelect={onSwitchAccount}
              />
            ) : null}
            <Button
              iconOnly
              label={t("Dismiss usage limit notice")}
              variant="ghost"
              type="button"
              tooltip={t("Dismiss")}
              aria-label={t("Dismiss usage limit notice")}
              onClick={onDismiss}
              className="shrink-0"
            >
              <X className="icon-sm" />
            </Button>
          </>
        }
      >
        <strong>{t("Usage limit reached")} </strong>
        {resetText}
        {!waiting && !onResume ? <> {t("Send a message to continue.")}</> : null}
      </InlineMessage>
    </div>
  );
}
