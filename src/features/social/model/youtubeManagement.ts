export const YOUTUBE_READ_TOOLS = [
  "youtube.quota.status",
  "youtube.channel.read",
  "youtube.videos.list",
  "youtube.playlists.list",
  "youtube.comments.list",
  "youtube.subscriptions.list",
  "youtube.subscription.preview",
  "youtube.analytics.report",
  "youtube.monetization.status",
  "youtube.broadcasts.list",
  "youtube.liveChat.list",
  "youtube.superChats.list",
  "youtube.operation.status",
  "youtube.community.list",
] as const;

export const YOUTUBE_WRITE_TOOLS = [
  "youtube.video.update",
  "youtube.thumbnail.set",
  "youtube.playlist.create",
  "youtube.playlist.add",
  "youtube.playlist.update",
  "youtube.playlist.remove",
  "youtube.playlist.move",
  "youtube.comment.moderate",
  "youtube.comment.react",
  "youtube.subscription.change",
  "youtube.broadcast.create",
  "youtube.broadcast.transition",
  "youtube.liveChat.send",
  "youtube.liveChat.delete",
  "youtube.liveChat.ban",
  "youtube.liveChat.unban",
  "youtube.community.publish",
  "youtube.community.edit",
] as const;

export const YOUTUBE_OWNER_WRITES = [
  "youtube.channel.update",
  "youtube.video.delete",
  "youtube.playlist.delete",
  "youtube.comment.delete",
  "youtube.community.delete",
] as const;

export type YouTubeWriteAction =
  | (typeof YOUTUBE_WRITE_TOOLS)[number]
  | (typeof YOUTUBE_OWNER_WRITES)[number];

export type YouTubeOperation = {
  id: string;
  accountId: string;
  action: YouTubeWriteAction;
  input: Record<string, unknown>;
  status: "awaiting_approval" | "submitted" | "done" | "rejected" | "unknown";
  createdAt: number;
  result?: unknown;
  reason?: string;
};
