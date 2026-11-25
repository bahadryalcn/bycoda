export const YOUTUBE_CAPABILITIES = [
  "video.update",
  "thumbnail.set",
  "playlists.manage",
  "comment.moderate",
  "comment.react",
  "subscribe",
  "channel.profile.update",
  "analytics.report",
  "monetization.read",
  "monetization.status",
  "live.manage",
  "live.chat",
  "community.publish",
] as const;

export type YouTubeCapability = (typeof YOUTUBE_CAPABILITIES)[number];
