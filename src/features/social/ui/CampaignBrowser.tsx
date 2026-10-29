import { useSocialPending } from "./useSocialPending";
import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext, SocialPanelActiveContext } from "./socialContext";
import { NativeSelect } from "../../../shared/ui/Select";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { SocialFilters } from "./SocialFilters";
import { t, useLocale } from "../../../shared/i18n";
import { useContext, useState } from "react";
import { SocialUploadImagePreview } from "./SocialUploadImagePreview";
import { type SocialCampaign, type SocialSnapshot, type SocialJob } from "../model/social";
import { JobList } from "./SocialManagement";
import { Empty, Notice, StatusBadge, names, time, type Props } from "./socialShared";

export function campaignState(
  campaign: SocialCampaign,
  jobs: SocialJob[],
  states?: SocialSnapshot["campaignStates"],
) {
  if (states?.[campaign.id]) return states[campaign.id];
  const targets = jobs.filter((job) => job.campaignId === campaign.id);
  if (targets.some((job) => job.status === "review")) return "review";
  if (targets.some((job) => job.status === "failed")) return "failed";
  if (targets.some((job) => job.status === "running")) return "running";
  if (campaign.paused) return "paused";
  if (targets.some((job) => job.status === "queued")) return "queued";
  if (targets.length && targets.every((job) => job.status === "succeeded")) return "succeeded";
  if (targets.some((job) => job.status === "succeeded")) return "partial";
  if (targets.length && targets.every((job) => job.status === "cancelled")) return "cancelled";
  return "draft";
}
/** The label shown on a campaign that was only partly delivered. */
export function campaignStateLabel(campaign: SocialCampaign, snapshot: SocialSnapshot) {
  return campaignState(campaign, snapshot.jobs, snapshot.campaignStates) === "partial"
    ? t("Partially sent")
    : undefined;
}

/** Search and status filter for the loaded campaigns. */
export function CampaignListTools({
  search,
  onSearch,
  statusFilter,
  onStatusFilter,
  count,
}: {
  search: string;
  onSearch: (value: string) => void;
  statusFilter: string;
  onStatusFilter: (value: string) => void;
  count: number;
}) {
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  return (
          <section>
            <h2 className="sr-only">
              {t("Campaigns")} <small>{count}</small>
            </h2>
            <div className="social-list-tools">
              <label>
                {t("Search campaigns")}
                <SearchInput
                  disabled={socialLocked}
                  appearance="field"
                  type="search"
                  value={search}
                  onChange={(event) => onSearch(event.target.value)}
                  placeholder={t("Campaign name")}
                />
              </label>
              <SocialFilters activeCount={statusFilter ? 1 : 0} onReset={() => onStatusFilter("")}>
                <label>
                  {t("Status")}
                  <NativeSelect
                    disabled={socialLocked}
                    value={statusFilter}
                    onChange={(event) => onStatusFilter(event.target.value)}
                  >
                    <option value="">{t("All campaigns")}</option>
                    <option value="draft">{t("Draft")}</option>
                    <option value="queued">{t("Scheduled")}</option>
                    <option value="running">{t("Sending")}</option>
                    <option value="succeeded">{t("Sent")}</option>
                    <option value="partial">{t("Partially sent")}</option>
                    <option value="failed">{t("Failed")}</option>
                    <option value="review">{t("Needs review")}</option>
                    <option value="paused">{t("Paused")}</option>
                    <option value="cancelled">{t("Cancelled")}</option>
                  </NativeSelect>
                </label>
              </SocialFilters>
            </div>
          </section>
  );
}

/** Check, approve, schedule and results for the selected campaign. Mount it keyed to reset a check. */
export function CampaignDetail({
  client,
  snapshot,
  projects,
  run,
  selected,
  onEdit,
}: Pick<Props, "client" | "snapshot" | "projects" | "run"> & {
  selected: SocialCampaign | undefined;
  onEdit: (campaign: SocialCampaign) => void;
}) {
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const active = useContext(SocialPanelActiveContext);
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  const [preview, setPreview] = useState<{
    campaign: SocialCampaign;
    targets: {
      accountId: string;
      capability: { status: string; reason: string };
      contentError?: string;
      approved: boolean;
    }[];
  } | null>(null);
  const currentPreview =
    selected &&
    preview?.campaign.id === selected.id &&
    JSON.stringify(preview.campaign) === JSON.stringify(selected)
      ? preview
      : null;
  const canApprove =
    !!currentPreview &&
    currentPreview.targets.length > 0 &&
    currentPreview.targets.every(
      (target) => target.capability.status === "available" && !target.contentError,
    );
  const approved =
    !!currentPreview?.targets.length && currentPreview.targets.every((target) => target.approved);
  const selectedJobs = snapshot.jobs.filter((job) => job.campaignId === selected?.id);
  const editBlocked = selectedJobs.some((job) =>
    ["queued", "running", "succeeded", "review"].includes(job.status),
  );
  const canSchedule =
    canApprove &&
    approved &&
    !selected?.paused &&
    snapshot.hostOnline &&
    snapshot.sendingEnabled &&
    !snapshot.stopped;
  const scheduleReason = !currentPreview
    ? t("Run the account and content check first.")
    : !canApprove
      ? t("Fix the flagged account or content issue and check again.")
      : !approved
        ? t("Read the content and give publishing approval.")
        : selected?.paused
          ? t("Resume the campaign and check again.")
          : !snapshot.hostOnline
            ? t("Connect to the host to schedule posts.")
            : !snapshot.sendingEnabled || snapshot.stopped
              ? t("Sending is off. Turn it on under Automations → Sending controls.")
              : "";
  const targetAccounts = selected
    ? selected.variants.map((variant) => {
        const account = snapshot.accounts.find((item) => item.id === variant.accountId);
        return {
          id: variant.accountId,
          label: account ? `${account.name} · ${names[account.platform]}` : t("Removed account"),
        };
      })
    : [];
  const stateLabel = (campaign: SocialCampaign) => campaignStateLabel(campaign, snapshot);
  // Existing target outcomes lead only when something was already dispatched or needs recovery;
  // for content still being prepared the preview and the next step come first.
  const leadWithResults =
    !!selected &&
    ["partial", "failed", "review", "running", "succeeded"].includes(
      campaignState(selected, snapshot.jobs, snapshot.campaignStates),
    );
  const resultsSection =
    selected && selectedJobs.length ? (
      <details className="social-campaign-results" open={leadWithResults}>
        <summary>
          {t("Post results")} · {selectedJobs.length}
        </summary>
        <JobList snapshot={snapshot} campaignId={selected.id} client={client} run={run} />
      </details>
    ) : null;
  return (
    <>
              {selected ? (
                <>
                  <header className="social-record-heading">
                    <div>
                      <h2>{selected.name}</h2>
                      <span className="social-muted">
                        {selected.projectIds
                          .map(
                            (id) =>
                              projects.find((project) => project.id === id)?.name || t("Project"),
                          )
                          .join(", ")}
                      </span>
                    </div>
                    <StatusBadge
                      status={campaignState(selected, snapshot.jobs, snapshot.campaignStates)}
                      label={stateLabel(selected)}
                    />
                  </header>
                  {leadWithResults ? resultsSection : null}
                  <div className="social-campaign-content">
                    <div className="social-campaign-previews">
                      {selected.variants.map((variant) => (
                        <article className="social-preview" key={variant.accountId}>
                          <h3>
                            {snapshot.accounts.find((account) => account.id === variant.accountId)
                              ?.name ?? t("Removed account")}
                          </h3>
                          {variant.youtube ? (
                            <p>
                              {variant.youtube.title} · {t("Visibility")}:{" "}
                              {variant.youtube.privacy === "private"
                                ? t("Private")
                                : variant.youtube.privacy === "unlisted"
                                  ? t("Unlisted")
                                  : t("Public")}{" "}
                              · {t("Made for kids")}:{" "}
                              {variant.youtube.madeForKids ? t("Yes") : t("No")} ·{" "}
                              {t("Synthetic content")}:{" "}
                              {variant.youtube.containsSyntheticMedia ? t("Yes") : t("No")}
                            </p>
                          ) : null}
                          {variant.tiktok ? (
                            <p>
                              {variant.tiktok.mediaType === "photo" ? t("Photos") : t("Video")} ·{" "}
                              {t("Visibility")}: {variant.tiktok.privacy}
                              {variant.tiktok.mediaType === "photo"
                                ? ` · ${variant.tiktok.photoTitle ?? ""} · ${t("Cover photo")}: ${(variant.tiktok.photoCoverIndex ?? 0) + 1} · ${t("Let TikTok add recommended music")}: ${variant.tiktok.autoAddMusic ? t("Yes") : t("No")}`
                                : ""}
                              {` · ${t("Contains altered or synthetic media")}: ${variant.tiktok.isAigc ? t("Yes") : t("No")}`}
                            </p>
                          ) : null}
                          {variant.snapchat ? (
                            <p>
                              {t("Snapchat destination")}:{" "}
                              {variant.snapchat.target === "story"
                                ? t("Public Story")
                                : "Spotlight"}{" "}
                              · {variant.snapchat.durationSeconds}s · {variant.snapchat.width} ×{" "}
                              {variant.snapchat.height}
                              {variant.snapchat.target === "story" ? ` · ${t("24 hours")}` : ""}
                              {variant.snapchat.locale ? ` · ${variant.snapchat.locale}` : ""}
                            </p>
                          ) : null}
                          {snapshot.accounts.some(
                            (account) =>
                              account.id === variant.accountId &&
                              account.platform === "facebook" &&
                              account.connection !== "browser",
                          ) ? (
                            <p>
                              {t("Facebook destination")}:{" "}
                              {variant.facebook
                                ? `Reel · ${variant.facebook.durationSeconds}s · ${variant.facebook.width} × ${variant.facebook.height} · ${variant.facebook.frameRate} fps`
                                : t("Page feed")}
                            </p>
                          ) : null}
                          {variant.media.length === 1 &&
                          variant.media[0].kind === "video" &&
                          snapshot.accounts.some(
                            (account) =>
                              account.id === variant.accountId &&
                              account.platform === "instagram" &&
                              account.connection !== "browser",
                          ) ? (
                            <p>{t("This video will publish as a Reel and appear in the feed.")}</p>
                          ) : null}
                          <p className="social-message">{variant.text}</p>
                          {variant.media.map((media, index) => (
                            <div key={`${index}:${media.uploadId ?? media.url ?? media.kind}`}>
                              {media.kind === "image" && media.uploadId && !media.url ? (
                                <SocialUploadImagePreview
                                  client={client}
                                  uploadId={media.uploadId}
                                  alt={media.alt}
                                  active={active}
                                />
                              ) : null}
                              {!(media.kind === "image" && media.uploadId && !media.url) ? <p className="text-ui-caption text-(--ui-text-secondary)">{t("Preview unavailable for this media. Review its exact properties before approval.")}</p> : null}
                              <p>
                                {media.kind === "document"
                                  ? t("PDF document")
                                  : media.kind === "video"
                                    ? t("Video")
                                    : t("Image")}
                                : {media.url ?? t("File uploaded to the host")}
                                {media.title ? ` · ${media.title}` : ""}
                                {media.alt ? ` · ${t("Image alt text")}: ${media.alt}` : ""}
                              </p>
                            </div>
                          ))}
                          {variant.link ? <p className="social-message">{variant.link}</p> : null}
                          <small>
                            {t("One-time post: {p0}", { p0: time(variant.scheduledAt) })}
                          </small>
                          {currentPreview?.targets
                            .filter((target) => target.accountId === variant.accountId)
                            .map((target) => (
                              <div key={target.accountId} className="social-inline-meta">
                                <StatusBadge
                                  status={target.contentError ? "failed" : target.capability.status}
                                  label={target.contentError ? t("Content issue") : undefined}
                                />
                                <StatusBadge
                                  status={target.approved ? "approved" : "draft"}
                                  label={
                                    target.approved ? t("Content approved") : t("Awaiting approval")
                                  }
                                />
                                {target.contentError || target.capability.status !== "available" ? (
                                  <Notice kind="warning">
                                    {target.contentError || target.capability.reason}
                                  </Notice>
                                ) : null}
                              </div>
                            ))}
                        </article>
                      ))}
                    </div>
                    <aside className="social-campaign-controls">
                      <section
                        className="social-workflow-steps"
                        aria-label={t("Publish approval and scheduling")}
                      >
                        <h3>{selectedJobs.length ? t("Review remaining work") : t("Review and publish")}</h3>
                        {currentPreview && canApprove ? (
                          <label className="social-check">
                            <Checkbox
                              disabled={socialLocked}
                              checked={approvalConfirmed}
                              onChange={(event) => setApprovalConfirmed(event.target.checked)}
                            />
                            {t(
                              "I have read the content for all accounts of this campaign and approve it for publishing.",
                            )}
                          </label>
                        ) : null}
                        <div className="social-inline-meta">
                          <small>{t("Publishes to")}</small>
                          {targetAccounts.map((target) => (
                            <Badge key={target.id} appearance="subtle">
                              {target.label}
                            </Badge>
                          ))}
                        </div>
                        {scheduleReason ? (
                          <Notice kind={currentPreview && !canApprove ? "warning" : "info"}>
                            {scheduleReason}
                          </Notice>
                        ) : null}
                        <div className="social-actions">
                          <Button
                            loading={pendingUi.is("campaign.validate")}
                            disabled={socialLocked}
                            type="button"
                            variant={currentPreview ? "secondary" : "primary"}
                            onClick={() =>
                              void pendingUi.run("campaign.validate", () =>
                                run(async () => {
                                  setPreview(
                                    await client.request("campaigns.preview", {
                                      id: selected.id,
                                    }),
                                  );
                                  setApprovalConfirmed(false);
                                }, t("Account and content check finished.")),
                              )
                            }
                          >
                            {t("Check account and content")}
                          </Button>

                          <Button
                            loading={pendingUi.is("campaign.approve")}
                            type="button"
                            variant={canApprove && !approved ? "primary" : "secondary"}
                            disabled={socialLocked || !canApprove || !approvalConfirmed || approved}
                            onClick={() =>
                              void pendingUi.run("campaign.approve", () =>
                                run(async () => {
                                  if (!currentPreview || !preview?.campaign)
                                    throw new Error(t("Run the account and content check first."));
                                  await client.request("campaigns.approveReviewed", {
                                    id: selected.id,
                                    expectedRevision: preview.campaign.revision,
                                  });
                                  setPreview(
                                    await client.request("campaigns.preview", { id: selected.id }),
                                  );
                                }, t("Content approved. You can schedule it once or add it to an automatic publishing plan.")),
                              )
                            }
                          >
                            {approved ? t("Content approved") : t("Give publishing approval")}
                          </Button>
                          <Button
                            loading={pendingUi.is("campaign.schedule")}
                            type="button"
                            variant={approved ? "primary" : "secondary"}
                            disabled={socialLocked || !canSchedule}
                            onClick={() =>
                              void pendingUi.run("campaign.schedule", () =>
                                run(async () => {
                                  await client.request("campaigns.schedule", {
                                    id: selected.id,
                                  });
                                }, t("One-time posts scheduled. Follow the results below or in the Operation history.")),
                              )
                            }
                          >
                            {t("Schedule posts")}
                          </Button>
                        </div>
                      </section>
                      <div className="social-actions">
                        <Button
                          loading={pendingUi.is("campaign.resume")}
                          disabled={socialLocked}
                          type="button"
                          variant="secondary"
                          onClick={() =>
                            void pendingUi.run("campaign.resume", () =>
                              run(
                                () =>
                                  client.request("campaigns.pause", {
                                    id: selected.id,
                                    paused: !snapshot.campaigns.find(
                                      (campaign) => campaign.id === selected.id,
                                    )?.paused,
                                  }),
                                selected.paused ? t("Campaign resumed.") : t("Campaign paused."),
                              ),
                            )
                          }
                        >
                          {selected.paused ? t("Resume campaign") : t("Pause campaign")}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={socialLocked || editBlocked}
                          onClick={() => onEdit(selected)}
                        >
                          {t("Edit draft")}
                        </Button>
                      </div>
                      {editBlocked ? (
                        <small className="social-muted">
                          {t(
                            "Scheduled, sent or in-review posts prevent editing this draft. Create a new campaign for new content.",
                          )}
                        </small>
                      ) : null}
                    </aside>
                  </div>

                  {leadWithResults ? null : resultsSection}
                </>
              ) : (
                <Empty title={t("Campaign preview")}>
                  {t(
                    "Select a campaign to see its content, publish time and the result for each account.",
                  )}
                </Empty>
              )}
    </>
  );
}
