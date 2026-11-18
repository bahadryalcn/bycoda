import { SocialPlatformError, type SocialHttp } from "./adapter";
import { setYouTubeCommentModeration, type YouTubeCommentStatus } from "./youtube-manage";
import type { YouTubeQuota } from "./youtube-quota";

const comments = "https://www.googleapis.com/youtube/v3/comments";
const commentThreads = "https://www.googleapis.com/youtube/v3/commentThreads";
const commentIdPattern = /^[\w-]{1,300}$/;
const channelIdPattern = /^UC[\w-]{22}$/;
const videoIdPattern = /^[\w-]{11}$/;
const listStatuses = ["published", "heldForReview", "likelySpam"] as const;
const writeStatuses: readonly YouTubeCommentStatus[] = ["published", "heldForReview", "rejected"];
type YouTubeCommentFilter = (typeof listStatuses)[number];
type YouTubeComment = {
  id: string;
  authorChannelId?: string;
  authorName: string;
  text: string;
  publishedAt?: string;
  moderationStatus?: YouTubeCommentFilter | "rejected";
  parentId?: string;
  videoId?: string;
  replyCount?: number;
};

function matching(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function commentRow(item: Record<string, any>): YouTubeComment | undefined {
  const id = matching(item?.id, commentIdPattern);
  const snippet = item?.snippet;
  if (!id || !snippet || typeof snippet.textDisplay !== "string") return;
  const status = snippet.moderationStatus;
  return {
    id,
    authorChannelId: matching(snippet.authorChannelId?.value, channelIdPattern),
    authorName: typeof snippet.authorDisplayName === "string" ? snippet.authorDisplayName : "",
    text: snippet.textDisplay,
    publishedAt: typeof snippet.publishedAt === "string" ? snippet.publishedAt : undefined,
    moderationStatus: status === "rejected" || listStatuses.includes(status) ? status : undefined,
    parentId: matching(snippet.parentId, commentIdPattern),
  };
}

async function commentById(
  http: SocialHttp,
  token: string,
  quota: YouTubeQuota,
  commentId: string,
) {
  const query = new URLSearchParams({ id: commentId, part: "snippet", textFormat: "plainText" });
  quota.charge("comments.list");
  const { value } = await http.request(`${comments}?${query}`, token);
  const item = Array.isArray(value.items) && value.items.length === 1 ? value.items[0] : undefined;
  if (item?.id !== commentId) throw new SocialPlatformError("denied");
  return item;
}

export async function getYouTubeCommentTarget(
  http: SocialHttp,
  token: string,
  quota: YouTubeQuota,
  channelId: string,
  commentId: string,
) {
  if (!matching(channelId, channelIdPattern) || !matching(commentId, commentIdPattern))
    throw new SocialPlatformError("rejected");
  const item = await commentById(http, token, quota, commentId);
  const authorChannelId = matching(item.snippet?.authorChannelId?.value, channelIdPattern);
  if (!authorChannelId || item.snippet?.channelId !== channelId)
    throw new SocialPlatformError("denied");
  const parentId = matching(item.snippet.parentId, commentIdPattern);
  const rootId = parentId ?? commentId;
  quota.charge("commentThreads.list");
  const { value } = await http.request(
    `${commentThreads}?${new URLSearchParams({ id: rootId, part: "snippet" })}`,
    token,
  );
  const thread =
    Array.isArray(value.items) && value.items.length === 1 ? value.items[0]?.snippet : undefined;
  if (thread && (thread.channelId !== channelId || thread.topLevelComment?.id !== rootId))
    throw new SocialPlatformError("denied");
  return {
    commentId,
    authorChannelId,
    channelId,
    videoId: matching(thread?.videoId, videoIdPattern),
    parentId,
  };
}

export async function listYouTubeComments(
  http: SocialHttp,
  token: string,
  quota: YouTubeQuota,
  channelId: string,
  options: {
    cursor?: string;
    status?: YouTubeCommentFilter;
    videoId?: string;
    parentId?: string;
  } = {},
): Promise<{ comments: YouTubeComment[]; next?: string }> {
  const { cursor, status, videoId, parentId } = options;
  if (
    !matching(channelId, channelIdPattern) ||
    (cursor !== undefined && (typeof cursor !== "string" || !cursor || cursor.length > 1_000)) ||
    (videoId !== undefined && !matching(videoId, videoIdPattern)) ||
    (parentId !== undefined &&
      (!matching(parentId, commentIdPattern) || status !== undefined || videoId !== undefined)) ||
    (status !== undefined && !listStatuses.includes(status))
  )
    throw new SocialPlatformError("rejected");
  const query = new URLSearchParams({ part: "snippet", maxResults: "50", textFormat: "plainText" });
  if (cursor) query.set("pageToken", cursor);
  if (parentId) {
    const parent = await commentById(http, token, quota, parentId);
    if (parent.snippet?.channelId !== channelId || parent.snippet?.parentId !== undefined)
      throw new SocialPlatformError("denied");
    query.set("parentId", parentId);
    quota.charge("comments.list");
    const { value } = await http.request(`${comments}?${query}`, token);
    if (!Array.isArray(value.items)) throw new SocialPlatformError("unknown");
    return {
      comments: value.items.flatMap((item: Record<string, any>) => {
        const row = commentRow(item);
        return row?.parentId === parentId && item.snippet.channelId === channelId ? [row] : [];
      }),
      next: typeof value.nextPageToken === "string" ? value.nextPageToken : undefined,
    };
  }
  query.set(videoId ? "videoId" : "allThreadsRelatedToChannelId", videoId ?? channelId);
  if (status) query.set("moderationStatus", status);
  quota.charge("commentThreads.list");
  const { value } = await http.request(`${commentThreads}?${query}`, token);
  if (!Array.isArray(value.items)) throw new SocialPlatformError("unknown");
  return {
    comments: value.items.flatMap((item: Record<string, any>) => {
      const snippet = item?.snippet;
      if (snippet?.channelId !== channelId || (videoId && snippet.videoId !== videoId)) return [];
      const row = commentRow(snippet.topLevelComment);
      return row
        ? [
            {
              ...row,
              videoId: matching(snippet.videoId, videoIdPattern),
              replyCount:
                typeof snippet.totalReplyCount === "number" ? snippet.totalReplyCount : undefined,
            },
          ]
        : [];
    }),
    next: typeof value.nextPageToken === "string" ? value.nextPageToken : undefined,
  };
}

export async function moderateYouTubeComment(
  http: SocialHttp,
  token: string,
  quota: YouTubeQuota,
  commentId: string,
  status: YouTubeCommentStatus,
  banAuthor = false,
  beforeWrite?: () => Promise<void>,
): Promise<void> {
  if (
    typeof banAuthor !== "boolean" ||
    !matching(commentId, commentIdPattern) ||
    !writeStatuses.includes(status) ||
    (banAuthor && status !== "rejected")
  )
    throw new SocialPlatformError("rejected");
  await beforeWrite?.();
  if (!banAuthor) return setYouTubeCommentModeration(http, token, quota, commentId, status);
  const params = new URLSearchParams({
    id: commentId,
    moderationStatus: status,
    banAuthor: "true",
  });
  quota.charge("comments.setModerationStatus");
  await http.request(`${comments}/setModerationStatus?${params}`, token, { method: "POST" });
}

/** Deletion belongs to the author. Channel moderation rejects other authors' comments. */
export async function deleteYouTubeComment(
  http: SocialHttp,
  token: string,
  quota: YouTubeQuota,
  channelId: string,
  commentId: string,
  confirmed: boolean,
  beforeWrite?: () => Promise<void>,
): Promise<void> {
  if (
    confirmed !== true ||
    !matching(channelId, channelIdPattern) ||
    !matching(commentId, commentIdPattern)
  )
    throw new SocialPlatformError("rejected");
  const item = await commentById(http, token, quota, commentId);
  if (item.snippet?.authorChannelId?.value !== channelId) throw new SocialPlatformError("denied");
  await beforeWrite?.();
  quota.charge("comments.delete");
  await http.request(`${comments}?${new URLSearchParams({ id: commentId })}`, token, {
    method: "DELETE",
  });
}
