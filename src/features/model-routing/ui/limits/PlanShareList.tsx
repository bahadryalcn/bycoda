import type {
  PlanShareAccount,
  PlanShareJob,
  PlanShareWindow,
} from "../../../../shared/model/host-contracts/usage-plan-share";
import { useFormat, useT } from "../../../../shared/i18n";
import { DescriptionItem, DescriptionList } from "../../../../shared/ui/DescriptionList";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { InlineError } from "../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { Text } from "../../../../shared/ui/Text";
import { usePlanShare } from "../../model/planShareQuery";
import { untrackedCopy, type PlanShareHost } from "./planShareUntracked";

type Format = ReturnType<typeof useFormat>;

/** "≈ 4.5%" for an estimate; `null` is unknown, never zero. */
function estimateText(
  t: ReturnType<typeof useT>,
  format: Format,
  percent: number | null,
  partial = false,
): string {
  if (percent === null) return t("Unknown");
  const value = format.formatNumber(percent / 100, {
    style: "percent",
    maximumFractionDigits: percent < 10 ? 1 : 0,
  });
  return partial ? t("≥ {p0}", { p0: value }) : t("≈ {p0}", { p0: value });
}

function jobTitle(t: ReturnType<typeof useT>, job: PlanShareJob): string {
  return job.label ?? t("Session {p0}", { p0: job.sessionId.slice(0, 8) });
}

function AccountShare({
  account,
  label,
  host,
}: {
  account: PlanShareAccount;
  label: string;
  host: PlanShareHost;
}) {
  const t = useT();
  const format = useFormat();
  const untracked = untrackedCopy(t, host);
  const known = account.status === "ok";
  return (
    <section className="flex min-w-0 flex-col gap-1">
      <SectionLabel
        as="h4"
        actions={
          known ? (
            <Text size="secondary" tone="secondary">
              {estimateText(t, format, account.observedPercent)}
            </Text>
          ) : undefined
        }
      >
        {label}
      </SectionLabel>
      {/* An account without jobs shows only its header; "no usage" is said once for the whole list. */}
      {account.jobs.length === 0 ? null : (
        <DescriptionList size="sm">
          {account.jobs.map((job) => (
            <DescriptionItem
              key={job.sessionId}
              term={jobTitle(t, job)}
              truncate
              tooltip={job.sessionId}
            >
              {estimateText(t, format, job.estimatedPercent, job.partial)}
            </DescriptionItem>
          ))}
          {known && account.untrackedPercent !== null ? (
            <DescriptionItem
              term={
                <span className="inline-flex items-center gap-1">
                  {untracked.label}
                  <InfoPopover label={untracked.label}>{untracked.info}</InfoPopover>
                </span>
              }
            >
              {estimateText(t, format, account.untrackedPercent)}
            </DescriptionItem>
          ) : null}
        </DescriptionList>
      )}
    </section>
  );
}

/**
 * Estimated share of each account's plan window that the top jobs used, with the account's
 * untracked usage. Estimates only; accounts are listed separately and never pooled.
 */
export function PlanShareList({
  machineId,
  host,
  supported,
  window,
  accounts,
  accountLabels,
  limit,
}: {
  machineId: string | undefined;
  /** The Host the usage was measured on, named in the untracked row. */
  host: PlanShareHost;
  supported: boolean;
  window: PlanShareWindow;
  accounts?: string[];
  /** Display names by `provider:accountId`; an account without one shows its id. */
  accountLabels?: Record<string, string>;
  limit?: number;
}) {
  const t = useT();
  const share = usePlanShare({ machineId, supported, window, accounts, limit });
  if (!share.supported) return null;
  if (share.loading) return <LoadingText>{t("Loading…")}</LoadingText>;
  if (share.error)
    return <InlineError details={share.error}>{t("Could not estimate plan usage.")}</InlineError>;
  const shown = share.result?.accounts ?? [];
  if (shown.every((account) => account.jobs.length === 0))
    return <EmptyState size="inline" title={t("No usage in this window")} />;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {shown.map((account) => (
        <AccountShare
          key={account.account}
          account={account}
          label={accountLabels?.[account.account] ?? account.account.replace(/^[^:]*:/, "")}
          host={host}
        />
      ))}
    </div>
  );
}
