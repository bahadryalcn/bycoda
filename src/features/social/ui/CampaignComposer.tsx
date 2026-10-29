import { useSocialPending } from "./useSocialPending";
import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TextField } from "../../../shared/ui/TextField";
import { NativeSelect } from "../../../shared/ui/Select";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Button } from "../../../shared/ui/Button";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { TikTokPublishingFields } from "./TikTokPublishingFields";
import { XMediaFields } from "./XMediaFields";
import { MetaPublishingFields } from "./MetaPublishingFields";
import { FacebookReelFields, validFacebookReel } from "./FacebookReelFields";
import { useQueryClient } from "@tanstack/react-query";
import { type CampaignVariant, type SocialCampaign, type SocialPolicy } from "../model/social";
import { DEFAULT_SOCIAL_POLICIES, effectiveSocialPolicy, socialCharacterCount, socialLimit } from "../model/socialPolicy";
import { SocialMultiSelect } from "./SocialMultiSelect";
import { socialQueryScope } from "../model/socialQuery";
import { Composer, closeComposer, Projects, Notice, field, names, youtubeDefaults, type Props } from "./socialShared";

function dateInput(value: number) {
  if (!Number.isFinite(value)) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(value - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
/** Draft writing and saving; edits arrive as a versioned request from the campaign detail. */
export function CampaignComposer({
  client,
  snapshot,
  projects,
  initialProject,
  run,
  accountIntent,
  editRequest,
  onView,
  onSaved,
}: Pick<Props, "client" | "snapshot" | "projects" | "initialProject" | "run"> & {
  accountIntent?: { accountId: string; token: number };
  editRequest?: { campaign: SocialCampaign; version: number };
  onView: (view: "manual") => void;
  onSaved: (campaign: SocialCampaign) => void;
}) {
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const queryClient = useQueryClient();
  const [selectedProjects, setSelectedProjects] = useState<string[]>(
    initialProject ? [initialProject] : [],
  );
  const [variants, setVariants] = useState<CampaignVariant[]>([]);
  const [openVariant, setOpenVariant] = useState("");
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [editingRevision, setEditingRevision] = useState<number>();
  // An edit request from the campaign detail is applied once per version while rendering.
  const [appliedEdit, setAppliedEdit] = useState(0);
  if (editRequest && editRequest.version !== appliedEdit) {
    setAppliedEdit(editRequest.version);
    setEditingId(editRequest.campaign.id);
    setEditingRevision(editRequest.campaign.revision);
    setName(editRequest.campaign.name);
    setSelectedProjects(editRequest.campaign.projectIds);
    setVariants(
      editRequest.campaign.variants.map((variant) => ({
        ...variant,
        media: [...variant.media],
        factIds: [...variant.factIds],
      })),
    );
  }
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
  const seenAccountIntent = useRef<number | undefined>(undefined);
  const [intendedAccount, setIntendedAccount] = useState("");
  useEffect(() => {
    if (!accountIntent || seenAccountIntent.current === accountIntent.token) return;
    onView("manual");
    setIntendedAccount(accountIntent.accountId);
    const account = snapshot.accounts.find((item) => item.id === accountIntent.accountId);
    // A navigation intent may arrive before this panel's snapshot. Resolve it
    // once the target exists, without replacing any in-progress variants.
    if (!account) return;
    seenAccountIntent.current = accountIntent.token;
    if (!account || !selectedProjects.length || !selectedProjects.every((id) => account.grants[id]?.includes("draft"))) return;
    setVariants((current) => current.some((item) => item.accountId === account.id) ? current : [...current, {
      accountId: account.id, text: "", media: [], factIds: [], scheduledAt: Date.now(),
      ...(account.platform === "youtube" ? { youtube: { ...youtubeDefaults } } : {}),
    }]);
  }, [accountIntent, snapshot.accounts, selectedProjects]);
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
  const update = (id: string, change: Partial<CampaignVariant>) =>
    setVariants((current) =>
      current.map((item) => (item.accountId === id ? { ...item, ...change } : item)),
    );
  return (
        <Composer
          title={editingId ? t("Edit campaign draft") : t("Prepare content")}
          onOpen={() => {
            void queryClient.invalidateQueries({
              queryKey: [...socialQueryScope(client), "tiktok-creator"],
            });
          }}
          editing={editRequest?.version ?? 0}
          description={t(
            "Save the content, check it and approve it for publishing. Saving does not start sending.",
          )}
        >
          <form
            className="social-form"
            onInvalidCapture={(event) => {
              const input = event.target as HTMLElement;
              const owner = input.closest<HTMLElement>("[data-content-account]");
              if (owner?.dataset.contentAccount) {
                event.preventDefault();
                setOpenVariant(owner.dataset.contentAccount);
                requestAnimationFrame(() => input.focus());
              }
            }}
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
                onSaved(saved);
                setName("");
                setVariants([]);
                setEditingId(undefined);
                closeComposer(form);
              })();
            }}
          >
            {intendedAccount ? <Notice kind="info">
              {t("Preparing for account: {p0}", { p0: snapshot.accounts.find((item) => item.id === intendedAccount)?.name ?? t("Removed account") })}
              {!variants.some((item) => item.accountId === intendedAccount) ? <p>{t("Select a project with draft access, then add this account to the targets.")}</p> : null}
            </Notice> : null}
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
              <fieldset key={variant.accountId} className="social-variant" data-content-account={variant.accountId}>
                <legend>
                  <Button variant="link" aria-expanded={variant.accountId === (variants.some((item) => item.accountId === openVariant) ? openVariant : variants[0]?.accountId)} onClick={() => setOpenVariant(variant.accountId)}>
                  {snapshot.accounts.find((account) => account.id === variant.accountId)?.name}
                  </Button>
                </legend>
                <div hidden={variant.accountId !== (variants.some((item) => item.accountId === openVariant) ? openVariant : variants[0]?.accountId)} className="flex min-w-0 flex-col gap-3">
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
                  <p className="text-ui-caption text-(--ui-text-secondary)">{t("Time zone")}: {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
                <details className="social-settings">
                  <summary>{t("Media and link")}</summary>
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
  );
}
