import type { SocialAccount, SocialJob } from "../../features/social/model/social";
import type { SocialAdapter, SocialInbound, SocialSendResult } from "./adapter";
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
const visibility = (value: unknown): value is "private" | "unlisted" | "public" =>
  typeof value === "string" && ["private", "unlisted", "public"].includes(value);

export function createYouTubeAdapter(http: SocialHttp, now = Date.now): SocialAdapter {
  /** An accepted upload is never repeated: only the bound video resource may be read after checkpointing. */
  const processedVideo = async (
    account: SocialAccount,
    job: SocialJob,
    token: string,
  ): Promise<SocialSendResult> => {
    const videoId = resultIdentity(job.preparation?.youtubeVideoId);
    const params = new URLSearchParams({ part: "processingDetails,status,snippet", id: videoId });
    let value: Record<string, any>;
    try {
      value = (await http.request(`${endpoint}videos?${params}`, token)).value;
    } catch (error) {
      // Retrying a status read for a known accepted ID cannot duplicate the upload.
      if (error instanceof SocialPlatformError && error.code === "unknown")
        throw new SocialPlatformError("processing", now() + 60_000);
      throw error;
    }
    if (!Array.isArray(value.items) || value.items.length !== 1 || value.items[0]?.id !== videoId)
      throw new SocialPlatformError("unknown");
    const video = value.items[0];
    if (typeof video.snippet?.channelId !== "string") throw new SocialPlatformError("unknown");
    if (video.snippet.channelId !== account.platformId) throw new SocialPlatformError("denied");
    if (
      ["failed", "rejected", "deleted"].includes(video.status?.uploadStatus) ||
      video.processingDetails?.processingStatus === "failed"
    )
      throw new SocialPlatformError("rejected");
    if (video.processingDetails?.processingStatus === "processing") {
      const estimate = Number(video.processingDetails.processingProgress?.timeLeftMs);
      const delay =
        Number.isFinite(estimate) && estimate > 0
          ? Math.max(5000, Math.min(60_000, estimate))
          : 60_000;
      throw new SocialPlatformError("processing", now() + delay);
    }
    if (
      video.processingDetails?.processingStatus !== "succeeded" ||
      video.status?.uploadStatus !== "processed" ||
      !visibility(video.status?.privacyStatus)
    )
      throw new SocialPlatformError("unknown");
    return {
      platformId: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      visibility: video.status.privacyStatus,
    };
  };
  return {
    async send(account, job, token, media, checkpoint, beforeSubmit) {
      const content = [job.payload.text, job.payload.link].filter(Boolean).join("\n");
      if (job.kind === "publish") {
        if (job.preparation?.youtubeVideoId !== undefined)
          return processedVideo(account, job, token);
        if (job.preparation?.youtubeVisibility !== undefined)
          throw new SocialPlatformError("unknown");
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
        // Without durable checkpointing, a later processing retry could upload the video twice.
        if (!checkpoint) throw new SocialPlatformError("unsupported");
        const bytes = await media(asset.uploadId);
        await beforeSubmit?.();
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
          bytes,
        );
        const platformId = resultIdentity(value.id);
        const preparation: NonNullable<SocialJob["preparation"]> = {
          ...job.preparation,
          youtubeVideoId: platformId,
          ...(visibility(value.status?.privacyStatus)
            ? { youtubeVisibility: value.status.privacyStatus }
            : {}),
        };
        job.preparation = preparation;
        try {
          await checkpoint(preparation);
        } catch {
          throw new SocialPlatformError("unknown");
        }
        return processedVideo(account, job, token);
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
    async reconcile(account, job, token) {
      if (job.kind !== "publish" || job.preparation?.youtubeVideoId === undefined) return undefined;
      return processedVideo(account, job, token);
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
