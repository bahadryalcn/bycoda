import type { SocialOperation } from "../adapter";
import { NOT_YET, r, type CapabilityRequirement, type PlatformCapabilities } from "./shared";

export function instagramCapabilities(): PlatformCapabilities {
  const api: Record<SocialOperation, CapabilityRequirement> = {
    ...NOT_YET,
    publish: r(
      ["instagram_business_basic", "instagram_business_content_publish"],
      "Instagram Login for professional business/creator accounts; media container then publish.",
    ),
    media: r(
      ["instagram_business_content_publish"],
      "HTTPS images, a single video published as a Reel in the feed, or an ordered image/video carousel. The Host accepts up to four media assets; processing is checked before publication. Stories are not implemented.",
    ),
    "comments.read": r(
      ["instagram_business_manage_comments"],
      "Only supported media of the professional account.",
    ),
    reply: r(["instagram_business_manage_comments"], "Replies to comments on owned media."),
    comment: r(
      [],
      "General comments on arbitrary third-party media are not exposed by this integration/API.",
      true,
    ),
    "inbox.read": r(
      ["instagram_business_manage_messages"],
      "Professional inbox with app review/access level and webhook subscriptions.",
    ),
    "message.reply": r(
      ["instagram_business_manage_messages"],
      "User-initiated conversation; standard 24-hour response window. No human-agent tag for automation.",
    ),
    "message.start": r(
      [],
      "Cold direct-message initiation is unavailable; the recipient must start the conversation.",
      true,
    ),
    search: r([], "Instagram Login has no general public-person/post discovery API.", true),
    webhook: r(["instagram_business_basic"], "Signed Meta webhooks and account subscription."),
    poll: r(
      ["instagram_business_basic"],
      "Read only permitted owned-media/conversation endpoints within platform limits.",
    ),
  };
  return {
    api: {
      ...api,
      ...NOT_YET,
      analytics: r(
        ["instagram_business_basic", "instagram_business_manage_insights"],
        "Basic owned-media views and engagement counts. Metric names are unverified against live Graph; a metric Meta rejects fails the read.",
      ),
      "audience.collect": r(
        ["instagram_business_manage_comments"],
        "Commenters on one selected owned post and recent DM senders (needs instagram_business_manage_messages). Hashtag, mention and follower sources are unsupported.",
      ),
    },
    browser: {},
  };
}
