import { useEffect, useState } from "react";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import type { NoticeAction } from "../../../shared/ui/Notice";
import { useFormat, useT } from "../../../shared/i18n";
import { Gauge } from "../../../shared/ui/icons";
import { useMinuteNow } from "../../../shared/hooks/useMinuteNow";
import type { ProviderAccountProvider } from "../../providers/model/providerAccounts";
import type { UsageLimit } from "../model/session";
import { formatUsageLimitResetWith, usageLimitResetDelay } from "../model/usageLimit";
import { ProviderAccountMenu } from "./ProviderAccountMenu";

export function UsageLimitNotice({
  limit,
  provider,
  accountId,
  onResume,
  resumeDisabled,
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
  resumeDisabled?: boolean;
  onResumeAtReset?: (enabled: boolean) => void;
  onSwitchAccount?: (accountId: string) => void;
  /** Opens the composer's model picker to continue on another model. */
  onSwitchModel?: () => void;
  onDismiss?: () => void;
}) {
  const t = useT();
  const format = useFormat();
  const ready = limit.recoveryFrom !== undefined;
  const resetsAt = ready ? undefined : limit.resetsAt;
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
  const resetText = ready
    ? undefined
    : resetsAt == null
      ? t("Reset time unknown")
      : waiting
        ? t("Resets {p0}", { p0: formatUsageLimitResetWith(resetsAt, now, t, format) })
        : t("Limit has reset");

  // The toggle names the action it performs: "Cancel auto-resume" while armed, "Resume at reset" to arm.
  const resume: NoticeAction | undefined =
    !waiting && onResume
      ? {
          label: ready ? t("Continue") : resetsAt == null ? t("Try again") : t("Resume"),
          disabled: resumeDisabled,
          onClick: onResume,
        }
      : undefined;
  const switchModel: NoticeAction | undefined = onSwitchModel
    ? { label: t("Switch model"), onClick: onSwitchModel }
    : undefined;
  const canChangeAutoResume = waiting && onResumeAtReset;
  const description = [
    resetText,
    !waiting && !onResume ? t("Send a message to continue.") : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Alert
      data-usage-limit
      actionsAlign="center"
      tone={ready ? "info" : "warning"}
      title={ready ? t("Ready to continue") : t("Usage limit reached")}
      icon={ready ? undefined : <Gauge className="icon-md" aria-hidden />}
      action={resume ?? (!ready ? switchModel : undefined)}
      secondaryAction={resume && !ready ? switchModel : undefined}
      open={onDismiss ? true : undefined}
      onDismiss={onDismiss}
      dismissLabel={t("Dismiss usage limit notice")}
      extra={
        !ready && ((provider && onSwitchAccount) || canChangeAutoResume) ? (
          <>
            {provider && onSwitchAccount ? (
              <ProviderAccountMenu
                variant="notice"
                provider={provider}
                accountId={accountId}
                onSelect={onSwitchAccount}
              />
            ) : null}
            {canChangeAutoResume ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => canChangeAutoResume(!limit.resumeAtReset)}
              >
                {limit.resumeAtReset ? t("Cancel auto-resume") : t("Resume at reset")}
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    >
      {description}
    </Alert>
  );
}
