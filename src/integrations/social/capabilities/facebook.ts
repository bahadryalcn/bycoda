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
      "Managed Page images, video, Reels and Stories. Format limits depend on the destination.",
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
        "Page media views and unique viewers, plus post media views and engagement counts.",
      ),
      "audience.collect": r(
        ["pages_read_engagement", "pages_read_user_content"],
        "Commenters and reactors on one selected managed post. Direct-message senders also need pages_messaging.",
      ),
      // Facebook Page operations
      "profile.read": r(
        ["pages_read_engagement"],
        "Managed Page details and follower and like counts.",
      ),
      "profile.update": r(
        ["pages_manage_metadata", "business_management"],
        "Owner-managed Page information and photos.",
      ),
      "post.edit": r(
        ["pages_manage_posts", "pages_read_engagement"],
        "Edit text on a managed Page post.",
      ),
      "post.schedule": r(
        ["pages_manage_posts", "pages_read_engagement"],
        "Native scheduling for supported Page posts and videos.",
      ),
      "comment.moderate": r(
        ["pages_manage_engagement", "pages_read_user_content"],
        "Moderate comments on managed Page content.",
      ),
      "comment.privateReply": r(
        ["pages_messaging", "pages_read_user_content"],
        "One Messenger reply to an eligible Page comment within seven days.",
      ),
      "mentions.read": r(
        ["pages_read_user_content", "pages_show_list"],
        "Read posts that tag this Page, subject to Meta access.",
      ),
      "live.read": r(
        ["pages_read_engagement", "pages_read_user_content"],
        "Read Page live video receipts and comments.",
      ),
      "live.transmit": r(
        ["pages_manage_posts", "publish_video"],
        "Owner-managed live streams on eligible Pages.",
      ),
    },
    browser: {
      "profile.read": "Read profile photos from the verified Facebook actor.",
      "profile.update": "Owner-confirmed edits to the verified Facebook Page or personal profile.",
    },
  };
}
