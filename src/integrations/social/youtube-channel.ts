import { SocialPlatformError } from "./adapter";
import {
  readOwnedYouTubeChannel,
  type YouTubeManagementContext,
  youtubeImageMime,
} from "./youtube-manage";

const bannerMaxBytes = 6 * 1024 * 1024;
const readParts = "id,snippet,brandingSettings,status";
const writableBrandingFields = [
  "country",
  "description",
  "defaultLanguage",
  "keywords",
  "trackingAnalyticsAccountId",
  "unsubscribedTrailer",
] as const;

export type YouTubeChannelPatch = {
  description?: string;
  keywords?: string;
  country?: string;
  banner?: Uint8Array;
  madeForKids?: boolean;
};

export type YouTubeChannelProfile = {
  id: string;
  name: string;
  handle?: string;
  description: string;
  keywords: string;
  country?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  madeForKids?: boolean;
};

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password) return url.href;
  } catch {
    return undefined;
  }
}

function profileFromChannel(channel: Record<string, any>): YouTubeChannelProfile {
  const branding = channel.brandingSettings?.channel;
  const snippet = channel.snippet;
  return {
    id: channel.id,
    name: typeof snippet?.title === "string" ? snippet.title : "",
    handle:
      typeof snippet?.customUrl === "string" && snippet.customUrl.startsWith("@")
        ? snippet.customUrl
        : undefined,
    description:
      typeof branding?.description === "string"
        ? branding.description
        : String(snippet?.description ?? ""),
    keywords: typeof branding?.keywords === "string" ? branding.keywords : "",
    country: typeof branding?.country === "string" ? branding.country : undefined,
    avatarUrl: httpsUrl(snippet?.thumbnails?.high?.url ?? snippet?.thumbnails?.default?.url),
    bannerUrl: httpsUrl(channel.brandingSettings?.image?.bannerExternalUrl),
    madeForKids:
      typeof channel.status?.selfDeclaredMadeForKids === "boolean"
        ? channel.status.selfDeclaredMadeForKids
        : undefined,
  };
}

export async function getYouTubeChannel(
  context: YouTubeManagementContext,
): Promise<YouTubeChannelProfile> {
  return profileFromChannel(await readOwnedYouTubeChannel(context, readParts));
}

/** Changes writable channel settings and retains untouched branding fields. */
export async function updateYouTubeChannel(
  context: YouTubeManagementContext,
  { description, keywords, country, banner, madeForKids }: YouTubeChannelPatch,
): Promise<YouTubeChannelProfile> {
  const brandingRequested = [description, keywords, country, banner].some(
    (value) => value !== undefined,
  );
  if (
    (!brandingRequested && madeForKids === undefined) ||
    (description !== undefined &&
      (typeof description !== "string" || Array.from(description).length > 1000)) ||
    (keywords !== undefined &&
      (typeof keywords !== "string" || Array.from(keywords).length > 500)) ||
    (country !== undefined && (typeof country !== "string" || !/^[A-Z]{2}$/u.test(country))) ||
    (madeForKids !== undefined && typeof madeForKids !== "boolean")
  )
    throw new SocialPlatformError("rejected");
  const bannerMime = banner === undefined ? undefined : youtubeImageMime(banner, bannerMaxBytes);
  const previous = await readOwnedYouTubeChannel(context, readParts);
  const { http, quota, token, channelId } = context;
  const data: Record<string, unknown> = { id: channelId };
  const parts: string[] = [];
  if (brandingRequested) {
    const branding = previous.brandingSettings;
    const channel = Object.fromEntries(
      writableBrandingFields.flatMap((field) =>
        typeof branding?.channel?.[field] === "string" ? [[field, branding.channel[field]]] : [],
      ),
    );
    if (description !== undefined) channel.description = description;
    if (keywords !== undefined) channel.keywords = keywords;
    if (country !== undefined) channel.country = country;
    let bannerExternalUrl = httpsUrl(branding?.image?.bannerExternalUrl);
    if (banner && bannerMime) {
      await context.beforeWrite?.();
      quota.charge("channelBanners.insert");
      const { value } = await http.request(
        "https://www.googleapis.com/upload/youtube/v3/channelBanners/insert?uploadType=media",
        token,
        { method: "POST", headers: { "Content-Type": bannerMime }, body: new Uint8Array(banner) },
      );
      bannerExternalUrl = httpsUrl(value.url);
      if (!bannerExternalUrl) throw new SocialPlatformError("unknown");
    }
    data.brandingSettings = {
      channel,
      ...(bannerExternalUrl ? { image: { bannerExternalUrl } } : {}),
    };
    parts.push("brandingSettings");
  }
  if (madeForKids !== undefined) {
    data.status = { selfDeclaredMadeForKids: madeForKids };
    parts.push("status");
  }
  await context.beforeWrite?.();
  quota.charge("channels.update");
  const { value } = await http.request(
    `https://www.googleapis.com/youtube/v3/channels?${new URLSearchParams({ part: parts.join(",") })}`,
    token,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) },
  );
  if (value.id !== channelId) throw new SocialPlatformError("unknown");
  return profileFromChannel({ ...previous, ...value });
}
