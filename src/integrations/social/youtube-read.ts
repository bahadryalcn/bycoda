import {
  type SocialErrorCode,
  SocialHttp,
  SocialPlatformError,
  type SocialAccount,
} from "./adapter";
import type { YouTubeQuota } from "./youtube-quota";

const endpoint = "https://www.googleapis.com/youtube/v3/";
const videoIdPattern = /^[\w-]{11}$/;

/** Reads the connected channel and requires it to be the configured account. */
export async function getYouTubeProfile(
  http: SocialHttp,
  account: SocialAccount,
  token: string,
  quota: YouTubeQuota,
): Promise<{ name: string; username?: string; followers?: number }> {
  quota.charge("channels.list");
  const { value } = await http.request(
    `${endpoint}channels?part=id,snippet,statistics&mine=true`,
    token,
  );
  if (value.items?.length !== 1 || value.items[0]?.id !== account.platformId)
    throw new SocialPlatformError("denied");
  const channel = value.items[0];
  const followers = Number(channel.statistics?.subscriberCount);
  const username =
    typeof channel.snippet?.customUrl === "string" ? channel.snippet.customUrl : undefined;
  return {
    name: typeof channel.snippet?.title === "string" ? channel.snippet.title : account.name,
    ...(username ? { username } : {}),
    // Hidden subscriber counts are omitted rather than reported as zero.
    ...(Number.isFinite(followers) && channel.statistics?.hiddenSubscriberCount !== true
      ? { followers }
      : {}),
  };
}

/** Session check for the connected channel. Errors are reported as codes, never thrown. */
export async function checkYouTubeSession(
  http: SocialHttp,
  account: SocialAccount,
  token: string,
  quota: YouTubeQuota,
): Promise<{ ok: boolean; code?: SocialErrorCode }> {
  try {
    await getYouTubeProfile(http, account, token, quota);
    return { ok: true };
  } catch (error) {
    if (error instanceof SocialPlatformError) return { ok: false, code: error.code };
    return { ok: false, code: "unknown" };
  }
}

/** View, like and comment counts for owned videos (videos.list statistics, up to 50 per call). */
export async function getYouTubeStatistics(
  http: SocialHttp,
  token: string,
  quota: YouTubeQuota,
  videoIds: string[],
): Promise<Record<string, { views?: number; likes?: number; comments?: number }>> {
  if (videoIds.some((id) => !videoIdPattern.test(id))) throw new SocialPlatformError("rejected");
  const result: Record<string, { views?: number; likes?: number; comments?: number }> = {};
  for (let index = 0; index < videoIds.length; index += 50) {
    const chunk = videoIds.slice(index, index + 50);
    quota.charge("videos.list");
    const { value } = await http.request(
      `${endpoint}videos?${new URLSearchParams({ part: "statistics", id: chunk.join(",") })}`,
      token,
    );
    for (const item of value.items ?? []) {
      if (typeof item?.id !== "string" || !chunk.includes(item.id)) continue;
      const stats = item.statistics ?? {};
      const entry: { views?: number; likes?: number; comments?: number } = {};
      const views = Number(stats.viewCount);
      const likes = Number(stats.likeCount);
      const comments = Number(stats.commentCount);
      if (Number.isFinite(views)) entry.views = views;
      if (Number.isFinite(likes)) entry.likes = likes;
      if (Number.isFinite(comments)) entry.comments = comments;
      result[item.id] = entry;
    }
  }
  return result;
}
