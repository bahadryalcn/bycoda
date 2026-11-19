import { useEffect, useState } from "react";
import { InlineMessage } from "../../../shared/ui/InlineError";
import type { NoticeAction } from "../../../shared/ui/Notice";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { Gauge, X } from "../../../shared/ui/icons";
import { useMinuteNow } from "../../../shared/hooks/useMinuteNow";
import type { ProviderAccountProvider } from "../../providers/model/providerAccounts";
import type { UsageLimit } from "../model/session";
import { formatUsageLimitReset, usageLimitResetDelay } from "../model/usageLimit";
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
  const resetsAt = limit.resetsAt;
  // The minute clock drives the countdown label; it can trail the reset by up to a minute.
  const minuteNow = useMinuteNow(resetsAt != null);
  // Reason: the flip to "Resume" must land at resetsAt itself, so a one-shot deadline timer records it.
  const [deadlineNow, setDeadlineNow] = useState(0);
  useEffect(() => {
    if (resetsAt == null) return;
    const delay = usageLimitResetDelay(resetsAt, Date.now());
    if (delay === undefined) return;
    const timer = window.setTimeout(() => setDeadlineNow(Math.max(Date.now(), resetsAt)), delay);
    return () => window.clearTimeout(timer);
  }, [resetsAt]);
  const now = Math.max(minuteNow, deadlineNow);
  const waiting = resetsAt != null && resetsAt > now;

  // An unknown reset cannot be armed, so the only recovery is a direct retry.
  const resetText =
    resetsAt == null
      ? t("Reset time unknown")
      : waiting
        ? t("Resets {p0}", { p0: formatUsageLimitReset(resetsAt, now) })
        : t("Limit has reset");

  // The toggle names the action it performs: "Cancel auto-resume" while armed, "Resume at reset" to arm.
  const resume: NoticeAction | undefined = !waiting
    ? onResume
      ? { label: resetsAt == null ? t("Try again") : t("Resume"), onClick: onResume }
      : undefined
    : onResumeAtReset
      ? limit.resumeAtReset
        ? { label: t("Cancel auto-resume"), onClick: () => onResumeAtReset(false) }
        : { label: t("Resume at reset"), onClick: () => onResumeAtReset(true) }
      : undefined;
  const switchModel: NoticeAction | undefined = onSwitchModel
    ? { label: t("Switch model"), onClick: onSwitchModel }
    : undefined;

  return (
    <InlineMessage
      data-usage-limit
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
  );
}
