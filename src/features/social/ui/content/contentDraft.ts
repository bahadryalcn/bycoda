import type {
  SocialCampaign,
  SocialAccount,
  SocialMedia,
  TikTokVideoOptions,
  YouTubeVideoOptions,
} from "../../model/social";
import type { InstagramPublishOptions } from "../../../../integrations/social/adapters/instagram-publish";
import { hasXPostExtras, type XPostExtras } from "../../../../integrations/social/x-publish";

/** Read from the local file before upload (video only). Never sent to the Host. */
export type MediaProbe = { durationSeconds?: number; width?: number; height?: number };

/** One attached file. `media` is exactly what the Host variant receives. */
export type ContentMedia = {
  localId: string;
  name: string;
  media: SocialMedia;
  probe?: MediaProbe;
  /** Managed media claim, released when the attachment is removed. */
  mediaId?: string;
};

export type FacebookDraft = { target: "feed" | "reel"; frameRate?: number };
export type RedditDraft = { subreddit: string; flair: string };
export type InstagramTagDraft = {
  id: string;
  localMediaId?: string;
  username: string;
  x?: number;
  y?: number;
};
export type InstagramDraft = Omit<InstagramPublishOptions, "userTags"> & {
  userTags?: InstagramTagDraft[];
  altText?: Record<string, string>;
};
export type XPostDraft = {
  quotePostId?: string;
  communityId?: string;
  poll?: { options: string; durationMinutes: string };
  thread?: string[];
};

/** Platform options the owner sets per account. Only fields the Host accepts reach a variant. */
export type PlatformDraft = {
  tiktok?: Partial<Omit<TikTokVideoOptions, "durationSeconds">>;
  youtube?: Partial<YouTubeVideoOptions>;
  facebook?: FacebookDraft;
  instagram?: InstagramDraft;
  x?: XPostDraft;
  /** Kept in the draft for review; the Host has no Reddit variant field yet (see contentRules). */
  reddit?: RedditDraft;
};

export type UtmDraft = { source: string; medium: string; campaign: string };
export type RepeatDraft = {
  enabled: boolean;
  minMinutes: number;
  maxMinutes: number;
  totalPosts: number;
};

export type ContentDraft = {
  /** Set when the draft was loaded from a saved campaign; saving then revises it. */
  campaignId?: string;
  revision?: number;
  name: string;
  text: string;
  link: string;
  accountIds: string[];
  media: ContentMedia[];
  when: "now" | "later";
  /** Local `YYYY-MM-DDTHH:mm`, the native datetime value; empty until chosen. */
  scheduledAt: string;
  factIds: string[];
  utm: UtmDraft;
  repeat: RepeatDraft;
  platform: Record<string, PlatformDraft>;
};

export const DEFAULT_REPEAT: RepeatDraft = {
  enabled: false,
  minMinutes: 120,
  maxMinutes: 300,
  totalPosts: 10,
};

export function emptyDraft(): ContentDraft {
  return {
    name: "",
    text: "",
    link: "",
    accountIds: [],
    media: [],
    when: "now",
    scheduledAt: "",
    factIds: [],
    utm: { source: "", medium: "", campaign: "" },
    repeat: { ...DEFAULT_REPEAT },
    platform: {},
  };
}

/** The post's own name: the campaign name, else its first line, else a fixed fallback. */
export function draftName(draft: ContentDraft): string {
  const name = draft.name.trim();
  if (name) return name;
  const firstLine = draft.text.trim().split("\n")[0]?.trim() ?? "";
  return firstLine ? Array.from(firstLine).slice(0, 60).join("") : "Post";
}

/**
 * Adds UTM parameters to a link. An empty or unparseable link is returned unchanged; the
 * blockers reject a link that is not a valid URL before publishing.
 */
export function withUtm(link: string, utm: UtmDraft): string {
  const trimmed = link.trim();
  if (!trimmed) return "";
  const pairs: [string, string][] = [
    ["utm_source", utm.source.trim()],
    ["utm_medium", utm.medium.trim()],
    ["utm_campaign", utm.campaign.trim()],
  ];
  if (!pairs.some(([, value]) => value)) return trimmed;
  try {
    const url = new URL(trimmed);
    for (const [key, value] of pairs) if (value) url.searchParams.set(key, value);
    return url.toString();
  } catch {
    return trimmed;
  }
}

/** Local datetime text to epoch milliseconds. `undefined` means "now"; `NaN` means unusable. */
export function scheduledMs(draft: ContentDraft): number | undefined {
  if (draft.when === "now") return undefined;
  if (!draft.scheduledAt) return Number.NaN;
  return new Date(draft.scheduledAt).getTime();
}

function withoutDuration(
  options: TikTokVideoOptions,
): Partial<Omit<TikTokVideoOptions, "durationSeconds">> {
  const copy: Partial<TikTokVideoOptions> = { ...options };
  delete copy.durationSeconds;
  return copy;
}

/** Convert exact editor strings into validated Host fields only at the variant boundary. */
export function xPostExtras(draft: XPostDraft | undefined): XPostExtras | undefined {
  if (!draft) return undefined;
  const lines = (value: string) =>
    value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  const quotePostId = draft.quotePostId?.trim();
  const communityId = draft.communityId?.trim();
  const extras: XPostExtras = {
    ...(quotePostId ? { quotePostId } : {}),
    ...(communityId ? { communityId } : {}),
    ...(draft.poll
      ? {
          poll: {
            options: lines(draft.poll.options),
            durationMinutes: Number(draft.poll.durationMinutes),
          },
        }
      : {}),
    ...(draft.thread?.length ? { thread: [...draft.thread] } : {}),
  };
  return hasXPostExtras(extras) ? extras : undefined;
}

/** Maps a saved campaign to an editable draft. Media keeps its upload identity and metadata. */
export function draftFromCampaign(
  campaign: SocialCampaign,
  accounts: SocialAccount[] = [],
): ContentDraft {
  const first = campaign.variants[0];
  const caption =
    campaign.variants.find((variant) => variant.instagram?.format !== "story") ?? first;
  const firstAccount = accounts.find((account) => account.id === first?.accountId);
  const igFirst =
    first?.instagram !== undefined ||
    (firstAccount?.platform === "instagram" && firstAccount.connection !== "browser");
  const media: ContentMedia[] = (first?.media ?? []).map((asset, index, items) => {
    const identity = asset.uploadId ?? asset.url;
    const duplicate =
      identity && items.findIndex((item) => (item.uploadId ?? item.url) === identity) !== index;
    const baseAsset = { ...asset };
    if (igFirst) delete baseAsset.alt;
    return {
      localId: identity && !duplicate ? identity : `saved-${index}`,
      name: asset.title ?? asset.url ?? asset.kind,
      media: baseAsset,
    };
  });
  const platform: Record<string, PlatformDraft> = {};
  for (const variant of campaign.variants) {
    const entry: PlatformDraft = {};
    const account = accounts.find((account) => account.id === variant.accountId);
    if (
      variant.instagram ||
      (account?.platform === "instagram" && account.connection !== "browser")
    ) {
      const { userTags, collaborators, ...options } = variant.instagram ?? {};
      const mediaKey = (index: number) => {
        const asset = variant.media[index];
        const shared = media[index];
        if (!asset || !shared) return undefined;
        if (asset.uploadId === shared.media.uploadId && asset.url === shared.media.url)
          return shared.localId;
        return media.find(
          (item) => item.media.uploadId === asset.uploadId && item.media.url === asset.url,
        )?.localId;
      };
      entry.instagram = {
        ...options,
        ...(collaborators ? { collaborators: [...collaborators] } : {}),
        ...(userTags
          ? {
              userTags: userTags.map(({ username, x, y, mediaIndex }, index) => ({
                id: `saved-tag-${index}`,
                localMediaId: mediaKey(mediaIndex ?? 0),
                username,
                x,
                y,
              })),
            }
          : {}),
        altText: Object.fromEntries(
          variant.media.flatMap((asset, index) => {
            const key = mediaKey(index);
            return key && asset.alt ? [[key, asset.alt]] : [];
          }),
        ),
      };
    }
    if (variant.youtube) entry.youtube = { ...variant.youtube };
    if (variant.tiktok) entry.tiktok = withoutDuration(variant.tiktok);
    if (variant.facebook)
      entry.facebook = { target: "reel", frameRate: variant.facebook.frameRate };
    if (variant.x)
      entry.x = {
        quotePostId: variant.x.quotePostId,
        communityId: variant.x.communityId,
        poll: variant.x.poll && {
          options: variant.x.poll.options.join("\n"),
          durationMinutes: String(variant.x.poll.durationMinutes),
        },
        thread: variant.x.thread && [...variant.x.thread],
      };
    platform[variant.accountId] = entry;
  }
  // The media is one file shared by every variant, so its size and length come from whichever
  // variant carries them, not necessarily the first (a YouTube variant carries none).
  const sized =
    campaign.variants.find((variant) => variant.facebook) ??
    campaign.variants.find((variant) => variant.tiktok);
  const probe: MediaProbe | undefined = sized?.facebook
    ? {
        durationSeconds: sized.facebook.durationSeconds,
        width: sized.facebook.width,
        height: sized.facebook.height,
      }
    : sized?.tiktok
      ? { durationSeconds: sized.tiktok.durationSeconds }
      : undefined;
  const scheduled = first?.scheduledAt;
  return {
    campaignId: campaign.id,
    revision: campaign.revision,
    name: campaign.name,
    text: caption?.text ?? "",
    link: caption?.link ?? "",
    accountIds: campaign.variants.map((variant) => variant.accountId),
    media: media.map((item) => ({
      ...item,
      probe: item.media.kind === "video" ? probe : undefined,
    })),
    // A saved time that has passed reopens as "Now"; the owner picks a new time before scheduling.
    when: scheduled && scheduled > Date.now() ? "later" : "now",
    scheduledAt: scheduled ? toLocalInput(scheduled) : "",
    factIds: [...(first?.factIds ?? [])],
    utm: { source: "", medium: "", campaign: "" },
    repeat: { ...DEFAULT_REPEAT },
    platform,
  };
}

function toLocalInput(at: number): string {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function toggleAccount(ids: string[], accountId: string): string[] {
  return ids.includes(accountId) ? ids.filter((id) => id !== accountId) : [...ids, accountId];
}

export function setPlatform(
  draft: ContentDraft,
  accountId: string,
  patch: PlatformDraft,
): ContentDraft {
  return {
    ...draft,
    platform: { ...draft.platform, [accountId]: { ...draft.platform[accountId], ...patch } },
  };
}

/** Plain media item for the Host. Used by the variant builder and the blockers. */
export function mediaOf(items: ContentMedia[]): SocialMedia[] {
  return items.map((item) => item.media);
}
