import { z } from "zod";
import {
  YOUTUBE_READ_TOOLS,
  YOUTUBE_WRITE_TOOLS,
  type YouTubeWriteAction,
} from "../../../src/features/social/model/youtubeManagement";

const id = z.string().regex(/^[\w-]{1,300}$/);
const commentId = z.string().regex(/^[\w.=-]{1,400}$/);
const videoId = z.string().regex(/^[\w-]{11}$/);
const channelId = z.string().regex(/^UC[\w-]{22}$/);
const text = z.string().trim().min(1).max(5000);
const cursor = z.string().max(2048).optional();
const privacy = z.enum(["private", "unlisted", "public"]);
const date = z.iso.date();
const account = { accountId: id };
const page = { ...account, cursor };
const video = { ...account, videoId };
const comment = { ...account, commentId };
const broadcast = { ...account, broadcastId: id };
const playlist = { ...account, playlistId: id };
const playlistPatch = {
  title: text.max(150).optional(),
  description: z.string().max(5000).optional(),
  privacy: privacy.optional(),
};
const confirmation = { confirm: z.literal(true) };
const communityStatus = z.enum(["published", "scheduled"]).optional();
const communityTarget = {
  ...account,
  postId: z.string().regex(/^[\w-]{10,150}$/),
  status: communityStatus,
};

export const youtubeInputs = {
  "youtube.quota.status": z.strictObject(account),
  "youtube.channel.read": z.strictObject(account),
  "youtube.videos.list": z.strictObject(page),
  "youtube.playlists.list": z.strictObject({ ...page, playlistId: id.optional() }),
  "youtube.comments.list": z.strictObject({
    ...page,
    videoId: videoId.optional(),
    parentId: commentId.optional(),
    moderationStatus: z.enum(["heldForReview", "published", "likelySpam"]).optional(),
  }),
  "youtube.subscriptions.list": z.strictObject({
    ...page,
    direction: z.enum(["incoming", "outgoing"]),
  }),
  "youtube.subscription.preview": z.strictObject({
    ...account,
    targetChannelId: channelId,
    action: z.enum(["subscribe", "unsubscribe"]),
  }),
  "youtube.analytics.report": z.strictObject({
    ...account,
    startDate: date,
    endDate: date,
    kind: z.enum(["overview", "daily", "traffic", "earnings"]),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    startIndex: z.number().int().min(1).max(1_000_000).optional(),
  }),
  "youtube.monetization.status": z.strictObject(account),
  "youtube.broadcasts.list": z.strictObject(page),
  "youtube.liveChat.list": z.strictObject({ ...broadcast, cursor }),
  "youtube.superChats.list": z.strictObject(page),
  "youtube.operation.status": z.strictObject({ ...account, id }),
  "youtube.operations.list": z.strictObject(page),
  "youtube.operation.approve": z.strictObject({ ...account, id, ...confirmation }),
  "youtube.operation.reconcile": z.strictObject({
    ...account,
    id,
    status: z.enum(["done", "rejected"]),
    ...confirmation,
  }),
  "youtube.video.update": z.strictObject({
    ...video,
    patch: z.strictObject({
      title: text.max(100).optional(),
      description: z.string().max(5000).optional(),
      tags: z.array(z.string().max(500)).max(50).optional(),
      categoryId: z.string().regex(/^\d+$/).optional(),
      privacy: privacy.optional(),
      publishAt: z.iso.datetime().nullable().optional(),
      madeForKids: z.boolean().optional(),
      containsSyntheticMedia: z.boolean().optional(),
    }),
  }),
  "youtube.video.delete": z.strictObject({ ...video, ...confirmation }),
  "youtube.thumbnail.set": z.strictObject({ ...video, uploadId: id }),
  "youtube.playlist.create": z.strictObject({ ...account, ...playlistPatch, title: text.max(150) }),
  "youtube.playlist.update": z.strictObject({ ...playlist, patch: z.strictObject(playlistPatch) }),
  "youtube.playlist.delete": z.strictObject({ ...playlist, ...confirmation }),
  "youtube.playlist.add": z.strictObject({ ...playlist, videoId }),
  "youtube.playlist.remove": z.strictObject({ ...playlist, playlistItemId: id }),
  "youtube.playlist.move": z.strictObject({
    ...playlist,
    playlistItemId: id,
    position: z.number().int().min(0),
  }),
  "youtube.channel.update": z.strictObject({
    ...account,
    ...confirmation,
    patch: z.strictObject({
      name: text.max(100).optional(),
      handle: text.max(64).optional(),
      description: z.string().max(1000).optional(),
      keywords: z.string().max(500).optional(),
      country: z
        .string()
        .regex(/^[A-Z]{2}$/)
        .optional(),
      bannerUploadId: id.optional(),
      madeForKids: z.boolean().optional(),
      avatarUploadId: id.optional(),
      links: z
        .array(z.strictObject({ title: text.max(30), url: z.url() }))
        .max(14)
        .optional(),
    }),
  }),
  "youtube.comment.moderate": z.strictObject({
    ...comment,
    status: z.enum(["heldForReview", "published", "rejected"]),
  }),
  "youtube.comment.delete": z.strictObject({ ...comment, ...confirmation }),
  "youtube.comment.react": z.strictObject({
    ...comment,
    videoId: videoId.optional(),
    authorChannelId: channelId,
    reaction: z.enum(["like", "heart"]),
    enabled: z.boolean(),
  }),
  "youtube.subscription.change": z.strictObject({
    ...account,
    targetChannelId: channelId,
    action: z.enum(["subscribe", "unsubscribe"]),
  }),
  "youtube.broadcast.create": z.strictObject({
    ...account,
    title: text.max(100),
    description: z.string().max(5000).optional(),
    scheduledStartTime: z.iso.datetime(),
    privacy,
    madeForKids: z.boolean(),
  }),
  "youtube.broadcast.transition": z.strictObject({
    ...broadcast,
    status: z.enum(["testing", "live", "complete"]),
  }),
  "youtube.liveChat.send": z.strictObject({
    ...broadcast,
    message: text.max(200),
    replyToMessageId: commentId.optional(),
  }),
  "youtube.liveChat.delete": z.strictObject({ ...broadcast, messageId: commentId }),
  "youtube.liveChat.ban": z.strictObject({
    ...broadcast,
    channelId,
    durationSeconds: z.number().int().min(1).max(86400).optional(),
  }),
  "youtube.liveChat.unban": z.strictObject({ ...broadcast, banId: commentId }),
  "youtube.community.publish": z.strictObject({
    ...account,
    kind: z.enum(["text", "image", "poll"]),
    text,
    choices: z.array(text.max(65)).min(2).max(4).optional(),
    imageUploadIds: z.array(id).min(1).max(5).optional(),
    publishAt: z.iso
      .datetime()
      .optional()
      .describe("Future publication time at minute precision in UTC."),
  }),
  "youtube.community.list": z.strictObject({ ...account, status: communityStatus }),
  "youtube.community.edit": z.strictObject({ ...communityTarget, editedText: text.max(1500) }),
  "youtube.community.delete": z.strictObject({ ...communityTarget, ...confirmation }),
} satisfies Record<YouTubeWriteAction, z.ZodType> & Record<string, z.ZodType>;

export type YouTubeAction = keyof typeof youtubeInputs;
export type YouTubeInput<K extends YouTubeAction> = z.infer<(typeof youtubeInputs)[K]>;

export const youtubeToolSchemas = Object.fromEntries(
  [...YOUTUBE_READ_TOOLS, ...YOUTUBE_WRITE_TOOLS].map((action) => [
    action,
    z.toJSONSchema(youtubeInputs[action], { io: "input" }),
  ]),
) as unknown as Record<
  (typeof YOUTUBE_READ_TOOLS)[number] | (typeof YOUTUBE_WRITE_TOOLS)[number],
  Record<string, unknown>
>;
