import type { SocialAdapter, SocialInbound } from "./adapter";
import { SocialHttp, SocialPlatformError } from "./adapter";

const endpoint = "https://www.googleapis.com/youtube/v3/";
const identity = (value: unknown): string => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,300}$/.test(value))
    throw new SocialPlatformError("rejected");
  return value;
};
const resultIdentity = (value: unknown): string => {
  try {
    return identity(value);
  } catch {
    throw new SocialPlatformError("unknown");
  }
};
type ReplyPage = {
  root: string;
  video: string;
  allowed: boolean;
  page?: string;
};
type Cursor = { page?: string; replies: ReplyPage[] };
function cursorState(cursor?: string): Cursor {
  try {
    const value = JSON.parse(cursor ?? "{}");
    if (
      Array.isArray(value.replies) &&
      value.replies.length <= 100 &&
      (!value.page || typeof value.page === "string")
    )
      return value;
  } catch {
    /* First scan. */
  }
  return { replies: [] };
}
export function createYouTubeAdapter(http: SocialHttp): SocialAdapter {
  return {
    async send(account, job, token, media) {
      const content = [job.payload.text, job.payload.link].filter(Boolean).join("\n");
      if (job.kind === "publish") {
        const options = job.payload.youtube;
        const asset = job.payload.media[0];
        if (
          !options ||
          !asset?.uploadId ||
          asset.kind !== "video" ||
          job.payload.media.length !== 1
        )
          throw new SocialPlatformError("unsupported");
        // Verify the current credential still represents the configured channel.
        const { value: channel } = await http.request(
          `${endpoint}channels?part=id&mine=true`,
          token,
        );
        if (channel.items?.length !== 1 || channel.items[0].id !== account.platformId)
          throw new SocialPlatformError("denied");
        const { value } = await http.uploadYouTubeVideo(
          token,
          {
            snippet: {
              title: options.title,
              description: content,
              categoryId: "22",
            },
            status: {
              privacyStatus: options.privacy,
              selfDeclaredMadeForKids: options.madeForKids,
              containsSyntheticMedia: options.containsSyntheticMedia,
            },
          },
          await media(asset.uploadId),
        );
        const platformId = resultIdentity(value.id);
        const visibility = value.status?.privacyStatus;
        if (!["private", "unlisted", "public"].includes(visibility))
          throw new SocialPlatformError("unknown");
        return {
          platformId,
          url: `https://www.youtube.com/watch?v=${platformId}`,
          visibility,
        };
      }
      if (job.kind === "message" || !job.payload.postId || job.payload.media.length)
        throw new SocialPlatformError("unsupported");
      if (job.kind === "reply") {
        const parent = identity(job.payload.postId);
        const { value } = await http.json(`${endpoint}comments?part=snippet`, token, {
          snippet: { parentId: parent, textOriginal: content },
        });
        const platformId = resultIdentity(value.id);
        return {
          platformId,
          ...(job.payload.objectPostId
            ? {
                url: `https://www.youtube.com/watch?v=${identity(job.payload.objectPostId)}&lc=${platformId}`,
              }
            : {}),
        };
      }
      const video = identity(job.payload.postId);
      const { value: target } = await http.request(
        `${endpoint}videos?part=snippet&id=${video}`,
        token,
      );
      if (target.items?.length !== 1 || target.items[0].id !== video)
        throw new SocialPlatformError("denied");
      const channel = identity(target.items[0].snippet?.channelId);
      if (!job.payload.recipientId || channel !== job.payload.recipientId)
        throw new SocialPlatformError("denied");
      const { value } = await http.json(`${endpoint}commentThreads?part=snippet`, token, {
        snippet: {
          channelId: channel,
          videoId: video,
          topLevelComment: { snippet: { textOriginal: content } },
        },
      });
      const platformId = resultIdentity(value.snippet?.topLevelComment?.id);
      return {
        platformId,
        url: `https://www.youtube.com/watch?v=${video}&lc=${platformId}`,
      };
    },
    async poll(account, token, _posts, cursor) {
      const state = cursorState(cursor);
      const events: SocialInbound[] = [];
      const add = (comment: Record<string, any>, root: string, video: string, allowed: boolean) => {
        const snippet = comment.snippet;
        const author = snippet?.authorChannelId?.value;
        if (!author || author === account.platformId) return;
        const timestamp = Date.parse(snippet.updatedAt ?? snippet.publishedAt);
        if (!Number.isFinite(timestamp)) throw new SocialPlatformError("rejected");
        events.push({
          eventId: identity(comment.id),
          threadId: root,
          postId: video,
          contactId: identity(author),
          contactName: String(snippet.authorDisplayName ?? author),
          text: String(snippet.textOriginal ?? snippet.textDisplay ?? ""),
          at: timestamp,
          kind: "comment",
          replyAllowed: allowed,
        });
      };
      let budget = 4;
      if (!state.replies.length) {
        const params = new URLSearchParams({
          part: "snippet",
          allThreadsRelatedToChannelId: identity(account.platformId),
          maxResults: "100",
          order: "time",
          textFormat: "plainText",
          ...(state.page ? { pageToken: state.page } : {}),
        });
        const { value } = await http.request(`${endpoint}commentThreads?${params}`, token);
        budget--;
        state.page = typeof value.nextPageToken === "string" ? value.nextPageToken : undefined;
        for (const thread of value.items ?? []) {
          const snippet = thread.snippet;
          // Only this channel's videos; channel-level/foreign threads need a separate product contract.
          if (
            snippet?.channelId !== account.platformId ||
            !snippet.videoId ||
            !snippet.topLevelComment
          )
            continue;
          const root = identity(snippet.topLevelComment.id),
            video = identity(snippet.videoId);
          const allowed = snippet.canReply === true;
          add(snippet.topLevelComment, root, video, allowed);
          if (snippet.totalReplyCount > 0) state.replies.push({ root, video, allowed });
        }
      }
      while (budget-- > 0 && state.replies.length) {
        const current = state.replies[0];
        const params = new URLSearchParams({
          part: "snippet",
          parentId: identity(current.root),
          maxResults: "100",
          textFormat: "plainText",
          ...(current.page ? { pageToken: current.page } : {}),
        });
        const { value } = await http.request(`${endpoint}comments?${params}`, token);
        for (const comment of value.items ?? [])
          add(comment, current.root, current.video, current.allowed);
        if (typeof value.nextPageToken === "string" && value.nextPageToken)
          current.page = value.nextPageToken;
        else state.replies.shift();
      }
      return { events, cursor: JSON.stringify(state) };
    },
  };
}
