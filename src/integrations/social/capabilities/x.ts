import type { SocialOperation } from "../adapter";
import {
  NOT_YET,
  r,
  type BrowserNotes,
  type CapabilityRequirement,
  type PlatformCapabilities,
} from "./shared";

/** Scopes recorded for an X browser session at sign-in. Capability state does not depend on them. */
export const X_BROWSER_SCOPES = [
  "tweet.write",
  "tweet.read",
  "users.read",
  "media.write",
  "dm.read",
  "dm.write",
];

const READ_NOTE =
  "Bounded recent web snapshots from recognized X response formats. Encrypted Chat and historical backfill are unavailable; inspect per-channel monitoring status for partial reads.";

/** Browser-session wording. Never mentions API scopes, OAuth or API products. */
export const X_BROWSER_NOTES: BrowserNotes = {
  publish:
    "Publishes through the connected X web session and the existing approval queue. The verified account identity and the persisted platform acknowledgement are required; uncertain outcomes are held for review.",
  media:
    "Up to four host-uploaded JPEG/PNG images (5 MiB each) or one MP4 video (64 MiB). Video processing and platform limits must pass before publishing. Documents are shared as links.",
  reply:
    "Replies through the connected X web session. Reply settings apply; the approval queue and uncertain-outcome review apply.",
  comment:
    "Comments through the connected X web session on accessible posts. Reply settings apply; uncertain outcomes are held for review.",
  "comments.read": READ_NOTE,
  poll: READ_NOTE,
  "inbox.read": READ_NOTE,
  "message.reply":
    "Legacy X web DM only, with a verified numeric conversation and explicit message acknowledgement. Encrypted Chat is unavailable. Project permissions, consent and automatic-rule authorization still apply.",
  "message.start":
    "Legacy X web DM only, with a verified numeric conversation and explicit message acknowledgement. Encrypted Chat is unavailable. Project permissions, consent and automatic-rule authorization still apply.",
};

export function xCapabilities(): PlatformCapabilities {
  const api: Record<SocialOperation, CapabilityRequirement> = {
    ...NOT_YET,
    publish: r(
      ["tweet.write", "tweet.read", "users.read"],
      "User OAuth and an enabled X API product with write quota are required.",
    ),
    media: r(
      ["media.write"],
      "Media endpoint access and supported image/video format are required.",
    ),
    "comments.read": r(
      ["tweet.read", "users.read"],
      "Replies use mentions/search endpoints; query history and quota depend on API access.",
    ),
    reply: r(["tweet.write"], "Reply settings and user-context OAuth apply."),
    comment: r(
      ["tweet.write"],
      "A comment is a reply to an accessible post; reply settings apply.",
    ),
    "inbox.read": r(
      ["dm.read", "tweet.read", "users.read"],
      "Direct-message endpoint access is required; encrypted X Chat is a separate product.",
    ),
    "message.reply": r(
      ["dm.write", "dm.read", "tweet.read", "users.read"],
      "Recipient privacy/settings and API access apply.",
    ),
    "message.start": r(
      ["dm.write", "dm.read", "tweet.read", "users.read"],
      "Recipient must permit this sender; storing a contact does not establish consent.",
    ),
    search: r(
      ["tweet.read", "users.read"],
      "Search range and read quota depend on the approved API product.",
    ),
    webhook: r([], "Account Activity/webhook product registration and subscription are required."),
    poll: r(["tweet.read", "users.read"], "Only permitted API reads within returned rate limits."),
  };
  // Opened in 4E-x. Later keys win, so these overrides follow ...NOT_YET.
  return {
    api: {
      ...api,
      ...NOT_YET,
      delete: r(
        ["tweet.write", "tweet.read", "users.read"],
        "Deletes one of this account's posts through the X API. Browser deletion is not implemented.",
      ),
      analytics: r(
        ["tweet.read", "users.read"],
        "Public post metrics through the X API. Which metrics are returned depends on the post and the API access level.",
      ),
      "audience.collect": r(
        ["tweet.read", "users.read", "follows.read", "like.read"],
        "Collects people from mentions, followers, likers, reposters and replies through the X API. Keyword and hashtag search depend on the approved X API product, which is not verified.",
      ),
      "profile.read": r(
        ["tweet.read", "users.read"],
        "Reads this account's public profile and follower count through the X API.",
      ),
    },
    browser: X_BROWSER_NOTES,
  };
}
