import { NOT_YET, r, type OperationRequirements, type PlatformCapabilities } from "./shared";

export function youtubeCapabilities(): PlatformCapabilities {
  const read = "https://www.googleapis.com/auth/youtube.readonly";
  const upload = "https://www.googleapis.com/auth/youtube.upload";
  const write = "https://www.googleapis.com/auth/youtube.force-ssl";
  const api: OperationRequirements = {
    ...NOT_YET,
    publish: r(
      [upload, read],
      "Video upload to the OAuth-verified channel only; title, privacy and audience declarations are required. Optional scheduled publishing keeps the upload private until its publish time. No text-only Community posts. API enablement, consent approval, channel restrictions and quota apply.",
    ),
    media: r(
      [upload, read],
      "This adapter accepts one host-uploaded MP4/WebM video up to 64 MiB. Platform processing is separate from upload acceptance.",
    ),
    "comments.read": r(
      [read],
      "Published comments on the channel's videos; thread and reply pages are read in bounded requests. Quota errors suspend polling for six hours.",
    ),
    reply: r(
      [write],
      "Reply to an eligible top-level comment. Comment visibility, canReply and channel restrictions apply.",
    ),
    comment: r(
      [write, read],
      "Comment on an accessible video with comments enabled; the video's channel ID is resolved by the host.",
    ),
    "inbox.read": r(
      [],
      "YouTube Data API has no general private-message inbox. Comments appear in the shared inbox.",
      true,
    ),
    "message.reply": r([], "No general YouTube direct-message API.", true),
    "message.start": r([], "No general YouTube direct-message initiation API.", true),
    search: r(
      [],
      "Keyword discovery is offered as audience collection, not as this search operation. contacts.search searches saved contacts.",
      true,
    ),
    webhook: r(
      [],
      "YouTube push notifications cover video changes, not incoming comments/messages. This adapter uses permitted comment polling.",
      true,
    ),
    poll: r(
      [read],
      "Published channel comment and complete reply pages; bounded requests and durable page cursors. Quota/rate-limit responses suspend polling.",
    ),
  };
  return {
    api: {
      ...api,
      ...NOT_YET,
      // YouTube management operations.
      delete: r([write], "Delete an owned video. Requires owner confirmation."),
      "video.update": r([read, write], "Edit owned video metadata and visibility."),
      "thumbnail.set": r([read, write], "Set the thumbnail of an owned video."),
      "playlists.manage": r([read, write], "Create playlists and manage their videos."),
      "comment.moderate": r([read, write], "Review, approve, reject or delete eligible comments."),
      subscribe: r([read, write], "List and manage the channel's subscriptions."),
      "channel.profile.update": r(
        [read, write, upload],
        "Edit channel branding and upload a banner.",
      ),
      "analytics.report": r(
        [read, "https://www.googleapis.com/auth/yt-analytics.readonly"],
        "YouTube Analytics channel activity and traffic reports.",
      ),
      "monetization.read": r(
        [read, "https://www.googleapis.com/auth/yt-analytics-monetary.readonly"],
        "YouTube Analytics estimated earnings where available.",
      ),
      "live.manage": r([read, write], "Manage live broadcasts and their encoder streams."),
      "live.chat": r(
        [read, write],
        "Read and moderate live chat, reply, and read Super Chat events.",
      ),
      analytics: r(
        [read],
        "View, like and comment counts of the channel's videos from the Data API statistics. The YouTube Analytics reports API is not used.",
      ),
      "audience.collect": r(
        [read],
        "Commenters of the channel's videos, or of public videos matching a keyword (one call from the dedicated search quota per page). Live chat is available separately.",
      ),
      "profile.read": r(
        [read],
        "Channel name, handle and subscriber count when YouTube reports them.",
      ),
    },
    browser: {
      // YouTube Studio operations without a generally available official API.
      "channel.profile.update":
        "Edit the verified channel's Studio profile, including its name and handle.",
      "comment.react": "Like or heart an exact comment in Studio.",
      "community.publish": "Publish a Community post on an eligible channel.",
      "monetization.status": "Read the channel's monetization status in Studio.",
    },
  };
}
