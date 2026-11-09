import { t } from "../../../../shared/i18n";
import {
  SOCIAL_PLATFORM_NAMES,
  type CampaignVariant,
  type Capability,
  type SocialAccount,
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
  type ContentDraft,
  type ContentMedia,
  type FacebookDraft,
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
  return configured;
}

/** Platform count: text plus link. Telegram channel bot posts count UTF-16 units. */
export function characterCount(account: SocialAccount, text: string, link?: string): number {
  const content = [text, link].filter(Boolean).join("\n");
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

function videoProbe(media: ContentMedia[]): MediaProbe | undefined {
  return media.find((item) => item.media.kind === "video")?.probe;
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

export function tiktokProblems(
  options: PlatformDraft["tiktok"],
  media: ContentMedia[],
  creator?: TikTokCreatorInfo,
): string[] {
  const problems: string[] = [];
  if (!options?.privacy) problems.push(t("Choose who can see the TikTok video."));
  else if (creator && !creator.privacyOptions.includes(options.privacy))
    problems.push(t("Choose a privacy option your TikTok account offers."));
  if (options?.consent !== true) problems.push(t("Confirm the TikTok content consent."));
  const duration = videoProbe(media)?.durationSeconds;
  if (!duration) problems.push(t("The video length could not be read."));
  else if (creator && duration > creator.maxDurationSeconds)
    problems.push(t("This video is longer than your TikTok account allows."));
  return problems;
}

export function youtubeProblems(options: PlatformDraft["youtube"]): string[] {
  const problems: string[] = [];
  const title = options?.title?.trim() ?? "";
  if (!title) problems.push(t("Enter a YouTube title."));
  else if (Array.from(title).length > YOUTUBE_TITLE_MAX)
    problems.push(t("YouTube titles can be at most {p0} characters.", { p0: YOUTUBE_TITLE_MAX }));
  if (!options?.privacy) problems.push(t("Choose YouTube privacy."));
  if (options?.madeForKids === undefined)
    problems.push(t("Say whether the video is made for kids."));
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
  if (!draft.text.trim() && !draft.media.length)
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
  for (const account of selectedAccounts(draft, input.accounts)) {
    const name = accountLabel(account);
    const add = (text: string) =>
      problems.push({ text: `${name}: ${text}`, accountId: account.id });
    const availability = accountAvailability(account, input);
    if (availability.disabled) add(availability.reason!);
    const limit = characterLimit(account, input.snapshot?.policies, {
      reel: draft.platform[account.id]?.facebook?.target === "reel",
      hasMedia: draft.media.length > 0,
    });
    const count = characterCount(account, draft.text.trim(), withUtm(link, draft.utm));
    if (limit !== undefined && count > limit)
      add(t("Content for this account can be at most {p0} characters.", { p0: limit }));
    for (const text of mediaProblems(account.platform, draft.media)) add(text);
    const platform = draft.platform[account.id];
    if (account.platform === "facebook")
      for (const text of reelProblems(platform?.facebook, draft.media)) add(text);
    if (account.platform === "tiktok")
      for (const text of tiktokProblems(platform?.tiktok, draft.media, input.creator?.[account.id]))
        add(text);
    if (account.platform === "youtube")
      for (const text of youtubeProblems(platform?.youtube)) add(text);
    if (account.platform === "reddit")
      for (const text of redditProblems(platform?.reddit)) add(text);
  }
  return problems;
}

export function selectedAccounts(draft: ContentDraft, accounts: SocialAccount[]): SocialAccount[] {
  return draft.accountIds
    .map((id) => accounts.find((account) => account.id === id))
    .filter((account): account is SocialAccount => account !== undefined);
}

/** The Host variants for a valid draft. Call only when `draftProblems` returned nothing. */
export function buildVariants(input: RuleInput): CampaignVariant[] {
  const { draft, now } = input;
  const scheduled = scheduledMs(draft);
  const at = scheduled !== undefined && Number.isFinite(scheduled) ? scheduled : now;
  const link = withUtm(draft.link, draft.utm) || undefined;
  const media = mediaOf(draft.media);
  const probe = videoProbe(draft.media);
  return selectedAccounts(draft, input.accounts).map((account) => {
    const platform = draft.platform[account.id];
    const variant: CampaignVariant = {
      accountId: account.id,
      text: draft.text.trim(),
      media,
      ...(link ? { link } : {}),
      scheduledAt: at,
      factIds: [...draft.factIds],
    };
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
        privacy: tiktok.privacy ?? "",
        durationSeconds: probe?.durationSeconds ?? 0,
        allowComment: tiktok.allowComment ?? false,
        allowDuet: tiktok.allowDuet ?? false,
        allowStitch: tiktok.allowStitch ?? false,
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
    return variant;
  });
}

/** Button label for the single publish action. */
export function publishLabel(draft: ContentDraft): string {
  return draft.when === "now" ? t("Publish") : t("Schedule");
}
