import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { ClampText } from "../../../../shared/ui/ClampText";
import { Text } from "../../../../shared/ui/Text";
import { formatDate, t } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { ActionHost } from "../../../../shared/ui/ActionHost";
import { Button } from "../../../../shared/ui/Button";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { NativeSelect } from "../../../../shared/ui/Select";
import type { SocialAccount, SocialCampaign, SocialJob } from "../../model/social";
import type { SocialProgram } from "../../model/socialProgram";
import { PlatformMark } from "../common/PlatformIcon";
import type { StatusTextStatus } from "../common/StatusText";
import { ContentStateBadge } from "./ContentStatus";

export type ContentListStatus = "all" | "draft" | "scheduled" | "sent" | "failed" | "review";

export type ContentListProps = {
  campaigns: SocialCampaign[];
  jobs: SocialJob[];
  accounts: SocialAccount[];
  programs: SocialProgram[];
  accountFilter: string;
  statusFilter: ContentListStatus;
  onAccountFilter: (accountId: string) => void;
  onStatusFilter: (status: ContentListStatus) => void;
  onOpen: (campaignId: string) => void;
};

/** The campaign's state in one word: its newest job, or Draft / Paused when it has none. */
export function campaignState(
  campaign: SocialCampaign,
  jobs: SocialJob[],
): StatusTextStatus | "draft" | "paused" {
  const latest = jobs
    .filter((job) => job.campaignId === campaign.id && job.kind === "publish")
    .sort((a, b) => b.scheduledAt - a.scheduledAt)[0];
  if (latest) return latest.status;
  return campaign.paused ? "paused" : "draft";
}

function matchesStatus(state: string, filter: ContentListStatus): boolean {
  switch (filter) {
    case "all":
      return true;
    case "draft":
      return state === "draft" || state === "paused";
    case "scheduled":
      return state === "queued" || state === "running";
    case "sent":
      return state === "succeeded";
    case "failed":
      return state === "failed" || state === "cancelled";
    case "review":
      return state === "review";
  }
}

/** Compact list of saved posts with account and status filters, then the project's repeating programs. */
export function ContentList({
  campaigns,
  jobs,
  accounts,
  programs,
  accountFilter,
  statusFilter,
  onAccountFilter,
  onStatusFilter,
  onOpen,
}: ContentListProps) {
  const rows = campaigns
    .filter(
      (campaign) =>
        !accountFilter || campaign.variants.some((variant) => variant.accountId === accountFilter),
    )
    .map((campaign) => ({ campaign, state: campaignState(campaign, jobs) }))
    .filter((row) => matchesStatus(row.state, statusFilter));
  return (
    <div className="content-list">
      <div className="content-list-filters">
        <NativeSelect
          aria-label={t("Account")}
          value={accountFilter}
          onChange={(event) => onAccountFilter(event.target.value)}
        >
          <option value="">{t("All accounts")}</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t("Status")}
          value={statusFilter}
          onChange={(event) => onStatusFilter(event.target.value as ContentListStatus)}
        >
          <option value="all">{t("All statuses")}</option>
          <option value="draft">{t("Draft")}</option>
          <option value="scheduled">{t("Scheduled")}</option>
          <option value="sent">{t("Sent")}</option>
          <option value="failed">{t("Failed")}</option>
          <option value="review">{t("Needs review")}</option>
        </NativeSelect>
      </div>
      {rows.length ? (
        <ul {...surfaceAttributes({ frame: "pane", edge: "all", radius: "card" }, "content-rows")}>
          {rows.map(({ campaign, state }) => {
            const platforms = [
              ...new Set(
                campaign.variants
                  .map(
                    (variant) =>
                      accounts.find((account) => account.id === variant.accountId)?.platform,
                  )
                  .filter(
                    (platform): platform is NonNullable<typeof platform> => platform !== undefined,
                  ),
              ),
            ];
            const first = campaign.variants[0];
            const at = first?.scheduledAt;
            const preview = first?.text.trim();
            return (
              <ActionHost key={campaign.id} as="li" className="content-row-host">
                <Button
                  variant="item"
                  size="sm"
                  className="content-row"
                  data-action-primary=""
                  onClick={() => onOpen(campaign.id)}
                >
                  <span className="content-row-body">
                    <span className="content-row-marks">
                      {platforms.map((platform) => (
                        <PlatformMark key={platform} platform={platform} size="sm" />
                      ))}
                    </span>
                    <span className="content-row-main">
                      <Text
                        size="inherit"
                        tone="inherit"
                        weight="medium"
                        truncate
                        className="content-row-name"
                      >
                        {campaign.name}
                      </Text>
                      {preview ? (
                        <ClampText
                          as="span"
                          lines={2}
                          expandable={false}
                          size="caption"
                          tone="secondary"
                          leading="inherit"
                          className="content-row-text"
                        >
                          {preview}
                        </ClampText>
                      ) : null}
                    </span>
                    <Text
                      size="caption"
                      tone="secondary"
                      leading="inherit"
                      className="content-row-meta"
                    >
                      {at ? (
                        <span className="content-row-time">
                          {formatDate(at, {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      ) : null}
                      <ContentStateBadge state={state} />
                    </Text>
                  </span>
                </Button>
              </ActionHost>
            );
          })}
        </ul>
      ) : (
        <Text
          as="p"
          size="caption"
          tone="muted"
          leading="inherit"
          className="content-platform-note"
        >
          {t("No posts match these filters.")}
        </Text>
      )}
      {programs.length ? (
        <section className="content-programs" aria-label={t("Repeating programs")}>
          <SectionLabel as="h3" className="content-programs-title">
            {t("Repeating programs")}
          </SectionLabel>
          <ul
            {...surfaceAttributes({ frame: "pane", edge: "all", radius: "card" }, "content-rows")}
          >
            {programs.map((program) => (
              <li key={program.id} className="content-row-static">
                <Text
                  size="inherit"
                  tone="inherit"
                  weight="medium"
                  truncate
                  className="content-row-name"
                >
                  {program.name}
                </Text>
                <Badge
                  size="sm"
                  tone={program.cancelled || !program.enabled ? "neutral" : "success"}
                >
                  {program.cancelled ? t("Cancelled") : program.enabled ? t("Active") : t("Paused")}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
