import { SocialHttp, SocialPlatformError } from "./adapter";
import type { YouTubeQuota } from "./youtube-quota";

const endpoint = "https://www.googleapis.com/youtube/v3/";
export const youtubeVideoIdPattern = /^[\w-]{11}$/;
export const youtubeResourceIdPattern = /^[\w-]{1,300}$/;
const THUMBNAIL_MAX_BYTES = 50 * 1024 * 1024;

export type YouTubeManagementContext = {
  http: SocialHttp;
  token: string;
  quota: YouTubeQuota;
  channelId: string;
  /** Host authority and dispatch fence. Called after reads, immediately before each write. */
  beforeWrite?: () => Promise<void>;
};

export type YouTubePage<T> = { items: T[]; nextPageToken?: string };

export function youtubePageToken(pageToken?: string): Record<string, string> {
  if (pageToken === undefined) return {};
  if (!pageToken || pageToken.length > 2048 || /\s/u.test(pageToken))
    throw new SocialPlatformError("rejected");
  return { pageToken };
}

export async function readOwnedYouTubeChannel(
  { http, quota, token, channelId }: YouTubeManagementContext,
  part: string,
): Promise<Record<string, any>> {
  if (!youtubeResourceIdPattern.test(channelId)) throw new SocialPlatformError("denied");
  quota.charge("channels.list");
  const { value } = await http.request(
    `${endpoint}channels?${new URLSearchParams({ part, mine: "true" })}`,
    token,
  );
  if (!Array.isArray(value.items) || value.items.length !== 1 || value.items[0]?.id !== channelId)
    throw new SocialPlatformError("denied");
  return value.items[0];
}

export function youtubeImageMime(bytes: Uint8Array, maxBytes: number): "image/jpeg" | "image/png" {
  if (!(bytes instanceof Uint8Array) || bytes.length > maxBytes)
    throw new SocialPlatformError("unsupported");
  if ([0xff, 0xd8, 0xff].every((byte, index) => bytes[index] === byte)) return "image/jpeg";
  if (
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)
  )
    return "image/png";
  throw new SocialPlatformError("unsupported");
}

export type YouTubeCommentStatus = "heldForReview" | "published" | "rejected";
const moderationStatuses: readonly YouTubeCommentStatus[] = [
  "heldForReview",
  "published",
  "rejected",
];

/** Sets a comment on an owned video to held for review, published or rejected. */
export async function setYouTubeCommentModeration(
  http: SocialHttp,
  token: string,
  quota: YouTubeQuota,
  commentId: string,
  status: YouTubeCommentStatus,
): Promise<void> {
  if (!youtubeResourceIdPattern.test(commentId) || !moderationStatuses.includes(status))
    throw new SocialPlatformError("rejected");
  quota.charge("comments.setModerationStatus");
  await http.request(
    `${endpoint}comments/setModerationStatus?${new URLSearchParams({ id: commentId, moderationStatus: status })}`,
    token,
    { method: "POST" },
  );
}

/** Uploads a custom thumbnail for an owned video. The bytes are checked by magic number and size. */
export async function setYouTubeThumbnail(
  http: SocialHttp,
  token: string,
  quota: YouTubeQuota,
  videoId: string,
  bytes: Uint8Array,
): Promise<void> {
  if (!youtubeVideoIdPattern.test(videoId)) throw new SocialPlatformError("rejected");
  const mime = youtubeImageMime(bytes, THUMBNAIL_MAX_BYTES);
  quota.charge("thumbnails.set");
  await http.request(
    `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?${new URLSearchParams({ videoId, uploadType: "media" })}`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": mime },
      body: new Uint8Array(bytes),
    },
  );
}

/** Adds an owned or public video to a playlist. Returns the playlist item ID. */
export async function addToYouTubePlaylist(
  http: SocialHttp,
  token: string,
  quota: YouTubeQuota,
  playlistId: string,
  videoId: string,
): Promise<string> {
  if (!youtubeResourceIdPattern.test(playlistId) || !youtubeVideoIdPattern.test(videoId))
    throw new SocialPlatformError("rejected");
  quota.charge("playlistItems.insert");
  const { value } = await http.json(`${endpoint}playlistItems?part=snippet`, token, {
    snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } },
  });
  if (typeof value.id !== "string" || !youtubeResourceIdPattern.test(value.id))
    throw new SocialPlatformError("unknown");
  return value.id;
}
