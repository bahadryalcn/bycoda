import { useSocialPending } from "./useSocialPending";
import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext, SocialPanelActiveContext } from "./socialContext";
import { NativeSelect } from "../../../shared/ui/Select";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { MoreHorizontal, Pause, Pencil, Play } from "../../../shared/ui/icons";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { SocialFilters } from "./SocialFilters";
import { t, useLocale } from "../../../shared/i18n";
import { useContext, useRef, useState } from "react";
import { SocialUploadImagePreview } from "./SocialUploadImagePreview";
import {
  type CampaignVariant,
  type SocialCampaign,
  type SocialSnapshot,
  type SocialJob,
} from "../model/social";
import {
  DEFAULT_SOCIAL_POLICIES,
  effectiveSocialPolicy,
  socialCharacterCount,
  socialLimit,
} from "../model/socialPolicy";
import { JobList } from "./SocialManagement";
import { Empty, Notice, StatusBadge, names, time, type Props } from "./socialShared";
import "./social-content.css";

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

/** The character limit that applies to one account variant (policy plus platform rules). */
export function variantCharacterLimit(snapshot: SocialSnapshot, variant: CampaignVariant) {
  const account = snapshot.accounts.find((item) => item.id === variant.accountId);
  const configured = account
    ? socialLimit(
        effectiveSocialPolicy(snapshot.policies ?? DEFAULT_SOCIAL_POLICIES, account.platform),
        "content",
      )
    : undefined;
  if (
    account?.platform === "facebook" &&
    account.connection !== "browser" &&
    variant.facebook?.target === "reel"
  )
    return Math.min(configured ?? Infinity, 2200);
  return account?.platform === "telegram" &&
    account.accountType === "channel" &&
    account.connection === "token"
    ? Math.min(configured ?? Infinity, variant.media.length ? 1024 : 4096)
    : configured;
}
/** The platform's character count for one account variant (text plus link). */
export function variantCharacterCount(snapshot: SocialSnapshot, variant: CampaignVariant) {
  const content = [variant.text, variant.link].filter(Boolean).join("\n");
  const account = snapshot.accounts.find((item) => item.id === variant.accountId);
  if (
    account?.platform === "facebook" &&
    account.connection !== "browser" &&
    variant.facebook?.target === "reel"
  )
    return content.length;
  return account?.platform === "telegram" &&
    account.accountType === "channel" &&
    account.connection === "token"
    ? content.length
    : socialCharacterCount(content);
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
    <section className="social-content-tools">
      <h2 className="sr-only">
        {t("Campaigns")} <small>{count}</small>
      </h2>
      <div className="social-list-tools">
        <SearchInput
          className="social-list-search"
          aria-label={t("Search campaigns")}
          disabled={socialLocked}
          appearance="field"
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={t("Campaign name")}
        />
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

type NextStep = {
  id: "check" | "fix" | "approve" | "schedule" | "resume" | "wait" | "done";
  label: string;
};

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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
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
  const accountName = (accountId: string) =>
    snapshot.accounts.find((account) => account.id === accountId)?.name ?? t("Removed account");
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
  const state = selected ? campaignState(selected, snapshot.jobs, snapshot.campaignStates) : "draft";
  // Existing target outcomes lead only when something was already dispatched or needs recovery;
  // for content still being prepared the preview and the next step come first.
  const leadWithResults =
    !!selected && ["partial", "failed", "review", "running", "succeeded"].includes(state);
  const issueCount = currentPreview
    ? currentPreview.targets.filter(
        (target) => target.contentError || target.capability.status !== "available",
      ).length
    : 0;
  // Exactly one next step, in the order: check, fix, approve, schedule.
  const next: NextStep =
    state === "succeeded"
      ? { id: "done", label: t("Nothing to do - sent") }
      : state === "running"
        ? { id: "done", label: t("Sending now - nothing to do") }
        : !currentPreview
          ? { id: "check", label: t("Check the account and content") }
          : !canApprove
            ? issueCount > 0
              ? {
                  id: "fix",
                  label:
                    issueCount === 1 ? t("Fix 1 issue") : t("Fix {p0} issues", { p0: issueCount }),
                }
              : { id: "check", label: t("Check again") }
            : !approved
              ? { id: "approve", label: t("Approve this revision") }
              : selected?.paused
                ? { id: "resume", label: t("Resume the campaign") }
                : canSchedule
                  ? { id: "schedule", label: t("Schedule posts") }
                  : { id: "wait", label: t("Waiting to schedule") };
  const togglePause = () => {
    if (!selected) return;
    void pendingUi.run("campaign.resume", () =>
      run(
        () =>
          client.request("campaigns.pause", {
            id: selected.id,
            paused: !snapshot.campaigns.find((campaign) => campaign.id === selected.id)?.paused,
          }),
        selected.paused ? t("Campaign resumed.") : t("Campaign paused."),
      ),
    );
  };
  const resultsSection =
    selected && selectedJobs.length ? (
      <details className="social-campaign-results" open={leadWithResults}>
        <summary>
          {t("Post results")} · {selectedJobs.length}
        </summary>
        <JobList snapshot={snapshot} campaignId={selected.id} client={client} run={run} />
      </details>
    ) : null;
  if (!selected)
    return (
      <Empty>
        {t("Select a campaign to see its content, publish time and the result for each account.")}
      </Empty>
    );
  return (
    <div className="social-content-detail">
      <header className="social-record-heading social-content-record">
        <div>
          <h2>{selected.name}</h2>
          <span className="social-muted">
            {selected.projectIds
              .map((id) => projects.find((project) => project.id === id)?.name || t("Project"))
              .join(", ")}
          </span>
        </div>
        <StatusBadge status={state} label={stateLabel(selected)} />
        <div className="social-content-record-actions">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            startIcon={<Pencil className="icon-sm" aria-hidden="true" />}
            disabled={socialLocked || editBlocked}
            onClick={() => onEdit(selected)}
          >
            {t("Edit draft")}
          </Button>
          <Button
            ref={menuButton}
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            label={t("Campaign actions")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            loading={pendingUi.is("campaign.resume")}
            disabled={socialLocked}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreHorizontal className="icon-sm" aria-hidden="true" />
          </Button>
          {menuOpen ? (
            <DropdownMenu
              anchor={menuButton}
              label={t("Campaign actions")}
              returnFocusRef={menuButton}
              onClose={() => setMenuOpen(false)}
              items={[
                {
                  kind: "item",
                  id: "pause",
                  label: selected.paused ? t("Resume campaign") : t("Pause campaign"),
                  icon: selected.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />,
                },
              ]}
              onPick={() => {
                setMenuOpen(false);
                togglePause();
              }}
            />
          ) : null}
        </div>
      </header>
      {editBlocked ? (
        <small className="social-muted">
          {t(
            "Scheduled, sent or in-review posts prevent editing this draft. Create a new campaign for new content.",
          )}
        </small>
      ) : null}
      {leadWithResults ? resultsSection : null}
      <section className="social-content-block" aria-label={t("Content preview")}>
        <h3>{t("Content preview")}</h3>
        <div className="social-campaign-previews">
          {selected.variants.map((variant) => {
            const account = snapshot.accounts.find((item) => item.id === variant.accountId);
            const limit = variantCharacterLimit(snapshot, variant);
            const count = variantCharacterCount(snapshot, variant);
            return (
              <article className="social-preview social-content-post" key={variant.accountId}>
                <header className="social-content-post-head">
                  <h4>{accountName(variant.accountId)}</h4>
                  {account ? <Badge appearance="subtle">{names[account.platform]}</Badge> : null}
                  <span
                    className="social-content-count"
                    data-over={limit !== undefined && count > limit}
                    title={
                      limit !== undefined
                        ? t("{p0} / {p1} characters · link included", { p0: count, p1: limit })
                        : t("{p0} characters · link included", { p0: count })
                    }
                  >
                    {limit !== undefined ? `${count} / ${limit}` : count}
                  </span>
                </header>
                {variant.text ? (
                  <p className="social-message">{variant.text}</p>
                ) : (
                  <p className="social-muted">{t("No caption. This post is media only.")}</p>
                )}
                {variant.link ? <p className="social-message">{variant.link}</p> : null}
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
                    {!(media.kind === "image" && media.uploadId && !media.url) ? (
                      <p className="text-ui-caption text-(--ui-text-secondary)">
                        {t("Preview unavailable for this media. Review its exact properties before approval.")}
                      </p>
                    ) : null}
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
                {variant.youtube ? (
                  <p className="social-content-meta">
                    {variant.youtube.title} · {t("Visibility")}:{" "}
                    {variant.youtube.privacy === "private"
                      ? t("Private")
                      : variant.youtube.privacy === "unlisted"
                        ? t("Unlisted")
                        : t("Public")}{" "}
                    · {t("Made for kids")}: {variant.youtube.madeForKids ? t("Yes") : t("No")} ·{" "}
                    {t("Synthetic content")}:{" "}
                    {variant.youtube.containsSyntheticMedia ? t("Yes") : t("No")}
                  </p>
                ) : null}
                {variant.tiktok ? (
                  <p className="social-content-meta">
                    {variant.tiktok.mediaType === "photo" ? t("Photos") : t("Video")} ·{" "}
                    {t("Visibility")}: {variant.tiktok.privacy}
                    {variant.tiktok.mediaType === "photo"
                      ? ` · ${variant.tiktok.photoTitle ?? ""} · ${t("Cover photo")}: ${(variant.tiktok.photoCoverIndex ?? 0) + 1} · ${t("Let TikTok add recommended music")}: ${variant.tiktok.autoAddMusic ? t("Yes") : t("No")}`
                      : ""}
                    {` · ${t("Contains altered or synthetic media")}: ${variant.tiktok.isAigc ? t("Yes") : t("No")}`}
                  </p>
                ) : null}
                {variant.snapchat ? (
                  <p className="social-content-meta">
                    {t("Snapchat destination")}:{" "}
                    {variant.snapchat.target === "story" ? t("Public Story") : "Spotlight"} ·{" "}
                    {variant.snapchat.durationSeconds}s · {variant.snapchat.width} ×{" "}
                    {variant.snapchat.height}
                    {variant.snapchat.target === "story" ? ` · ${t("24 hours")}` : ""}
                    {variant.snapchat.locale ? ` · ${variant.snapchat.locale}` : ""}
                  </p>
                ) : null}
                {account?.platform === "facebook" && account.connection !== "browser" ? (
                  <p className="social-content-meta">
                    {t("Facebook destination")}:{" "}
                    {variant.facebook
                      ? `Reel · ${variant.facebook.durationSeconds}s · ${variant.facebook.width} × ${variant.facebook.height} · ${variant.facebook.frameRate} fps`
                      : t("Page feed")}
                  </p>
                ) : null}
                {variant.media.length === 1 &&
                variant.media[0].kind === "video" &&
                account?.platform === "instagram" &&
                account.connection !== "browser" ? (
                  <p className="social-content-meta">
                    {t("This video will publish as a Reel and appear in the feed.")}
                  </p>
                ) : null}
                <small className="social-muted">
                  {t("One-time post: {p0}", { p0: time(variant.scheduledAt) })}
                </small>
              </article>
            );
          })}
        </div>
      </section>
      <section className="social-content-block" aria-label={t("Check result")}>
        <h3>
          {t("Check result")}
          {currentPreview ? (
            <StatusBadge
              status={issueCount ? "failed" : "available"}
              label={
                issueCount === 0
                  ? t("No issues found")
                  : issueCount === 1
                    ? t("1 issue found")
                    : t("{p0} issues found", { p0: issueCount })
              }
            />
          ) : (
            <StatusBadge status="draft" label={t("Not checked yet")} />
          )}
        </h3>
        {currentPreview ? (
          <ul className="social-content-checks">
            {currentPreview.targets.map((target) => (
              <li key={target.accountId}>
                <span className="social-content-check-account">{accountName(target.accountId)}</span>
                <StatusBadge
                  status={target.contentError ? "failed" : target.capability.status}
                  label={target.contentError ? t("Content issue") : undefined}
                />
                {target.contentError || target.capability.status !== "available" ? (
                  <Notice kind="warning">{target.contentError || target.capability.reason}</Notice>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="social-muted">
            {t("The check confirms each account can publish this exact content.")}
          </p>
        )}
      </section>
      <section className="social-content-block" aria-label={t("Approval")}>
        <h3>
          {t("Approval")}
          <StatusBadge
            status={approved ? "approved" : "draft"}
            label={
              approved
                ? t("Content approved")
                : currentPreview
                  ? t("Awaiting approval")
                  : t("Check first")
            }
          />
        </h3>
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
      </section>
      <section
        className="social-content-block social-content-next"
        aria-label={t("Next step")}
        data-next={next.id}
      >
        <p className="social-content-next-label">
          <span className="social-muted">{t("Next step")}</span>
          <strong>{next.label}</strong>
        </p>
        {scheduleReason && ["fix", "wait", "resume"].includes(next.id) ? (
          <Notice kind={currentPreview && !canApprove ? "warning" : "info"}>{scheduleReason}</Notice>
        ) : null}
        <div className="social-actions">
          {next.id === "fix" ? (
            <Button
              type="button"
              variant="primary"
              disabled={socialLocked || editBlocked}
              onClick={() => onEdit(selected)}
            >
              {next.label}
            </Button>
          ) : null}
          <Button
            loading={pendingUi.is("campaign.validate")}
            disabled={socialLocked}
            type="button"
            variant={next.id === "check" ? "primary" : "secondary"}
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
            variant={next.id === "approve" ? "primary" : "secondary"}
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
                  setPreview(await client.request("campaigns.preview", { id: selected.id }));
                }, t("Content approved. You can schedule it once or add it to an automatic publishing plan.")),
              )
            }
          >
            {approved ? t("Content approved") : t("Give publishing approval")}
          </Button>
          <Button
            loading={pendingUi.is("campaign.schedule")}
            type="button"
            variant={next.id === "schedule" ? "primary" : "secondary"}
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
          {next.id === "resume" ? (
            <Button
              loading={pendingUi.is("campaign.resume")}
              disabled={socialLocked}
              type="button"
              variant="primary"
              onClick={togglePause}
            >
              {t("Resume campaign")}
            </Button>
          ) : null}
        </div>
      </section>
      {leadWithResults ? null : resultsSection}
    </div>
  );
}
