import { SocialHttp, SocialPlatformError } from "./adapter";
import type { YouTubeQuota } from "./youtube-quota";

const endpoint = "https://www.googleapis.com/youtube/v3/";
const videoIdPattern = /^[\w-]{11}$/;
const resourceIdPattern = /^[\w-]{1,300}$/;
/** shortcut: thumbnail limit as published by YouTube (2 MB, JPEG or PNG); verify before release. */
const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;

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
  if (!resourceIdPattern.test(commentId) || !moderationStatuses.includes(status))
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
  if (!videoIdPattern.test(videoId)) throw new SocialPlatformError("rejected");
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!jpeg && !png) throw new SocialPlatformError("unsupported");
  if (bytes.length > THUMBNAIL_MAX_BYTES) throw new SocialPlatformError("unsupported");
  quota.charge("thumbnails.set");
  await http.request(
    `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?${new URLSearchParams({ videoId, uploadType: "media" })}`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": jpeg ? "image/jpeg" : "image/png" },
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
  if (!resourceIdPattern.test(playlistId) || !videoIdPattern.test(videoId))
    throw new SocialPlatformError("rejected");
  quota.charge("playlistItems.insert");
  const { value } = await http.json(`${endpoint}playlistItems?part=snippet`, token, {
    snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } },
  });
  if (typeof value.id !== "string" || !resourceIdPattern.test(value.id))
    throw new SocialPlatformError("unknown");
  return value.id;
}
