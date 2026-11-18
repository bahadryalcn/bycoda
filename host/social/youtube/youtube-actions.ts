import type { SocialAccount } from "../../../src/features/social/model/social";
import {
  YOUTUBE_OWNER_WRITES,
  type YouTubeWriteAction,
} from "../../../src/features/social/model/youtubeManagement";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { queryYouTubeAnalytics } from "../../../src/integrations/social/youtube-analytics";
import {
  getYouTubeChannel,
  updateYouTubeChannel,
} from "../../../src/integrations/social/youtube-channel";
import {
  banYouTubeLiveChatUser,
  createYouTubeLiveBroadcast,
  deleteYouTubeLiveChatMessage,
  getYouTubeLiveBroadcast,
  listYouTubeLiveBroadcasts,
  listYouTubeLiveChat,
  listYouTubeSuperChats,
  sendYouTubeLiveChatMessage,
  transitionYouTubeLiveBroadcast,
  unbanYouTubeLiveChatUser,
} from "../../../src/integrations/social/youtube-live";
import {
  deleteYouTubeComment,
  getYouTubeCommentTarget,
  listYouTubeComments,
  moderateYouTubeComment,
} from "../../../src/integrations/social/youtube-moderation";
import {
  YOUTUBE_DAILY_SEARCH_CALLS,
  YOUTUBE_DAILY_UNITS,
  YOUTUBE_DAILY_UPLOAD_CALLS,
  YOUTUBE_UNIT_COSTS,
} from "../../../src/integrations/social/youtube-quota";
import {
  changeYouTubeSubscription,
  listYouTubeSubscriptions,
  previewYouTubeSubscription,
} from "../../../src/integrations/social/youtube-subscriptions";
import {
  addOwnedYouTubePlaylistItem,
  createYouTubePlaylist,
  deleteYouTubePlaylist,
  deleteYouTubeVideo,
  listYouTubePlaylistItems,
  listYouTubePlaylists,
  listYouTubeVideos,
  moveYouTubePlaylistItem,
  removeYouTubePlaylistItem,
  setOwnedYouTubeThumbnail,
  updateYouTubePlaylist,
  updateYouTubeVideo,
} from "../../../src/integrations/social/youtube-videos";
import { youtubeCommentReaction } from "../browser/youtube-comment-actions";
import type {
  SocialActionContext,
  SocialActionModule,
  SocialActionSpec,
} from "../core/social-actions";
import { youtubePublishCommunity } from "../social-browser-youtube-community";
import { youtubeBrowserEarnings } from "../social-browser-youtube-earnings";
import {
  youtubeBrowserProfile,
  youtubeUpdateBrowserProfile,
} from "../social-browser-youtube-profile";
import { youTubeLiveSecretWriter } from "./live-secret";
import {
  publicYouTubeOperation,
  readYouTubeOperation,
  reconcileYouTubeOperation,
  submitYouTubeOperation,
  type YouTubeDispatchPolicy,
} from "./youtube-dispatch";
import { youtubeInputs, type YouTubeAction, type YouTubeInput } from "./youtube-inputs";
import {
  reportYouTubeHumanHandoff,
  youtubeAccount,
  youtubeApi,
  youtubeBrowser,
  youtubeRuntime,
} from "./youtube-runtime";

type ReadAction = Exclude<
  YouTubeAction,
  YouTubeWriteAction | "youtube.operation.approve" | "youtube.operation.reconcile"
>;
type Handler<K extends YouTubeAction> = (
  ctx: SocialActionContext,
  account: SocialAccount,
  input: YouTubeInput<K>,
  guard: () => Promise<void>,
) => Promise<unknown>;
type StoredOperation = Awaited<ReturnType<typeof readYouTubeOperation>>;

function read<K extends ReadAction>(
  action: K,
  handler: Handler<K>,
  ownerOnly = false,
  inactiveAllowed = false,
): SocialActionSpec {
  return {
    readOnly: true,
    ownerOnly,
    tool: !ownerOnly,
    async run(ctx, raw) {
      const input = youtubeInputs[action].parse(raw) as YouTubeInput<K>;
      const account = inactiveAllowed
        ? await ctx.service.access(ctx.principal, input.accountId, "read")
        : await youtubeAccount(ctx, input.accountId);
      if (account.platform !== "youtube") throw new SocialPlatformError("unsupported");
      return await reportYouTubeHumanHandoff(() =>
        handler(ctx, account, input, () => youtubeRuntime(ctx).assertAuthorized()),
      );
    },
  };
}

function mutation<K extends YouTubeWriteAction>(
  action: K,
  policy: YouTubeDispatchPolicy,
  handler: Handler<K>,
) {
  const ownerOnly = (YOUTUBE_OWNER_WRITES as readonly string[]).includes(action);
  const run = async (
    ctx: SocialActionContext,
    raw: Record<string, unknown>,
    approved?: StoredOperation,
  ) => {
    const input = youtubeInputs[action].parse(raw) as YouTubeInput<K>;
    const account = await youtubeAccount(ctx, input.accountId, policy.permission);
    return await submitYouTubeOperation(
      ctx,
      action,
      input,
      policy,
      (guard) => handler(ctx, account, input, guard),
      approved,
    );
  };
  return {
    readOnly: false,
    ownerOnly,
    tool: !ownerOnly,
    autonomy: policy.autonomy,
    run,
  } satisfies SocialActionSpec;
}

const publish = { permission: "publish", autonomy: "publish", outbound: true } as const;
const comment = { permission: "comment", autonomy: "comment", outbound: true } as const;
const reply = { permission: "reply", autonomy: "reply", outbound: true } as const;
const modify = { ...publish, outbound: false } as const;
const moderate = { ...comment, outbound: false } as const;
const target = async (ctx: SocialActionContext, accountId: string, platformId: string) => {
  const person = await ctx.store.findPersonByHandle(accountId, platformId);
  await ctx.service.assertSendable(
    { platform: "youtube", platformId, personId: person?.id },
    "comment",
  );
};

async function liveChat(ctx: SocialActionContext, account: SocialAccount, broadcastId: string) {
  const api = await youtubeApi(ctx, account, "live.chat");
  const broadcast = await getYouTubeLiveBroadcast(
    api.http,
    api.token,
    api.quota,
    api.channelId,
    broadcastId,
  );
  if (!broadcast.chatId) throw new SocialPlatformError("unsupported");
  return { ...api, chatId: broadcast.chatId };
}

const writes = {
  "youtube.video.update": mutation(
    "youtube.video.update",
    publish,
    async (ctx, account, { videoId, patch }, beforeWrite) => {
      const api = await youtubeApi(ctx, account, "video.update");
      const { publishAt, ...metadata } = patch;
      return await updateYouTubeVideo({ ...api, beforeWrite }, videoId, {
        ...metadata,
        ...(publishAt !== undefined
          ? { publishAt: publishAt === null ? null : Date.parse(publishAt) }
          : {}),
      });
    },
  ),
  "youtube.video.delete": mutation(
    "youtube.video.delete",
    modify,
    async (ctx, account, input, beforeWrite) => {
      const api = await youtubeApi(ctx, account, "delete");
      return await deleteYouTubeVideo({ ...api, beforeWrite }, input.videoId, input.confirm);
    },
  ),
  "youtube.thumbnail.set": mutation(
    "youtube.thumbnail.set",
    { ...modify, ownerMedia: true },
    async (ctx, account, input, beforeWrite) => {
      const api = await youtubeApi(ctx, account, "thumbnail.set");
      const bytes = await youtubeRuntime(ctx).media(ctx.principal, input.uploadId);
      await setOwnedYouTubeThumbnail({ ...api, beforeWrite }, input.videoId, bytes);
      return { videoId: input.videoId };
    },
  ),
  "youtube.playlist.create": mutation(
    "youtube.playlist.create",
    publish,
    async (ctx, account, { accountId: _accountId, ...input }, beforeWrite) =>
      await createYouTubePlaylist(
        { ...(await youtubeApi(ctx, account, "playlists.manage")), beforeWrite },
        input,
      ),
  ),
  "youtube.playlist.update": mutation(
    "youtube.playlist.update",
    publish,
    async (ctx, account, input, beforeWrite) =>
      await updateYouTubePlaylist(
        { ...(await youtubeApi(ctx, account, "playlists.manage")), beforeWrite },
        input.playlistId,
        input.patch,
      ),
  ),
  "youtube.playlist.delete": mutation(
    "youtube.playlist.delete",
    modify,
    async (ctx, account, input, beforeWrite) =>
      await deleteYouTubePlaylist(
        { ...(await youtubeApi(ctx, account, "playlists.manage")), beforeWrite },
        input.playlistId,
        input.confirm,
      ),
  ),
  "youtube.playlist.add": mutation(
    "youtube.playlist.add",
    publish,
    async (ctx, account, input, beforeWrite) =>
      await addOwnedYouTubePlaylistItem(
        { ...(await youtubeApi(ctx, account, "playlists.manage")), beforeWrite },
        input.playlistId,
        input.videoId,
      ),
  ),
  "youtube.playlist.remove": mutation(
    "youtube.playlist.remove",
    modify,
    async (ctx, account, input, beforeWrite) =>
      await removeYouTubePlaylistItem(
        { ...(await youtubeApi(ctx, account, "playlists.manage")), beforeWrite },
        input.playlistId,
        input.playlistItemId,
        true,
      ),
  ),
  "youtube.playlist.move": mutation(
    "youtube.playlist.move",
    modify,
    async (ctx, account, input, beforeWrite) =>
      await moveYouTubePlaylistItem(
        { ...(await youtubeApi(ctx, account, "playlists.manage")), beforeWrite },
        input.playlistId,
        input.playlistItemId,
        input.position,
      ),
  ),
  "youtube.channel.update": mutation(
    "youtube.channel.update",
    modify,
    async (ctx, account, { patch }, beforeWrite) => {
      const { name, handle, avatarUploadId, links, bannerUploadId, ...branding } = patch;
      if (account.connection === "browser") {
        if (bannerUploadId || Object.keys(branding).length)
          throw new SocialPlatformError("unsupported");
        return await youtubeBrowser(
          ctx,
          account,
          "channel.profile.update",
          (recipe) => youtubeUpdateBrowserProfile(recipe, { name, handle, avatarUploadId, links }),
          { beforeSubmit: beforeWrite, uploads: avatarUploadId ? [avatarUploadId] : [] },
        );
      }
      if (
        name !== undefined ||
        handle !== undefined ||
        avatarUploadId !== undefined ||
        links !== undefined
      )
        throw new SocialPlatformError("unsupported");
      const api = await youtubeApi(ctx, account, "channel.profile.update");
      const banner = bannerUploadId
        ? await youtubeRuntime(ctx).media(ctx.principal, bannerUploadId)
        : undefined;
      return await updateYouTubeChannel({ ...api, beforeWrite }, { ...branding, banner });
    },
  ),
  "youtube.comment.moderate": mutation(
    "youtube.comment.moderate",
    moderate,
    async (ctx, account, input, guard) => {
      const { http, token, quota, channelId } = await youtubeApi(ctx, account, "comment.moderate");
      await getYouTubeCommentTarget(http, token, quota, channelId, input.commentId);
      await moderateYouTubeComment(http, token, quota, input.commentId, input.status, false, guard);
      return { commentId: input.commentId, status: input.status };
    },
  ),
  "youtube.comment.delete": mutation(
    "youtube.comment.delete",
    moderate,
    async (ctx, account, input, guard) => {
      const { http, token, quota, channelId } = await youtubeApi(ctx, account, "comment.moderate");
      await deleteYouTubeComment(
        http,
        token,
        quota,
        channelId,
        input.commentId,
        input.confirm,
        guard,
      );
      return { commentId: input.commentId };
    },
  ),
  "youtube.comment.react": mutation(
    "youtube.comment.react",
    comment,
    async (ctx, account, input, guard) =>
      await youtubeBrowser(
        ctx,
        account,
        "comment.react",
        (recipe) => youtubeCommentReaction(recipe, input),
        {
          beforeSubmit: async () => {
            await target(ctx, account.id, input.authorChannelId);
            await guard();
          },
          outbound: true,
        },
      ),
  ),
  "youtube.subscription.change": mutation(
    "youtube.subscription.change",
    { ...comment, subscription: true },
    async (ctx, account, input, guard) => {
      const api = await youtubeApi(ctx, account, "subscribe");
      const preview = await previewYouTubeSubscription(api, input.targetChannelId, input.action);
      return await changeYouTubeSubscription(
        {
          ...api,
          beforeWrite: async () => {
            await target(ctx, account.id, preview.channelId);
            await guard();
          },
        },
        preview.channelId,
        input.action,
      );
    },
  ),
  "youtube.broadcast.create": mutation(
    "youtube.broadcast.create",
    publish,
    async (ctx, account, { accountId, privacy, ...input }, beforeWrite) => {
      const { http, token, quota } = await youtubeApi(ctx, account, "live.manage");
      return await createYouTubeLiveBroadcast(
        http,
        token,
        quota,
        { ...input, privacyStatus: privacy },
        {
          saveIngest: youTubeLiveSecretWriter(youtubeRuntime(ctx).credentials, accountId),
          beforeWrite,
          now: ctx.now,
        },
      );
    },
  ),
  "youtube.broadcast.transition": mutation(
    "youtube.broadcast.transition",
    publish,
    async (ctx, account, input, guard) => {
      const { http, token, quota, channelId } = await youtubeApi(ctx, account, "live.manage");
      return await transitionYouTubeLiveBroadcast(
        http,
        token,
        quota,
        channelId,
        input.broadcastId,
        input.status,
        guard,
      );
    },
  ),
  "youtube.liveChat.send": mutation(
    "youtube.liveChat.send",
    reply,
    async (ctx, account, input, guard) => {
      const { http, token, quota, chatId } = await liveChat(ctx, account, input.broadcastId);
      if (input.replyToMessageId) {
        const { events } = await listYouTubeLiveChat(http, token, quota, chatId);
        const recipient = events.find(
          (event) => event.id === input.replyToMessageId,
        )?.authorChannelId;
        if (!recipient) throw new SocialPlatformError("denied");
        await target(ctx, account.id, recipient);
      }
      await guard();
      return await sendYouTubeLiveChatMessage(http, token, quota, chatId, input.message);
    },
  ),
  "youtube.liveChat.delete": mutation(
    "youtube.liveChat.delete",
    moderate,
    async (ctx, account, input, guard) => {
      const { http, token, quota, chatId } = await liveChat(ctx, account, input.broadcastId);
      const { events } = await listYouTubeLiveChat(http, token, quota, chatId);
      if (!events.some((event) => event.id === input.messageId))
        throw new SocialPlatformError("denied");
      await guard();
      await deleteYouTubeLiveChatMessage(http, token, quota, input.messageId);
      return { messageId: input.messageId };
    },
  ),
  "youtube.liveChat.ban": mutation(
    "youtube.liveChat.ban",
    moderate,
    async (ctx, account, input, guard) => {
      const { http, token, quota, chatId } = await liveChat(ctx, account, input.broadcastId);
      await guard();
      return await banYouTubeLiveChatUser(
        http,
        token,
        quota,
        chatId,
        input.channelId,
        input.durationSeconds,
      );
    },
  ),
  "youtube.liveChat.unban": mutation(
    "youtube.liveChat.unban",
    moderate,
    async (ctx, account, input, guard) => {
      const { http, token, quota } = await liveChat(ctx, account, input.broadcastId);
      await guard();
      await unbanYouTubeLiveChatUser(http, token, quota, input.banId);
      return { banId: input.banId };
    },
  ),
  "youtube.community.publish": mutation(
    "youtube.community.publish",
    { ...publish, ownerMedia: true },
    async (ctx, account, { accountId: _accountId, ...input }, guard) =>
      await youtubeBrowser(
        ctx,
        account,
        "community.publish",
        (recipe) => youtubePublishCommunity(recipe, input),
        {
          beforeSubmit: guard,
          uploads: input.imageUploadIds,
          outbound: true,
        },
      ),
  ),
} satisfies Record<YouTubeWriteAction, SocialActionSpec>;

export const youtubeActions: SocialActionModule = {
  ...writes,
  "youtube.quota.status": read("youtube.quota.status", async (ctx, account) => ({
    ...(await youtubeApi(ctx, account)).quota.usedToday(),
    limits: {
      units: YOUTUBE_DAILY_UNITS,
      searchCalls: YOUTUBE_DAILY_SEARCH_CALLS,
      uploadCalls: YOUTUBE_DAILY_UPLOAD_CALLS,
    },
    costs: YOUTUBE_UNIT_COSTS,
  })),
  "youtube.channel.read": read("youtube.channel.read", async (ctx, account) =>
    account.connection === "browser"
      ? await youtubeBrowser(ctx, account, "channel.profile.update", youtubeBrowserProfile)
      : await getYouTubeChannel(await youtubeApi(ctx, account, "profile.read")),
  ),
  "youtube.videos.list": read(
    "youtube.videos.list",
    async (ctx, account, { cursor }) =>
      await listYouTubeVideos(await youtubeApi(ctx, account, "profile.read"), cursor),
  ),
  "youtube.playlists.list": read(
    "youtube.playlists.list",
    async (ctx, account, { cursor, playlistId }) => {
      const api = await youtubeApi(ctx, account, "profile.read");
      return playlistId
        ? await listYouTubePlaylistItems(api, playlistId, cursor)
        : await listYouTubePlaylists(api, cursor);
    },
  ),
  "youtube.comments.list": read("youtube.comments.list", async (ctx, account, input) => {
    const { http, token, quota, channelId } = await youtubeApi(
      ctx,
      account,
      input.moderationStatus && input.moderationStatus !== "published"
        ? "comment.moderate"
        : "comments.read",
    );
    return await listYouTubeComments(http, token, quota, channelId, {
      cursor: input.cursor,
      status: input.moderationStatus,
      videoId: input.videoId,
      parentId: input.parentId,
    });
  }),
  "youtube.subscriptions.list": read(
    "youtube.subscriptions.list",
    async (ctx, account, input) =>
      await listYouTubeSubscriptions(
        await youtubeApi(ctx, account, "profile.read"),
        input.direction,
        input.cursor,
      ),
  ),
  "youtube.subscription.preview": read(
    "youtube.subscription.preview",
    async (ctx, account, input) =>
      await previewYouTubeSubscription(
        await youtubeApi(ctx, account, "profile.read"),
        input.targetChannelId,
        input.action,
      ),
  ),
  "youtube.analytics.report": read("youtube.analytics.report", async (ctx, account, input) => {
    const { http, token, channelId } = await youtubeApi(ctx, account);
    return await queryYouTubeAnalytics(http, token, { channelId, scopes: account.scopes }, input);
  }),
  "youtube.monetization.status": read(
    "youtube.monetization.status",
    async (ctx, account) =>
      await youtubeBrowser(ctx, account, "monetization.status", youtubeBrowserEarnings),
  ),
  "youtube.broadcasts.list": read("youtube.broadcasts.list", async (ctx, account, { cursor }) => {
    const { http, token, quota } = await youtubeApi(ctx, account, "live.manage");
    return await listYouTubeLiveBroadcasts(http, token, quota, cursor);
  }),
  "youtube.liveChat.list": read("youtube.liveChat.list", async (ctx, account, input) => {
    const { http, token, quota, chatId } = await liveChat(ctx, account, input.broadcastId);
    return await listYouTubeLiveChat(http, token, quota, chatId, input.cursor);
  }),
  "youtube.superChats.list": read("youtube.superChats.list", async (ctx, account, { cursor }) => {
    const { http, token, quota } = await youtubeApi(ctx, account, "live.chat");
    return await listYouTubeSuperChats(http, token, quota, cursor);
  }),
  "youtube.operation.status": read(
    "youtube.operation.status",
    async (ctx, account, { id }) =>
      publicYouTubeOperation(await readYouTubeOperation(ctx, account.id, id)),
    false,
    true,
  ),
  "youtube.operations.list": read(
    "youtube.operations.list",
    async (ctx, account, { cursor }) => {
      const page = await ctx.store.listYouTubeOperations(account.id, cursor);
      return { ...page, items: page.items.map(publicYouTubeOperation) };
    },
    true,
    true,
  ),
  "youtube.operation.approve": {
    readOnly: false,
    ownerOnly: true,
    async run(ctx, raw) {
      const { accountId, id } = youtubeInputs["youtube.operation.approve"].parse(raw);
      const row = await readYouTubeOperation(ctx, accountId, id);
      return await writes[row.action].run(ctx, row.input, row);
    },
  },
  "youtube.operation.reconcile": {
    readOnly: false,
    ownerOnly: true,
    async run(ctx, raw) {
      const { accountId, id, status } = youtubeInputs["youtube.operation.reconcile"].parse(raw);
      return await reconcileYouTubeOperation(ctx, accountId, id, status);
    },
  },
};
