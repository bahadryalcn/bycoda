import { t } from "../../../../shared/i18n";
import { xPostWeight } from "../../../../integrations/social/publishingFormats";
import { xPostExtrasIssue, X_POST_WEIGHT_LIMIT } from "../../../../integrations/social/x-publish";
import {
  INSTAGRAM_CAROUSEL_MAX,
  instagramPublishOptionsIssue,
  instagramStoryAccountIssue,
  type InstagramPublishOptions,
} from "../../../../integrations/social/adapters/instagram-publish";
import { browserContentIssue } from "../../../../integrations/social/browserCapabilities";
import { snapchatContentIssue } from "../../../../integrations/social/snapchat";
import { facebookScheduleTime } from "../../../../integrations/social/adapters/facebook-schedule";
import {
  SOCIAL_PLATFORM_NAMES,
  type CampaignVariant,
  type Capability,
  type SocialAccount,
  type SocialMedia,
  type SocialPolicies,
  type SocialSnapshot,
  type TikTokCreatorInfo,
} from "../../model/social";
import { DEFAULT_SOCIAL_POLICIES, effectiveSocialPolicy } from "../../model/socialPolicy";
import { socialCharacterCount, socialLimit } from "../../model/socialLimits";
import { capabilityReasonText } from "../common/capabilityText";
import {
  mediaOf,
  scheduledMs,
  withUtm,
  xPostExtras,
  type ContentDraft,
  type ContentMedia,
  type FacebookDraft,
  type InstagramDraft,
  type MediaProbe,
  type PlatformDraft,
} from "./contentDraft";

/** Limits carried over from the retired X and Meta composers. The Host validates again. */
export const X_IMAGE_MAX = 4;
export const META_IMAGE_MAX = 4;
export const YOUTUBE_TITLE_MAX = 100;
export const REEL_SECONDS = { min: 4, max: 60 } as const;
export const REEL_SIZE = { minWidth: 540, minHeight: 960 } as const;
export const REEL_MIN_FPS = 23;
export const REDDIT_SUBREDDIT = /^[A-Za-z0-9_]{3,21}$/;

export function usesInstagramApi(account: SocialAccount): boolean {
  return account.platform === "instagram" && account.connection !== "browser";
}

export type Problem = { text: string; accountId?: string };

export type RuleInput = {
  draft: ContentDraft;
  projectId?: string;
  accounts: SocialAccount[];
  snapshot?: Pick<SocialSnapshot, "capabilities" | "policies">;
  creator?: Partial<Record<string, TikTokCreatorInfo>>;
  now: number;
};

export function accountLabel(account: SocialAccount): string {
  return `${SOCIAL_PLATFORM_NAMES[account.platform]} · ${account.name}`;
}

export function publishCapability(
  snapshot: RuleInput["snapshot"],
  accountId: string,
): Capability | undefined {
  return snapshot?.capabilities[accountId]?.find((item) => item.operation === "publish");
}

function isTelegramChannelBot(account: SocialAccount): boolean {
  return (
    account.platform === "telegram" &&
    account.accountType === "channel" &&
    account.connection === "token"
  );
}

/** Character limit for one variant: the configured limit, tightened by the platform's own rules. */
export function characterLimit(
  account: SocialAccount,
  policies: SocialPolicies | undefined,
  shape: { reel?: boolean; hasMedia?: boolean },
): number | undefined {
  const configured = socialLimit(
    effectiveSocialPolicy(policies ?? DEFAULT_SOCIAL_POLICIES, account.platform),
    "content",
  );
  if (account.platform === "facebook" && account.connection !== "browser" && shape.reel)
    return Math.min(configured ?? Infinity, 2200);
  if (isTelegramChannelBot(account))
    return Math.min(configured ?? Infinity, shape.hasMedia ? 1024 : 4096);
  if (account.platform === "x") return Math.min(configured ?? Infinity, X_POST_WEIGHT_LIMIT);
  return configured;
}

/** Platform count: text plus link. Telegram channel bot posts count UTF-16 units. */
export function characterCount(account: SocialAccount, text: string, link?: string): number {
  const content = [text, link].filter(Boolean).join("\n");
  if (account.platform === "x") return xPostWeight(content);
  return isTelegramChannelBot(account) ? content.length : socialCharacterCount(content);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function isPublicMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function instagramPayload(options: InstagramDraft | undefined, media: ContentMedia[]) {
  const story = options?.format === "story";
  const instagram: InstagramPublishOptions = {
    ...(story ? { format: "story" } : {}),
    ...(!story && options?.collaborators ? { collaborators: options.collaborators } : {}),
    ...(!story && options?.locationId ? { locationId: options.locationId } : {}),
    ...(options?.isAiGenerated !== undefined ? { isAiGenerated: options.isAiGenerated } : {}),
    ...(options?.userTags?.length
      ? {
          userTags: options.userTags.map(({ localMediaId, username, x, y }) => ({
            username: username.trim(),
            x,
            y,
            mediaIndex: media.findIndex((item) => item.localId === localMediaId),
          })),
        }
      : {}),
  };
  return {
    instagram,
    media: media.map<SocialMedia>((item) => {
      const { alt, ...asset } = item.media;
      const description = options?.altText?.[item.localId] ?? alt;
      return !story && description?.trim() ? { ...asset, alt: description.trim() } : asset;
    }),
  };
}

function isInstagramStory(account: SocialAccount, draft: ContentDraft): boolean {
  return usesInstagramApi(account) && draft.platform[account.id]?.instagram?.format === "story";
}

function videoProbe(media: ContentMedia[]): MediaProbe | undefined {
  return media.find((item) => item.media.kind === "video")?.probe;
}

function snapchatOptions(draft: ContentDraft, accountId: string): CampaignVariant["snapchat"] {
  const options = draft.platform[accountId]?.snapchat;
  if (!options) return undefined;
  const probe = videoProbe(draft.media);
  const { sourceText, ...publish } = options;
  const sources = sourceText
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const match = /^(snap|spotlight):(.+)$/.exec(entry);
      return {
        kind: match?.[1] === "spotlight" ? ("spotlight" as const) : ("snap" as const),
        id: match?.[2].trim() ?? "",
      };
    });
  return {
    ...publish,
    ...(sources ? { savedStorySources: sources } : {}),
    durationSeconds: probe?.durationSeconds ?? 0,
    width: probe?.width ?? 0,
    height: probe?.height ?? 0,
  };
}

/** Attachment rules per platform. Platforms without rules here return no problem. */
export function mediaProblems(
  platform: SocialAccount["platform"],
  media: ContentMedia[],
): string[] {
  const images = media.filter((item) => item.media.kind === "image").length;
  const videos = media.filter((item) => item.media.kind === "video").length;
  switch (platform) {
    case "x":
      return videos > 1 || (videos && images) || images > X_IMAGE_MAX
        ? [t("X posts take either up to four images or one video.")]
        : [];
    case "instagram":
    case "facebook":
      return videos > 1 || (videos && images)
        ? [t("Attach either one video or up to four images.")]
        : images > META_IMAGE_MAX
          ? [t("Up to four images per post.")]
          : [];
    case "tiktok":
      return (media.length === 1 && videos === 1) ||
        (images === media.length && images > 0 && images <= 4)
        ? []
        : [t("Attach one video or up to four TikTok photos.")];
    case "youtube":
      return media.length === 1 && videos === 1 ? [] : [t("Attach exactly one video.")];
    default:
      return [];
  }
}

/** A finite frame rate of at least REEL_MIN_FPS. Infinity and NaN are not frame rates. */
export function isValidFrameRate(frameRate: number | undefined): boolean {
  return frameRate !== undefined && Number.isFinite(frameRate) && frameRate >= REEL_MIN_FPS;
}

export function reelProblems(options: FacebookDraft | undefined, media: ContentMedia[]): string[] {
  if (options?.target !== "reel") return [];
  const videos = media.filter((item) => item.media.kind === "video");
  if (videos.length !== 1) return [t("A Reel needs exactly one video.")];
  const probe = videos[0]!.probe;
  const problems: string[] = [];
  if (!probe?.durationSeconds) problems.push(t("The video length could not be read."));
  else if (probe.durationSeconds < REEL_SECONDS.min || probe.durationSeconds > REEL_SECONDS.max)
    problems.push(
      t("Reels take {p0} to {p1} seconds.", { p0: REEL_SECONDS.min, p1: REEL_SECONDS.max }),
    );
  if (!probe?.width || !probe.height) problems.push(t("The video size could not be read."));
  else if (
    probe.width < REEL_SIZE.minWidth ||
    probe.height < REEL_SIZE.minHeight ||
    probe.width * 16 !== probe.height * 9
  )
    problems.push(t("Reels need a 9:16 video of at least 540 × 960."));
  if (!isValidFrameRate(options.frameRate))
    problems.push(t("Enter the frame rate, at least {p0} fps.", { p0: REEL_MIN_FPS }));
  return problems;
}

function facebookProblems(
  options: FacebookDraft | undefined,
  draft: ContentDraft,
  now: number,
): string[] {
  const target = options?.target ?? "feed";
  if (target === "reel") return reelProblems(options, draft.media);
  const [attachment] = draft.media;
  const problems: string[] = [];
  if (target === "story") {
    if (draft.media.length !== 1 || !attachment || attachment.media.kind === "document")
      problems.push(t("Attach one photo or video for a Facebook Story."));
    if (draft.text.trim() || draft.link.trim())
      problems.push(t("Facebook Stories accept only the attached photo or video."));
    const probe = attachment?.probe;
    if (
      attachment?.media.kind === "video" &&
      (!probe?.durationSeconds ||
        probe.durationSeconds < 3 ||
        probe.durationSeconds > 60 ||
        !probe.width ||
        !probe.height ||
        probe.width < 540 ||
        probe.height < 960 ||
        probe.width * 16 !== probe.height * 9)
    )
      problems.push(
        t("Facebook Story videos need a 3–60 second vertical MP4 of at least 540 × 960 pixels."),
      );
  }
  if (target === "video" && (draft.media.length !== 1 || attachment?.media.kind !== "video"))
    problems.push(t("Attach exactly one video."));
  if (
    target === "feed" &&
    options?.scheduledPublishAt &&
    draft.media.some((item) => item.media.kind === "video")
  )
    problems.push(t("Choose Facebook Video, Reel, or Story for a video attachment."));
  if (options?.scheduledPublishAt && (target === "feed" || target === "video")) {
    const scheduled = new Date(options.scheduledPublishAt).getTime();
    const dispatchAt = Math.max(now, scheduledMs(draft) ?? now);
    if (draft.repeat.enabled)
      problems.push(t("Facebook scheduling is supported for one-off campaigns only."));
    else if (facebookScheduleTime(scheduled, dispatchAt) === undefined)
      problems.push(t("Facebook scheduling requires 10 minutes to 75 days after dispatch."));
  }
  return problems;
}

export function tiktokProblems(
  options: PlatformDraft["tiktok"],
  media: ContentMedia[],
  creator?: TikTokCreatorInfo,
  connection?: SocialAccount["connection"],
): string[] {
  const problems: string[] = [];
  const photo = options?.mediaType === "photo";
  const inbox = options?.mode === "inbox";
  if (photo) {
    if (!media.length || media.some((item) => item.media.kind !== "image"))
      problems.push(t("Attach photos for the TikTok photo post."));
    else if ((options?.photoCoverIndex ?? 0) >= media.length)
      problems.push(t("Choose a cover from your TikTok photos."));
    if (
      connection !== undefined &&
      media.some((item) => (connection === "browser" ? !item.media.uploadId : !item.media.url))
    )
      problems.push(
        connection === "browser"
          ? t("Attach local images for TikTok Studio.")
          : t("Use photo URLs on a TikTok-verified domain or URL prefix."),
      );
  } else if (media.some((item) => item.media.kind === "image")) {
    problems.push(t("Choose Photos as the TikTok post format."));
  }
  if (inbox) {
    if (connection === "browser") problems.push(t("TikTok inbox drafts need the API connection."));
    return problems;
  }
  if (!options?.privacy)
    problems.push(
      photo ? t("Choose who can see this post") : t("Choose who can see the TikTok video."),
    );
  else if (creator && !creator.privacyOptions.includes(options.privacy))
    problems.push(t("Choose a privacy option your TikTok account offers."));
  if (options?.consent !== true) problems.push(t("Confirm the TikTok content consent."));
  if (photo) return problems;
  const duration = videoProbe(media)?.durationSeconds;
  if (!duration) problems.push(t("The video length could not be read."));
  else if (creator && duration > creator.maxDurationSeconds)
    problems.push(t("This video is longer than your TikTok account allows."));
  return problems;
}

export function youtubeProblems(options: PlatformDraft["youtube"], probe?: MediaProbe): string[] {
  const problems: string[] = [];
  const title = options?.title?.trim() ?? "";
  if (!title) problems.push(t("Enter a YouTube title."));
  else if (Array.from(title).length > YOUTUBE_TITLE_MAX)
    problems.push(t("YouTube titles can be at most {p0} characters.", { p0: YOUTUBE_TITLE_MAX }));
  if (!options?.privacy) problems.push(t("Choose YouTube privacy."));
  if (options?.madeForKids === undefined)
    problems.push(t("Say whether the video is made for kids."));
  if (options?.format === "short") {
    if (!probe?.durationSeconds || !probe.width || !probe.height) {
      problems.push(t("Shorts need readable video dimensions and duration."));
    } else if (probe.durationSeconds > 180 || probe.width > probe.height) {
      problems.push(t("Shorts need a square or vertical video up to 3 minutes."));
    }
  }
  return problems;
}

/**
 * Reddit: one subreddit is required. The Host has no Reddit variant field yet, so publishing is
 * blocked after the subreddit check; the draft still keeps the choice for review.
 */
export function redditProblems(options: PlatformDraft["reddit"]): string[] {
  const subreddit = options?.subreddit.trim() ?? "";
  if (!REDDIT_SUBREDDIT.test(subreddit))
    return [t("Choose one subreddit: 3 to 21 letters, numbers or underscores.")];
  return [t("Reddit posting is not connected to the Host yet.")];
}

/** Whether an account can be chosen for this post, with the plain reason when it cannot. */
export function accountAvailability(
  account: SocialAccount,
  input: Pick<RuleInput, "projectId" | "snapshot">,
): { disabled: boolean; reason?: string } {
  if (input.projectId && !account.grants[input.projectId]?.includes("draft"))
    return {
      disabled: true,
      reason: t("No access to this project. Grant it in Accounts & Settings."),
    };
  const capability = publishCapability(input.snapshot, account.id);
  if (!capability || capability.status !== "available")
    return {
      disabled: true,
      reason: capabilityReasonText(
        capability ?? { status: "unsupported", reasonCode: "unsupported.not_yet" },
      ),
    };
  return { disabled: false };
}

/** Every reason the draft cannot be saved or published, in the order the owner should fix them. */
export function draftProblems(input: RuleInput): Problem[] {
  const { draft, now } = input;
  const problems: Problem[] = [];
  if (!input.projectId) problems.push({ text: t("Choose a project first.") });
  const accounts = selectedAccounts(draft, input.accounts);
  if (!hasPostContent(draft, accounts))
    problems.push({ text: t("Write the post or attach media.") });
  if (!draft.accountIds.length) problems.push({ text: t("Choose at least one account.") });
  const link = draft.link.trim();
  if (link && !isHttpUrl(link))
    problems.push({ text: t("Enter a link that starts with https://.") });
  if (draft.when === "later") {
    const at = scheduledMs(draft);
    if (!Number.isFinite(at)) problems.push({ text: t("Pick a valid time.") });
    else if (at! <= now) problems.push({ text: t("Pick a time in the future.") });
  }
  if (draft.repeat.enabled) {
    const { minMinutes, maxMinutes, totalPosts } = draft.repeat;
    if (!(minMinutes >= 1 && maxMinutes >= minMinutes))
      problems.push({ text: t("Repeat: the longest interval must be at least the shortest.") });
    if (!(totalPosts >= 1)) problems.push({ text: t("Repeat: enter how many posts to make.") });
  }
  // A chosen account that is missing from the snapshot would be dropped from the variants silently.
  for (const id of draft.accountIds) {
    if (!input.accounts.some((account) => account.id === id))
      problems.push({
        text: t("This account is no longer available. Uncheck it to continue."),
        accountId: id,
      });
  }
  const hasCaptionTarget = accounts.some((account) => !isInstagramStory(account, draft));
  for (const account of accounts) {
    const name = accountLabel(account);
    const add = (text: string) =>
      problems.push({ text: `${name}: ${text}`, accountId: account.id });
    const availability = accountAvailability(account, input);
    if (availability.disabled) add(availability.reason!);
    const limit = characterLimit(account, input.snapshot?.policies, {
      reel: draft.platform[account.id]?.facebook?.target === "reel",
      hasMedia: draft.media.length > 0,
    });
    const platform = draft.platform[account.id];
    const story = isInstagramStory(account, draft);
    const count = story ? 0 : characterCount(account, draft.text.trim(), withUtm(link, draft.utm));
    if (limit !== undefined && count > limit)
      add(t("Content for this account can be at most {p0} characters.", { p0: limit }));
    if (usesInstagramApi(account)) {
      if (
        draft.media.length < 1 ||
        draft.media.length > INSTAGRAM_CAROUSEL_MAX ||
        draft.media.some((item) => item.media.kind === "document")
      )
        add(t("Attach between one and 20 Instagram images or videos."));
      if (
        draft.media.some(
          ({ media }) => !media.url || !isPublicMediaUrl(media.url) || media.uploadId,
        )
      )
        add(t("Instagram API publishing requires public HTTPS media URLs."));
      if (
        platform?.instagram?.userTags?.some(
          (tag) => !draft.media.some((item) => item.localId === tag.localMediaId),
        )
      )
        add(t("Choose an attachment for every Instagram tag."));
      const payload = instagramPayload(platform?.instagram, draft.media);
      if (
        draft.repeat.enabled &&
        (Object.keys(payload.instagram).length || payload.media.some((item) => item.alt))
      )
        add(t("Instagram Stories, tags, alt text and publishing options require a one-time post."));
      // A caption belongs to the other selected targets. For Stories alone, ask the owner to clear it.
      const caption =
        story && hasCaptionTarget ? "" : [draft.text, link].filter(Boolean).join("\n");
      const issue =
        instagramStoryAccountIssue(payload.instagram, account.instagramAccountType) ??
        instagramPublishOptionsIssue(payload.instagram, payload.media, caption);
      if (issue) add(issue);
    } else {
      for (const text of mediaProblems(account.platform, draft.media)) add(text);
      if (
        account.platform === "instagram" &&
        draft.media.some(({ media }) => !media.uploadId || media.url)
      )
        add(t("Instagram browser publishing requires files uploaded from this device."));
    }
    if (account.platform === "x") {
      const x = xPostExtras(platform?.x);
      if (x) {
        if (xPostExtrasIssue(x, draft.media.length)) add(t("Check X publishing options."));
        if (account.connection === "browser") add(t("Open X to publish these options manually."));
        else if (x.quotePostId && account.xApiProduct !== "enterprise")
          add(t("X quote posts require Enterprise API access."));
        if (draft.repeat.enabled) add(t("Schedule this X format as a single campaign."));
      }
    }
    if (draft.media.some((item) => item.media.kind === "document")) {
      if (account.platform !== "linkedin") add(t("PDF documents require a LinkedIn account."));
      else if (draft.media.length !== 1) add(t("Attach one PDF document by itself."));
      else if (!draft.media[0]?.media.title?.trim()) add(t("Enter a document title."));
    }
    if (account.platform === "linkedin") {
      const format = platform?.linkedinFormat;
      if (format && draft.repeat.enabled)
        add(t("Turn off repeat for LinkedIn polls and article links."));
      if (format && (link || (format.kind === "poll" && draft.media.length)))
        add(t("Remove attachments and the separate link for this LinkedIn format."));
      if (format?.kind === "poll") {
        const options = format.options.map((option) => option.trim()).filter(Boolean);
        if (
          !format.question.trim() ||
          options.length < 2 ||
          new Set(options.map((option) => option.toLowerCase())).size !== options.length
        )
          add(t("Enter a poll question and two to four distinct options."));
      }
      if (format?.kind === "article") {
        if (!isHttpUrl(format.source) || !format.source.trim().startsWith("https://"))
          add(t("Enter a link that starts with https://."));
        if (!format.title.trim()) add(t("Enter a title."));
        if (draft.media.length > 1 || draft.media.some((item) => item.media.kind !== "image"))
          add(t("Attach one image for the article thumbnail."));
      }
    }
    if (
      draft.media.some((item) => item.youtubeApiOnly) &&
      (account.platform !== "youtube" || account.connection === "browser")
    )
      add(t("Large videos require a YouTube API connection."));
    if (account.platform === "facebook")
      for (const text of facebookProblems(platform?.facebook, draft, now)) add(text);
    if (account.platform === "tiktok")
      for (const text of tiktokProblems(
        platform?.tiktok,
        draft.media,
        input.creator?.[account.id],
        account.connection ?? "oauth",
      ))
        add(text);
    if (account.platform === "youtube")
      for (const text of youtubeProblems(platform?.youtube, videoProbe(draft.media))) add(text);
    if (account.platform === "reddit")
      for (const text of redditProblems(platform?.reddit)) add(text);
    if (account.platform === "snapchat") {
      const snapchat = snapchatOptions(draft, account.id);
      if (!snapchat) add(t("Choose a Snapchat publishing format."));
      else {
        const job = {
          kind: "publish" as const,
          payload: {
            snapchat,
            text: draft.text.trim(),
            media: mediaOf(draft.media),
            link: withUtm(link, draft.utm) || undefined,
          },
        };
        const issue =
          account.connection === "browser"
            ? browserContentIssue(account, job)
            : snapchatContentIssue(account, job);
        if (issue) add(t(issue));
      }
    }
  }
  return problems;
}

export function selectedAccounts(draft: ContentDraft, accounts: SocialAccount[]): SocialAccount[] {
  return draft.accountIds
    .map((id) => accounts.find((account) => account.id === id))
    .filter((account): account is SocialAccount => account !== undefined);
}

export function hasPostContent(draft: ContentDraft, accounts: SocialAccount[]): boolean {
  return (
    !!draft.text.trim() ||
    !!draft.media.length ||
    (accounts.length > 0 &&
      accounts.every(
        (account) =>
          account.platform === "linkedin" &&
          account.connection === "oauth" &&
          !!draft.platform[account.id]?.linkedinFormat,
      ))
  );
}

/** The Host variants for a valid draft. Call only when `draftProblems` returned nothing. */
export function buildVariants(input: RuleInput): CampaignVariant[] {
  const { draft, now } = input;
  const scheduled = scheduledMs(draft);
  const at = scheduled !== undefined && Number.isFinite(scheduled) ? scheduled : now;
  const link = withUtm(draft.link, draft.utm) || undefined;
  const media = mediaOf(draft.media);
  const probe = videoProbe(draft.media);
  const selected = selectedAccounts(draft, input.accounts);
  const hasCaptionTarget = selected.some((account) => !isInstagramStory(account, draft));
  return selected.map((account) => {
    const platform = draft.platform[account.id];
    const variant: CampaignVariant = {
      accountId: account.id,
      text: draft.text.trim(),
      media,
      ...(link ? { link } : {}),
      scheduledAt: at,
      factIds: [...draft.factIds],
    };
    if (account.platform === "x") {
      const x = xPostExtras(platform?.x);
      if (x) variant.x = x;
    }
    if (account.platform === "snapchat") variant.snapchat = snapchatOptions(draft, account.id);
    // Spread the saved options first so fields without a form control (category, publish time,
    // TikTok mode and photo fields) survive an edit; the normalized fields below then override.
    if (account.platform === "youtube" && platform?.youtube) {
      variant.youtube = {
        ...platform.youtube,
        title: platform.youtube.title?.trim() ?? "",
        privacy: platform.youtube.privacy ?? "private",
        madeForKids: platform.youtube.madeForKids ?? false,
        containsSyntheticMedia: platform.youtube.containsSyntheticMedia ?? false,
      };
    }
    if (account.platform === "tiktok" && platform?.tiktok) {
      const tiktok = platform.tiktok;
      variant.tiktok = {
        ...tiktok,
        ...(tiktok.mediaType === "photo"
          ? {
              photoTitle: tiktok.photoTitle?.trim() ?? "",
              photoCoverIndex: tiktok.photoCoverIndex ?? 0,
              autoAddMusic: tiktok.autoAddMusic ?? false,
            }
          : {}),
        privacy: tiktok.privacy ?? "",
        durationSeconds: probe?.durationSeconds ?? 0,
        allowComment: tiktok.allowComment ?? false,
        allowDuet: tiktok.mediaType !== "photo" && (tiktok.allowDuet ?? false),
        allowStitch: tiktok.mediaType !== "photo" && (tiktok.allowStitch ?? false),
        brandContent: tiktok.brandContent ?? false,
        brandOrganic: tiktok.brandOrganic ?? false,
        isAigc: tiktok.isAigc ?? false,
        consent: tiktok.consent === true,
      };
    }
    if (account.platform === "facebook" && platform?.facebook?.target === "reel") {
      variant.facebook = {
        target: "reel",
        durationSeconds: probe?.durationSeconds ?? 0,
        width: probe?.width ?? 0,
        height: probe?.height ?? 0,
        frameRate: platform.facebook.frameRate ?? 0,
      };
    }
    if (usesInstagramApi(account)) {
      const payload = instagramPayload(platform?.instagram, draft.media);
      if (platform?.instagram) variant.instagram = payload.instagram;
      variant.media = payload.media;
      if (payload.instagram.format === "story" && hasCaptionTarget) {
        variant.text = "";
        delete variant.link;
      }
    }
    if (account.platform === "linkedin" && account.connection === "oauth") {
      const format = platform?.linkedinFormat;
      if (format?.kind === "poll")
        variant.linkedinFormat = {
          ...format,
          question: format.question.trim(),
          options: format.options.map((option) => option.trim()).filter(Boolean),
        };
      if (format?.kind === "article")
        variant.linkedinFormat = {
          kind: format.kind,
          source: format.source.trim(),
          title: format.title.trim(),
          ...(format.description?.trim() ? { description: format.description.trim() } : {}),
        };
    }
    if (account.platform === "facebook" && platform?.facebook?.target === "story")
      variant.facebook = { target: "story" };
    if (account.platform === "facebook" && platform?.facebook?.target === "video")
      variant.facebook = { target: "video" };
    const native = platform?.facebook?.scheduledPublishAt;
    const target = platform?.facebook?.target;
    if (account.platform === "facebook" && native && (target === "feed" || target === "video"))
      variant.facebook = { target, scheduledPublishAt: new Date(native).getTime() };
    return variant;
  });
}

export function isScheduledDraft(draft: ContentDraft): boolean {
  return (
    draft.when === "later" ||
    draft.accountIds.some((id) => {
      const facebook = draft.platform[id]?.facebook;
      return (
        facebook?.scheduledPublishAt && (facebook.target === "feed" || facebook.target === "video")
      );
    })
  );
}

/** Button label for the single publish action. */
export function publishLabel(draft: ContentDraft): string {
  return isScheduledDraft(draft) ? t("Schedule") : t("Publish");
}
