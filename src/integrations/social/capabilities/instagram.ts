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
      "HTTPS images, feed Reels, ordered carousels of up to 20 assets, and Stories for eligible business accounts. Processing is checked before publication.",
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
      "Existing conversations support text and image, video, audio or PDF attachments within the response window. Local files need the Host's HTTPS media origin. Eligible comments support one private reply.",
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
        "Account and owned-media insights, with eligible audience breakdowns. Missing metrics are reported separately.",
      ),
      "audience.collect": r(
        ["instagram_business_manage_comments"],
        "Commenters on one selected owned post and recent DM senders (needs instagram_business_manage_messages). Hashtag, mention and follower sources are unsupported.",
      ),
    },
    browser: {},
  };
}
