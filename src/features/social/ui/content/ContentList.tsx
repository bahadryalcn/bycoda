import { EmptyState } from "../../../../shared/ui/EmptyState";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { ClampText } from "../../../../shared/ui/ClampText";
import { Text } from "../../../../shared/ui/Text";
import { formatDate, t } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { Select } from "../../../../shared/ui/Select";
import type { SocialAccount, SocialCampaign, SocialJob } from "../../model/social";
import type { SocialProgram } from "../../model/socialProgram";
import { PlatformMark } from "../common/PlatformIcon";
import { ContentStateBadge, type ContentState } from "./ContentStatus";

export type ContentListStatus =
  | "all"
  | "draft"
  | "scheduled"
  | "sent"
  | "failed"
  | "cancelled"
  | "review";

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
export function campaignState(campaign: SocialCampaign, jobs: SocialJob[]): ContentState {
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
      return state === "failed";
    case "cancelled":
      return state === "cancelled";
    case "review":
      return state === "review" || state === "needs_human" || state === "delivery";
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
        <div className="content-list-filter">
          <Select
            fieldVariant="compact"
            label={t("Account")}
            hideLabel
            value={accountFilter}
            options={[
              { value: "", label: t("All accounts") },
              ...accounts.map((account) => ({
                value: account.id,
                label: account.name,
                icon: <PlatformMark platform={account.platform} size="xs" />,
              })),
            ]}
            onValueChange={onAccountFilter}
          />
        </div>
        <div className="content-list-filter">
          <Select
            fieldVariant="compact"
            label={t("Status")}
            hideLabel
            value={statusFilter}
            options={[
              { value: "all", label: t("All statuses") },
              { value: "draft", label: t("Draft") },
              { value: "scheduled", label: t("Scheduled") },
              { value: "sent", label: t("Sent") },
              { value: "failed", label: t("Failed") },
              { value: "cancelled", label: t("Cancelled") },
              { value: "review", label: t("Needs review") },
            ]}
            onValueChange={(value) => onStatusFilter(value as ContentListStatus)}
          />
        </div>
        {accountFilter || statusFilter !== "all" ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onAccountFilter("");
              onStatusFilter("all");
            }}
          >
            {t("Clear filters")}
          </Button>
        ) : null}
      </div>
      {rows.length ? (
        <ul {...surfaceAttributes({ frame: "pane", edge: "all", radius: "card" }, "content-rows")}>
          {rows.map(({ campaign, state }, index) => {
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
              <li
                key={campaign.id}
                {...surfaceAttributes(
                  index ? { frame: "pane", edge: "block-start" } : {},
                  "content-row-host",
                )}
              >
                <Button
                  variant="item"
                  layout="stacked"
                  fullWidth
                  align="start"
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
                      <Text size="caption" tone="muted" truncate>
                        {campaign.variants
                          .map(
                            (variant) =>
                              accounts.find((account) => account.id === variant.accountId)?.name,
                          )
                          .filter(Boolean)
                          .join(", ")}
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
                    <span className="content-row-meta">
                      {at ? (
                        <Text size="caption" tone="secondary" className="content-row-time">
                          {formatDate(at, {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </Text>
                      ) : null}
                      <ContentStateBadge state={state} />
                    </span>
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          size="inline"
          kind="filtered"
          className="content-platform-note"
          description={t("No posts match these filters.")}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onAccountFilter("");
                onStatusFilter("all");
              }}
            >
              {t("Clear filters")}
            </Button>
          }
        />
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
