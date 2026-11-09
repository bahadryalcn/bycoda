import type { SocialOperation } from "../adapter";
import { NOT_YET, r, type CapabilityRequirement, type PlatformCapabilities } from "./shared";

export function facebookCapabilities(): PlatformCapabilities {
  const api: Record<SocialOperation, CapabilityRequirement> = {
    ...NOT_YET,
    publish: r(
      ["pages_manage_posts", "pages_read_engagement"],
      "Facebook Page access token and Page task/role; personal-profile publishing is unavailable.",
    ),
    media: r(
      ["pages_manage_posts", "pages_read_engagement"],
      "Up to four HTTPS images on a managed Page, including ordered multiple-image posts and alternative text. Explicit Reels accept one uploaded vertical MP4 up to 64 MiB with metadata and exact publication verification. Ordinary Page videos and Stories are not implemented.",
    ),
    "comments.read": r(
      ["pages_read_engagement", "pages_read_user_content"],
      "Comments on managed Page posts.",
    ),
    reply: r(["pages_manage_engagement"], "Managed Page comment/reply permissions."),
    comment: r(
      ["pages_manage_engagement"],
      "Restricted to eligible Page content; public-content access is separately approved.",
    ),
    "inbox.read": r(
      ["pages_messaging"],
      "Page Messenger inbox, approved app access and Page role.",
    ),
    "message.reply": r(
      ["pages_messaging"],
      "User-initiated standard 24-hour response window; automation cannot use human-agent exceptions.",
    ),
    "message.start": r(
      [],
      "Unsolicited messaging is unavailable. Special opt-in products require a separate integration.",
      true,
    ),
    search: r(
      [],
      "No unrestricted people discovery; Page public-content/search products need separate approval.",
      true,
    ),
    webhook: r(["pages_manage_metadata"], "Signed Page webhooks and subscription."),
    poll: r(
      ["pages_read_engagement"],
      "Only approved Page/conversation reads within Graph usage limits.",
    ),
  };
  return {
    api: {
      ...api,
      ...NOT_YET,
      delete: r(["pages_manage_posts"], "Deletes a managed Page post through the Graph API."),
      analytics: r(
        ["pages_read_engagement", "read_insights"],
        "Basic post impressions and engagement counts. Metric names are unverified against live Graph; a metric Meta rejects fails the read.",
      ),
      "audience.collect": r(
        ["pages_read_engagement", "pages_read_user_content"],
        "Commenters and reactors on one selected managed post. Direct-message senders also need pages_messaging.",
      ),
    },
    browser: {},
  };
}
