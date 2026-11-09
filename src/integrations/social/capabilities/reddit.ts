import { NOT_YET, r, type OperationRequirements, type PlatformCapabilities } from "./shared";

/**
 * Reddit Data API rows (OAuth web app, duration=permanent). Browser rows are empty: the browser recipe
 * declares no operations because Reddit chat is deferred. Scope names come from the OAuth definition.
 */
export function redditCapabilities(): PlatformCapabilities {
  const api: OperationRequirements = {
    ...NOT_YET,
    publish: r(
      ["submit"],
      "Text and link posts to one subreddit. Subreddit flair requirements and title/body limits are checked before submission. Image and video posts are not supported.",
    ),
    media: r(
      [],
      "Image and video uploads are not implemented; the media upload flow is not verified against Reddit documentation. Text and link posts only.",
      true,
    ),
    "comments.read": r(
      ["privatemessages"],
      "Comment replies to your posts arrive through the inbox read.",
    ),
    reply: r(
      ["submit"],
      "Reply to a comment through /api/comment. The target must be a comment (t1_) or post (t3_) fullname.",
    ),
    comment: r(["submit"], "Top-level comment on a post (t3_) through /api/comment."),
    "inbox.read": r(
      ["privatemessages"],
      "Private messages, comment replies, post replies and username mentions from the inbox; the newest 100 items per poll.",
    ),
    "message.reply": r(
      ["submit", "privatemessages"],
      "Reply inside an existing private message thread through /api/comment.",
    ),
    "message.start": r(
      ["privatemessages"],
      "Start a private message to a username through /api/compose; a subject and body are required.",
    ),
    search: r(
      [],
      "Keyword discovery is offered as audience collection (keyword source), not as this search operation.",
      true,
    ),
    webhook: r(
      [],
      "Reddit push notifications are not used. Permitted inbox polling is the inbound path.",
      true,
    ),
    poll: r(
      ["privatemessages"],
      "Inbox polling with a cursor at the newest seen item. A backlog larger than 100 between two polls is not paged.",
    ),
    delete: r(["edit"], "Delete a post or comment this account owns through /api/del."),
    "audience.collect": r(
      ["read", "history"],
      "Keyword search, site-wide or within one subreddit, and commenters on your own posts or one post. Account-level commenter lists are not available.",
    ),
    "profile.read": r(["identity"], "Account name from /api/v1/me."),
  };
  return { api, browser: {} };
}
