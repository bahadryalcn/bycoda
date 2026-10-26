import { useSocialPending } from "./useSocialPending";
import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TextField } from "../../../shared/ui/TextField";
import { NativeSelect } from "../../../shared/ui/Select";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { SocialFilters } from "./SocialFilters";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { useContext, useState } from "react";
import { SocialPanelActiveContext } from "./socialContext";
import { useSocialWorkspaceFilter } from "./useSocialWorkspaceFilter";
import { SocialPrograms } from "./SocialPrograms";
import { TikTokPublishingFields } from "./TikTokPublishingFields";
import { XMediaFields } from "./XMediaFields";
import { MetaPublishingFields } from "./MetaPublishingFields";
import { FacebookReelFields, validFacebookReel } from "./FacebookReelFields";
import { SocialUploadImagePreview } from "./SocialUploadImagePreview";
import { useQueryClient } from "@tanstack/react-query";
import { socialQueryScope } from "../model/socialQuery";
import type {
  CampaignVariant,
  SocialCampaign,
  SocialSnapshot,
  SocialPolicy,
  SocialProjectProfile,
  SocialJob,
} from "../model/social";
import type { HostProject } from "../../connections/model/protocol";
import type { SocialClient } from "../model/socialClient";
import {
  DEFAULT_SOCIAL_POLICIES,
  effectiveSocialPolicy,
  socialCharacterCount,
  socialLimit,
} from "../model/socialPolicy";
import { JobList } from "./SocialManagement";
import { SocialMultiSelect } from "./SocialMultiSelect";
import {
  Empty,
  Composer,
  closeComposer,
  Projects,
  Notice,
  StatusBadge,
  field,
  names,
  time,
  youtubeDefaults,
  type Props,
  type Run,
} from "./socialShared";
function dateInput(value: number) {
  if (!Number.isFinite(value)) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(value - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function campaignState(
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
export function Campaigns({
  client,
  snapshot,
  projects,
  initialProject,
  run,
  onFilterChange,
}: Props) {
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const queryClient = useQueryClient();
  const [view, setView] = useState<"manual" | "ai">("manual");
  const active = useContext(SocialPanelActiveContext);
  const [selectedProjects, setSelectedProjects] = useState<string[]>(
    initialProject ? [initialProject] : [],
  );
  const [variants, setVariants] = useState<CampaignVariant[]>([]);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [editingRevision, setEditingRevision] = useState<number>();
  const [editVersion, setEditVersion] = useState(0);
  const [selectedId, setSelectedId] = useState(snapshot.campaigns[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const hostFiltered = useSocialWorkspaceFilter(
    snapshot,
    "campaigns",
    {
      query: search,
      status: statusFilter,
    },
    onFilterChange,
  );
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  const selected = snapshot.campaigns.find((item) => item.id === selectedId);
  const visibleCampaigns = snapshot.campaigns.filter(
    (campaign) =>
      hostFiltered ||
      (campaign.name
        .toLocaleLowerCase(getLocale())
        .includes(search.toLocaleLowerCase(getLocale())) &&
        (!statusFilter ||
          campaignState(campaign, snapshot.jobs, snapshot.campaignStates) === statusFilter)),
  );
  const showCampaignPreview = snapshot.campaigns.length > 0 || Boolean(search || statusFilter);
  const publicFacts = snapshot.profiles
    .filter((profile) => selectedProjects.includes(profile.projectId))
    .flatMap((profile) => profile.facts);
  const validProjects =
    selectedProjects.length > 0 &&
    selectedProjects.every((id) => projects.some((project) => project.id === id));
  const hasDraftAccess = (accountId: string) =>
    selectedProjects.every((id) =>
      snapshot.accounts.find((account) => account.id === accountId)?.grants[id]?.includes("draft"),
    );
  const accountFor = (variant: CampaignVariant) =>
    snapshot.accounts.find((account) => account.id === variant.accountId);
  const apiLinkedInUpload = (variant: CampaignVariant) => {
    const account = accountFor(variant);
    return (
      account?.platform === "linkedin" &&
      account.accountType === "organization" &&
      account.connection !== "browser" &&
      snapshot.capabilities[account.id]?.some(
        (item) => item.operation === "media" && item.status === "available",
      )
    );
  };
  const apiSnapchatUpload = (variant: CampaignVariant) => {
    const account = accountFor(variant);
    return (
      account?.platform === "snapchat" &&
      account.connection !== "browser" &&
      account.accountType === "public_profile" &&
      account.connected &&
      snapshot.capabilities[account.id]?.some(
        (item) => item.operation === "media" && item.status === "available",
      )
    );
  };
  const apiTelegramChannelUpload = (variant: CampaignVariant) => {
    const account = accountFor(variant);
    return (
      account?.platform === "telegram" &&
      account.accountType === "channel" &&
      account.connection === "token" &&
      account.connected &&
      snapshot.capabilities[account.id]?.some(
        (item) => item.operation === "media" && item.status === "available",
      )
    );
  };
  const browserUpload = (variant: CampaignVariant) => {
    const account = accountFor(variant);
    const capabilities = snapshot.capabilities[variant.accountId] ?? [];
    return (
      account?.connection === "browser" &&
      account.connected &&
      !["youtube", "tiktok"].includes(account.platform) &&
      capabilities.some((item) => item.operation === "media" && item.status === "available") &&
      capabilities.some((item) => item.operation === "publish" && item.status === "available")
    );
  };
  const variantLimit = (variant: CampaignVariant) => {
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
  };
  const variantCount = (variant: CampaignVariant) => {
    const content = [variant.text, variant.link].filter(Boolean).join("\n");
    const account = accountFor(variant);
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
  };
  const invalidVariants = variants.some((variant) => {
    const limit = variantLimit(variant);
    return (
      !snapshot.accounts.some((account) => account.id === variant.accountId) ||
      !hasDraftAccess(variant.accountId) ||
      (accountFor(variant)?.platform === "facebook" &&
        accountFor(variant)?.connection !== "browser" &&
        !validFacebookReel(variant)) ||
      (!variant.text.trim() &&
        !(apiTelegramChannelUpload(variant) && variant.media.length) &&
        !(
          accountFor(variant)?.platform === "facebook" &&
          accountFor(variant)?.connection !== "browser" &&
          variant.facebook?.target === "reel" &&
          variant.media.length === 1 &&
          variant.media[0].kind === "video"
        ) &&
        !(accountFor(variant)?.platform === "snapchat" && variant.snapchat?.target === "story")) ||
      !Number.isFinite(variant.scheduledAt) ||
      (limit !== undefined && variantCount(variant) > limit) ||
      variant.factIds.some((id) => !publicFacts.some((fact) => fact.id === id))
    );
  });
  const [videoProgress, setVideoProgress] = useState<Record<string, number>>({});
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
  const update = (id: string, change: Partial<CampaignVariant>) =>
    setVariants((current) =>
      current.map((item) => (item.accountId === id ? { ...item, ...change } : item)),
    );
  const stateLabel = (campaign: SocialCampaign) =>
    campaignState(campaign, snapshot.jobs, snapshot.campaignStates) === "partial"
      ? t("Partially sent")
      : undefined;
  return (
    <div className="social-page social-campaign-page">
      {snapshot.programsSupported ? (
        <nav className="social-campaign-modes" aria-label={t("Campaigns")}>
          <SegmentedControl
            label={t("Campaigns")}
            selectionRole="pressed"
            value={view}
            onValueChange={(next) => setView(next === "ai" ? "ai" : "manual")}
            options={[
              { value: "ai", label: t("AI campaigns") },
              { value: "manual", label: t("Campaigns") },
            ]}
          />
        </nav>
      ) : null}
      <div hidden={view !== "ai"}>
        <SocialPanelActiveContext.Provider value={active && view === "ai"}>
          <SocialPrograms {...{ client, snapshot, projects, initialProject, run }} />
        </SocialPanelActiveContext.Provider>
      </div>
      <div className="social-campaign-manual" hidden={view !== "manual"}>
        <div className="social-stats" aria-label={t("Campaign summary")}>
          <span>
            <strong>{snapshot.pages?.campaigns?.total ?? snapshot.campaigns.length}</strong>{" "}
            {t("campaigns")}
          </span>
          <span>
            <strong>
              {snapshot.campaignJobCounts?.queued ??
                snapshot.jobs.filter((job) => job.campaignId && job.status === "queued").length}
            </strong>{" "}
            {t("scheduled posts")}
          </span>
          <span>
            <strong>
              {snapshot.campaignJobCounts?.succeeded ??
                snapshot.jobs.filter((job) => job.campaignId && job.status === "succeeded").length}
            </strong>{" "}
            {t("sent posts")}
          </span>
          <span>
            <strong>
              {snapshot.campaignJobCounts
                ? (snapshot.campaignJobCounts.review ?? 0) +
                  (snapshot.campaignJobCounts.failed ?? 0)
                : snapshot.jobs.filter(
                    (job) => job.campaignId && ["review", "failed"].includes(job.status),
                  ).length}
            </strong>{" "}
            {t("need your attention")}
          </span>
        </div>
        <Composer
          title={editingId ? t("Edit campaign draft") : t("New campaign")}
          onOpen={() => {
            void queryClient.invalidateQueries({
              queryKey: [...socialQueryScope(client), "tiktok-creator"],
            });
          }}
          editing={editVersion}
          description={t(
            "Save the content, check it and approve it for publishing. Saving does not start sending.",
          )}
        >
          <form
            className="social-form"
            onSubmit={(event) => {
              const form = event.currentTarget;
              field(event);
              let saved: SocialCampaign | undefined;
              void (async () => {
                if (
                  !(await pendingUi.run("campaigns.save-campaign-draft", () =>
                    run(async () => {
                      if (
                        !name.trim() ||
                        !validProjects ||
                        !variants.length ||
                        invalidVariants ||
                        Object.keys(videoProgress).length > 0
                      )
                        throw new Error(
                          t("Check the project, account access, content limits and publish times."),
                        );
                      await Promise.all(
                        variants.map(async (variant) => {
                          const { effective } = await client.request<{
                            effective: SocialPolicy;
                          }>("policy.get", { accountId: variant.accountId });
                          const policyLimit = socialLimit(effective, "content");
                          const account = accountFor(variant);
                          const limit =
                            account?.platform === "facebook" &&
                            account.connection !== "browser" &&
                            variant.facebook?.target === "reel"
                              ? Math.min(policyLimit ?? Infinity, 2200)
                              : account?.platform === "telegram" &&
                                  account.accountType === "channel" &&
                                  account.connection === "token"
                                ? Math.min(
                                    policyLimit ?? Infinity,
                                    variant.media.length ? 1024 : 4096,
                                  )
                                : policyLimit;
                          if (limit !== undefined && variantCount(variant) > limit)
                            throw new Error(
                              t("Content for this account can be at most {p0} characters.", {
                                p0: limit,
                              }),
                            );
                        }),
                      );
                      saved = await client.request<SocialCampaign>("campaigns.create", {
                        ...(editingId ? { id: editingId, expectedRevision: editingRevision } : {}),
                        name,
                        projectIds: selectedProjects,
                        variants,
                      });
                    }, t("Campaign draft saved. Review the preview and approve it for publishing.")),
                  )) ||
                  !saved
                )
                  return;
                setSelectedId(saved.id);
                setPreview(null);
                setApprovalConfirmed(false);
                setName("");
                setVariants([]);
                setEditingId(undefined);
                closeComposer(form);
              })();
            }}
          >
            <TextField
              disabled={socialLocked}
              label={t("Campaign name")}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={200}
            />
            <Projects
              projects={projects}
              selected={selectedProjects}
              onChange={setSelectedProjects}
            />
            {!validProjects ? (
              <Notice kind="info">{t("Select at least one project.")}</Notice>
            ) : null}
            <SocialMultiSelect
              label={t("Social accounts")}
              placeholder={t("Select an account")}
              searchPlaceholder={t("Search by account or platform")}
              options={snapshot.accounts.map((account) => ({
                value: account.id,
                label: account.name,
                description: `${names[account.platform]}${hasDraftAccess(account.id) ? "" : ` · ${t("Draft access to the selected projects is required")}`}`,
                disabled: !hasDraftAccess(account.id),
              }))}
              selected={variants.map((variant) => variant.accountId)}
              onChange={(ids) =>
                setVariants((current) =>
                  ids.map(
                    (id) =>
                      current.find((variant) => variant.accountId === id) ?? {
                        accountId: id,
                        text: "",
                        media: [],
                        factIds: [],
                        scheduledAt: Date.now(),
                        ...(snapshot.accounts.find((account) => account.id === id)?.platform ===
                        "youtube"
                          ? { youtube: { ...youtubeDefaults } }
                          : {}),
                      },
                  ),
                )
              }
            />
            {!snapshot.accounts.length ? (
              <Notice kind="info">
                {t("Connect an account in the Accounts section to prepare content.")}
              </Notice>
            ) : null}
            {variants.map((variant) => (
              <fieldset key={variant.accountId} className="social-variant">
                <legend>
                  {snapshot.accounts.find((account) => account.id === variant.accountId)?.name}
                </legend>
                {snapshot.accounts.find((account) => account.id === variant.accountId)?.platform ===
                "youtube" ? (
                  <>
                    <TextField
                      disabled={socialLocked}
                      label={t("Video title")}
                      required
                      maxLength={100}
                      value={variant.youtube?.title ?? ""}
                      onChange={(event) =>
                        update(variant.accountId, {
                          youtube: {
                            ...youtubeDefaults,
                            ...variant.youtube,
                            title: event.target.value,
                          },
                        })
                      }
                    />
                    <label>
                      {t("Video visibility")}
                      <NativeSelect
                        disabled={socialLocked}
                        value={variant.youtube?.privacy ?? "private"}
                        onChange={(event) =>
                          update(variant.accountId, {
                            youtube: {
                              ...youtubeDefaults,
                              ...variant.youtube,
                              privacy: event.target.value as "private" | "unlisted" | "public",
                            },
                          })
                        }
                      >
                        <option value="private">{t("Private")}</option>
                        <option value="unlisted">{t("Unlisted")}</option>
                        <option value="public">{t("Public")}</option>
                      </NativeSelect>
                    </label>
                    <fieldset className="social-checks">
                      <legend>{t("Content declaration")}</legend>
                      <label>
                        <Checkbox
                          disabled={socialLocked}
                          checked={variant.youtube?.madeForKids ?? false}
                          onChange={(event) =>
                            update(variant.accountId, {
                              youtube: {
                                ...youtubeDefaults,
                                ...variant.youtube,
                                madeForKids: event.target.checked,
                              },
                            })
                          }
                        />
                        {t("Content made for kids")}
                      </label>
                      <label>
                        <Checkbox
                          disabled={socialLocked}
                          checked={variant.youtube?.containsSyntheticMedia ?? false}
                          onChange={(event) =>
                            update(variant.accountId, {
                              youtube: {
                                ...youtubeDefaults,
                                ...variant.youtube,
                                containsSyntheticMedia: event.target.checked,
                              },
                            })
                          }
                        />
                        {t("Contains realistic altered or synthetic content")}
                      </label>
                    </fieldset>
                    <div>
                      <TextField
                        disabled={socialLocked}
                        label={t("Upload the video to the host · MP4/WebM, up to 64 MiB")}
                        type="file"
                        accept="video/mp4,video/webm"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file)
                            void run(async () => {
                              setVideoProgress((current) => ({
                                ...current,
                                [variant.accountId]: 0,
                              }));
                              try {
                                const upload = await client.uploadVideo(file, (percent) =>
                                  setVideoProgress((current) => ({
                                    ...current,
                                    [variant.accountId]: percent,
                                  })),
                                );
                                update(variant.accountId, {
                                  media: [
                                    {
                                      kind: "video",
                                      uploadId: upload.uploadId,
                                    },
                                  ],
                                });
                              } finally {
                                setVideoProgress((current) => {
                                  const next = { ...current };
                                  delete next[variant.accountId];
                                  return next;
                                });
                              }
                            });
                        }}
                      />
                      {variant.media[0]?.uploadId ? (
                        <small>{t("Video uploaded to the host")}</small>
                      ) : null}
                      {videoProgress[variant.accountId] !== undefined ? (
                        <span role="status">
                          {t("Uploading to host: {p0}%", { p0: videoProgress[variant.accountId] })}
                        </span>
                      ) : null}
                    </div>
                    <p className="social-muted">
                      {t(
                        "These fields are for the video description and channel post. Community posts and direct messages are not supported. An accepted upload does not mean the video has been processed and is watchable; check the resulting visibility.",
                      )}
                    </p>
                  </>
                ) : null}
                <div>
                  <TextareaField
                    disabled={socialLocked}
                    label={t("Content for this account")}
                    value={variant.text}
                    required={
                      !(
                        (accountFor(variant)?.platform === "snapchat" &&
                          variant.snapchat?.target === "story") ||
                        (apiTelegramChannelUpload(variant) && variant.media.length > 0) ||
                        (accountFor(variant)?.platform === "facebook" &&
                          accountFor(variant)?.connection !== "browser" &&
                          variant.facebook?.target === "reel" &&
                          variant.media.length === 1 &&
                          variant.media[0].kind === "video")
                      )
                    }
                    rows={4}
                    onChange={(event) => update(variant.accountId, { text: event.target.value })}
                  />
                  {accountFor(variant)?.platform === "snapchat" &&
                  variant.snapchat?.target === "story" ? (
                    <small>
                      {t(
                        "Public Story uploads have no caption or link and last 24 hours. Clear the content and link before approval.",
                      )}
                    </small>
                  ) : null}
                  <small role="status">
                    {variantLimit(variant) !== undefined
                      ? t("{p0} / {p1} characters · link included", {
                          p0: variantCount(variant),
                          p1: variantLimit(variant),
                        })
                      : t("{p0} characters · link included", { p0: variantCount(variant) })}
                  </small>
                  {variantLimit(variant) !== undefined &&
                  variantCount(variant) > variantLimit(variant)! ? (
                    <Notice kind="error">
                      {t("The content exceeds the limit. Shorten it before saving.")}
                    </Notice>
                  ) : null}
                </div>
                {snapshot.accounts.find((account) => account.id === variant.accountId)?.platform ===
                "tiktok" ? (
                  <TikTokPublishingFields
                    variant={variant}
                    client={client}
                    connection={accountFor(variant)?.connection}
                    onBusyChange={(busy) =>
                      setVideoProgress((current) => {
                        const next = { ...current };
                        if (busy) next[variant.accountId] = 0;
                        else delete next[variant.accountId];
                        return next;
                      })
                    }
                    onChange={(patch) => update(variant.accountId, patch)}
                  />
                ) : null}
                {accountFor(variant)?.platform === "facebook" &&
                accountFor(variant)?.connection !== "browser" ? (
                  <FacebookReelFields
                    variant={variant}
                    client={client}
                    disabled={socialLocked}
                    onChange={(patch) => update(variant.accountId, patch)}
                    onBusyChange={(busy) =>
                      setVideoProgress((current) => {
                        const next = { ...current };
                        if (busy) next[variant.accountId] = 0;
                        else delete next[variant.accountId];
                        return next;
                      })
                    }
                  />
                ) : null}
                <details className="social-settings">
                  <summary>{t("One-time publish time, media and link")}</summary>
                  <TextField
                    disabled={socialLocked}
                    label={t("Link")}
                    type="url"
                    placeholder="https://"
                    value={variant.link ?? ""}
                    onChange={(event) =>
                      update(variant.accountId, {
                        link: event.target.value || undefined,
                      })
                    }
                  />
                  <TextField
                    disabled={socialLocked}
                    label={t("One-time schedule time · this computer's time zone")}
                    type="datetime-local"
                    required
                    value={dateInput(variant.scheduledAt)}
                    onChange={(event) =>
                      update(variant.accountId, {
                        scheduledAt: new Date(event.target.value).getTime(),
                      })
                    }
                  />
                  {accountFor(variant)?.connection !== "browser" &&
                  !snapshot.accounts.some(
                    (account) =>
                      account.id === variant.accountId &&
                      [
                        "youtube",
                        "tiktok",
                        "instagram",
                        "facebook",
                        "linkedin",
                        "snapchat",
                      ].includes(account.platform),
                  ) ? (
                    <TextField
                      disabled={socialLocked}
                      label={t("HTTPS image URL")}
                      type="url"
                      placeholder="https://"
                      value={variant.media[0]?.url ?? ""}
                      onChange={(event) =>
                        update(variant.accountId, {
                          media: event.target.value
                            ? [{ kind: "image", url: event.target.value }]
                            : [],
                        })
                      }
                    />
                  ) : null}
                  {accountFor(variant)?.connection !== "browser" &&
                  ["instagram", "facebook"].includes(accountFor(variant)?.platform ?? "") &&
                  !variant.facebook ? (
                    <MetaPublishingFields
                      platform={accountFor(variant)!.platform as "instagram" | "facebook"}
                      value={variant.media}
                      onChange={(media) => update(variant.accountId, { media })}
                      disabled={socialLocked}
                    />
                  ) : null}
                  {apiSnapchatUpload(variant) ? (
                    <TextField
                      disabled={socialLocked}
                      label={t("Spotlight locale")}
                      placeholder="tr_TR"
                      required
                      pattern="[a-z]{2}_[A-Z]{2}"
                      value={variant.snapchat?.locale ?? ""}
                      onChange={(event) =>
                        update(variant.accountId, {
                          snapchat: {
                            durationSeconds: 0,
                            width: 0,
                            height: 0,
                            ...variant.snapchat,
                            target: "spotlight",
                            locale: event.target.value,
                          },
                        })
                      }
                    />
                  ) : null}
                  {accountFor(variant)?.platform === "x" ||
                  browserUpload(variant) ||
                  apiLinkedInUpload(variant) ||
                  apiTelegramChannelUpload(variant) ||
                  apiSnapchatUpload(variant) ? (
                    <>
                      {accountFor(variant)?.platform === "snapchat" &&
                      !apiSnapchatUpload(variant) ? (
                        <fieldset disabled={socialLocked}>
                          <legend>{t("Snapchat destination")}</legend>
                          <SegmentedControl
                            aria-label={t("Snapchat destination")}
                            value={variant.snapchat?.target ?? ""}
                            options={[
                              { value: "spotlight", label: "Spotlight" },
                              { value: "story", label: t("Public Story") },
                            ]}
                            onValueChange={(target) =>
                              update(variant.accountId, {
                                snapchat: {
                                  durationSeconds: 0,
                                  width: 0,
                                  height: 0,
                                  ...variant.snapchat,
                                  target: target as "spotlight" | "story",
                                },
                              })
                            }
                          />
                          <small>
                            {t(
                              "Choose one destination. Use a 5–60 second MP4 of at least 540 × 960 pixels.",
                            )}
                          </small>
                        </fieldset>
                      ) : null}
                      <XMediaFields
                        value={variant.media}
                        client={client}
                        label={
                          accountFor(variant)?.platform === "x"
                            ? undefined
                            : t("{p0} attachments", { p0: names[accountFor(variant)!.platform] })
                        }
                        help={
                          accountFor(variant)?.platform === "x" || apiLinkedInUpload(variant)
                            ? undefined
                            : apiTelegramChannelUpload(variant)
                              ? t(
                                  "Publish text or one JPEG/PNG up to 5 MiB or MP4 up to 50 MiB to the connected channel. Media captions can contain up to 1024 UTF-16 units.",
                                )
                              : apiSnapchatUpload(variant)
                                ? t(
                                    "Choose a locale and upload a 6–60 second MP4 of at least 540 × 960 pixels. API publishing targets Spotlight.",
                                  )
                                : t(
                                    "Files are uploaded to the selected host and attached through the browser.",
                                  )
                        }
                        maxCount={
                          accountFor(variant)?.platform === "snapchat" ||
                          apiTelegramChannelUpload(variant)
                            ? 1
                            : undefined
                        }
                        maxVideoMiB={apiTelegramChannelUpload(variant) ? 50 : undefined}
                        videoOnly={accountFor(variant)?.platform === "snapchat"}
                        imagesOnly={!!apiLinkedInUpload(variant)}
                        disabled={
                          accountFor(variant)?.platform === "snapchat" &&
                          (!variant.snapchat?.target ||
                            (apiSnapchatUpload(variant) &&
                              !/^[a-z]{2}_[A-Z]{2}$/.test(variant.snapchat?.locale ?? "")))
                        }
                        showPreview={accountFor(variant)?.platform === "snapchat"}
                        onVideoMetadataChange={
                          accountFor(variant)?.platform === "snapchat"
                            ? (metadata) => {
                                if (variant.snapchat)
                                  update(variant.accountId, {
                                    snapchat: {
                                      ...variant.snapchat,
                                      durationSeconds: metadata?.durationSeconds ?? 0,
                                      width: metadata?.width ?? 0,
                                      height: metadata?.height ?? 0,
                                    },
                                  });
                              }
                            : undefined
                        }
                        allowAltText={
                          accountFor(variant)?.platform === "x" ||
                          (accountFor(variant)?.platform === "linkedin" &&
                            (accountFor(variant)?.connection !== "browser" ||
                              variant.media.length <= 1))
                        }
                        allowDocuments={
                          accountFor(variant)?.platform === "linkedin" &&
                          accountFor(variant)?.connection === "browser"
                        }
                        onChange={(media) => update(variant.accountId, { media })}
                        onBusyChange={(busy) =>
                          setVideoProgress((current) => {
                            const next = { ...current };
                            if (busy) next[variant.accountId] = 0;
                            else delete next[variant.accountId];
                            return next;
                          })
                        }
                      />
                    </>
                  ) : null}
                  <label>
                    {t("Verified fact")}
                    <SearchableSelect
                      disabled={socialLocked}
                      value=""
                      label={t("Verified fact")}
                      options={[
                        { value: "", label: t("Add a fact to the content") },
                        ...publicFacts.map((fact) => ({
                          value: fact.id,
                          label: [fact.topic, ":", fact.text].join(" "),
                        })),
                      ]}
                      onChange={(nextValue) => {
                        const fact = publicFacts.find((item) => item.id === nextValue);
                        if (fact)
                          update(variant.accountId, {
                            text: [variant.text, fact.text].filter(Boolean).join("\n"),
                            factIds: [...new Set([...variant.factIds, fact.id])],
                          });
                      }}
                      searchLocale={getLocale()}
                    />
                  </label>
                  {variant.media.length ? (
                    <Button
                      disabled={socialLocked}
                      variant="secondary"
                      tone="danger"
                      type="button"
                      onClick={() => update(variant.accountId, { media: [] })}
                    >
                      {t("Remove attached media")}
                    </Button>
                  ) : null}
                </details>
                {!hasDraftAccess(variant.accountId) ? (
                  <Notice kind="error">
                    {t(
                      "Grant this account draft access for all selected projects or remove the account.",
                    )}
                  </Notice>
                ) : null}
                {variant.factIds.some((id) => !publicFacts.some((fact) => fact.id === id)) ? (
                  <Notice kind="warning">
                    {t(
                      "A verified fact in the content is outside the selected projects. Select the related project again or prepare the campaign again.",
                    )}
                  </Notice>
                ) : null}
                <div className="mt-2 border-t border-(--ui-tone-neutral-border) pt-2">
                  <Button
                    disabled={socialLocked}
                    variant="secondary"
                    tone="danger"
                    type="button"
                    onClick={() =>
                      setVariants((current) =>
                        current.filter((item) => item.accountId !== variant.accountId),
                      )
                    }
                  >
                    {t("Remove this account from the campaign")}
                  </Button>
                </div>
              </fieldset>
            ))}
            <p className="social-muted">
              {t(
                "You can add this draft to a publishing plan in the Automations section for regular posting.",
              )}
            </p>
            {!name.trim() || !variants.length || !validProjects ? (
              <small className="social-muted">
                {t("Complete the campaign name, project, account and content to save.")}
              </small>
            ) : invalidVariants ? (
              <Notice kind="warning">
                {t("Check the content, character limit, account access or schedule time.")}
              </Notice>
            ) : Object.keys(videoProgress).length ? (
              <Notice kind="loading">{t("You can save once the video upload finishes.")}</Notice>
            ) : null}
            <div className="social-actions">
              <Button
                loading={pendingUi.is("campaigns.save-campaign-draft")}
                type="submit"
                variant="secondary"
                disabled={
                  socialLocked ||
                  !name.trim() ||
                  !variants.length ||
                  !validProjects ||
                  invalidVariants ||
                  Object.keys(videoProgress).length > 0
                }
              >
                {t("Save campaign draft")}
              </Button>
              {editingId ? (
                <Button
                  disabled={socialLocked}
                  variant="secondary"
                  type="button"
                  onClick={(event) => {
                    setEditingId(undefined);
                    setName("");
                    setVariants([]);
                    closeComposer(event.currentTarget.closest("form")!);
                  }}
                >
                  {t("Stop editing")}
                </Button>
              ) : null}
            </div>
          </form>
        </Composer>
        <div className="social-columns">
          <section>
            <h2 className="sr-only">
              {t("Campaigns")} <small>{snapshot.campaigns.length}</small>
            </h2>
            <div className="social-list-tools">
              <label>
                {t("Search campaigns")}
                <SearchInput
                  disabled={socialLocked}
                  appearance="field"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("Campaign name")}
                />
              </label>
              <SocialFilters activeCount={statusFilter ? 1 : 0} onReset={() => setStatusFilter("")}>
                <label>
                  {t("Status")}
                  <NativeSelect
                    disabled={socialLocked}
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
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
            {snapshot.campaigns.length ? (
              visibleCampaigns.map((campaign) => (
                <Button
                  disabled={socialLocked}
                  type="button"
                  variant="tab"
                  className="social-row"
                  aria-pressed={selectedId === campaign.id}
                  key={campaign.id}
                  onClick={() => {
                    setSelectedId(campaign.id);
                    setPreview(null);
                    setApprovalConfirmed(false);
                  }}
                >
                  <strong>{campaign.name}</strong>
                  <StatusBadge
                    status={campaignState(campaign, snapshot.jobs, snapshot.campaignStates)}
                    label={stateLabel(campaign)}
                  />
                  <span>
                    {t("{p0} projects · {p1} accounts", {
                      p0: campaign.projectIds.length,
                      p1: campaign.variants.length,
                    })}
                  </span>
                </Button>
              ))
            ) : (
              <Empty title={t("Prepare your first campaign")}>
                {t("Use New campaign to pick projects and accounts and prepare your content.")}
              </Empty>
            )}
            {snapshot.campaigns.length && !visibleCampaigns.length ? (
              <Empty title={t("No matching campaign")}>
                {t("Change the search or the status filter.")}
              </Empty>
            ) : null}
          </section>
          {showCampaignPreview ? (
            <section>
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
                        <h3>{t("Review and publish")}</h3>
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
                          onClick={() => {
                            setEditVersion((value) => value + 1);
                            setEditingId(selected.id);
                            setEditingRevision(selected.revision);
                            setName(selected.name);
                            setSelectedProjects(selected.projectIds);
                            setVariants(
                              selected.variants.map((variant) => ({
                                ...variant,
                                media: [...variant.media],
                                factIds: [...variant.factIds],
                              })),
                            );
                          }}
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
                  <details className="social-campaign-results">
                    <summary>
                      {t("Post results")} <small>{selectedJobs.length}</small>
                    </summary>
                    <JobList
                      snapshot={snapshot}
                      campaignId={selected.id}
                      client={client}
                      run={run}
                    />
                  </details>
                </>
              ) : (
                <Empty title={t("Campaign preview")}>
                  {t(
                    "Select a campaign to see its content, publish time and the result for each account.",
                  )}
                </Empty>
              )}
            </section>
          ) : null}
        </div>
      </div>
      <section className="social-page-secondary">
        <ProjectProfile
          client={client}
          profiles={snapshot.profiles}
          projects={projects}
          initialProject={initialProject}
          run={run}
        />
      </section>
    </div>
  );
}
function ProjectProfile({
  client,
  profiles,
  projects,
  initialProject,
  run,
}: {
  client: SocialClient;
  profiles: SocialProjectProfile[];
  projects: HostProject[];
  initialProject?: string;
  run: Run;
}) {
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const [projectId, setProjectId] = useState(initialProject ?? projects[0]?.id ?? "");
  const activeProject = projects.some((project) => project.id === projectId)
    ? projectId
    : (projects[0]?.id ?? "");
  const profile = profiles.find((item) => item.projectId === activeProject);
  type ProfileDraft = {
    productName?: string;
    voice?: string;
    topic?: string;
    text?: string;
    source?: string;
    factId?: string;
  };
  const [drafts, setDrafts] = useState<Record<string, ProfileDraft>>({});
  const draft = drafts[activeProject] ?? {};
  const productName = draft.productName ?? profile?.productName ?? "";
  const voice = draft.voice ?? profile?.brandVoice ?? "";
  const updateDraft = (change: ProfileDraft) =>
    setDrafts((current) => ({
      ...current,
      [activeProject]: { ...current[activeProject], ...change },
    }));
  const save = (facts: SocialProjectProfile["facts"]) =>
    client.request("profiles.save", {
      projectId: activeProject,
      productName,
      brandVoice: voice,
      facts,
    });
  return (
    <details className="social-form">
      <summary>{t("Product information and verified announcements")}</summary>
      <p className="social-muted">
        {t(
          "Verified product information you can add to campaigns and that automatic replies will use.",
        )}
      </p>
      <label>
        {t("Project")}
        <SearchableSelect
          value={activeProject}
          disabled={socialLocked || !projects.length}
          label={t("Project")}
          options={[
            ...(!projects.length ? [{ value: "", label: t("No project found") }] : []),
            ...projects.map((project) => ({
              value: project.id,
              label: project.name || project.cwd,
            })),
          ]}
          onChange={(nextValue) => setProjectId(nextValue)}
          searchLocale={getLocale()}
        />
      </label>
      <form
        className="social-form"
        onSubmit={(event) => {
          field(event);
          void pendingUi.run("project-profile.save-product-profile", () =>
            run(() => save(profile?.facts ?? []), t("Product profile saved.")),
          );
        }}
      >
        <h3>{t("Product profile")}</h3>
        <TextField
          disabled={socialLocked}
          label={t("Product name")}
          required
          maxLength={200}
          value={productName}
          onChange={(event) => updateDraft({ productName: event.target.value })}
        />
        <TextField
          disabled={socialLocked}
          label={t("Brand voice")}
          required
          maxLength={1000}
          value={voice}
          placeholder={t("E.g. short, clear and friendly")}
          onChange={(event) => updateDraft({ voice: event.target.value })}
        />
        <Button
          loading={pendingUi.is("project-profile.save-product-profile")}
          type="submit"
          variant="secondary"
          disabled={socialLocked || !activeProject}
        >
          {t("Save product profile")}
        </Button>
      </form>
      <form
        className="social-form"
        onSubmit={(event) => {
          field(event);
          const fact = {
            id: draft.factId ?? crypto.randomUUID(),
            topic: draft.topic ?? "",
            text: draft.text ?? "",
            source: draft.source ?? "",
            verifiedAt: Date.now(),
          };
          const facts = draft.factId
            ? (profile?.facts ?? []).map((item) => (item.id === draft.factId ? fact : item))
            : [...(profile?.facts ?? []), fact];
          void (async () => {
            if (
              await pendingUi.run("project-profile.save-public-fact", () =>
                run(() => save(facts), t("Verified product fact saved.")),
              )
            )
              updateDraft({
                topic: "",
                text: "",
                source: "",
                factId: undefined,
              });
          })();
        }}
      >
        <h3>{draft.factId ? t("Edit verified fact") : t("Add verified fact")}</h3>
        <TextField
          disabled={socialLocked}
          label={t("Fact topic")}
          required
          maxLength={200}
          value={draft.topic ?? ""}
          onChange={(event) => updateDraft({ topic: event.target.value })}
        />
        <TextareaField
          disabled={socialLocked}
          label={t("Verified, announceable fact")}
          required
          maxLength={4000}
          value={draft.text ?? ""}
          onChange={(event) => updateDraft({ text: event.target.value })}
        />
        <TextField
          disabled={socialLocked}
          label={t("Verification source")}
          required
          maxLength={1000}
          value={draft.source ?? ""}
          onChange={(event) => updateDraft({ source: event.target.value })}
        />
        <div className="social-actions">
          <Button
            loading={pendingUi.is("project-profile.save-public-fact")}
            type="submit"
            variant="secondary"
            disabled={
              socialLocked ||
              !activeProject ||
              !productName.trim() ||
              !voice.trim() ||
              (!draft.factId && (profile?.facts.length ?? 0) >= 100)
            }
          >
            {t("Save public fact")}
          </Button>
          {draft.factId ? (
            <Button
              disabled={socialLocked}
              variant="secondary"
              type="button"
              onClick={() =>
                updateDraft({
                  topic: "",
                  text: "",
                  source: "",
                  factId: undefined,
                })
              }
            >
              {t("Stop editing")}
            </Button>
          ) : null}
        </div>
      </form>
      {!profile?.facts.length ? (
        <Empty>
          {t("No saved product facts. Add a verified fact to prepare automatic replies.")}
        </Empty>
      ) : null}
      {profile?.facts.map((fact) => (
        <p key={fact.id}>
          <strong>{fact.topic}</strong> · {fact.text}
          <small>
            {" "}
            {fact.source} · {time(fact.verifiedAt)}
          </small>
          <Button
            disabled={socialLocked}
            variant="secondary"
            type="button"
            onClick={() =>
              updateDraft({
                factId: fact.id,
                topic: fact.topic,
                text: fact.text,
                source: fact.source,
              })
            }
          >
            {t("Edit fact")}
          </Button>
        </p>
      ))}
    </details>
  );
}
