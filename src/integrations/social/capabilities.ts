import type {
  Capability,
  SocialAccount,
  SocialOperation,
  SocialPlatform,
} from "../../features/social/model/social";

export const SOCIAL_DOCUMENTS = {
  youtube: "https://developers.google.com/youtube/v3/docs/",
  x: "https://docs.x.com/x-api/llms.txt",
  instagram: "https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api",
  facebook: "https://developers.facebook.com/docs/pages-api/",
  linkedin: "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/overview",
  linkedinAI: "https://learn.microsoft.com/en-us/linkedin/marketing/developer-ai-policy",
};
/** Operations the X browser-session adapter implements, and the scopes recorded for it. */
export const X_BROWSER_OPERATIONS: SocialOperation[] = ["publish", "media", "reply", "comment"];
export const X_BROWSER_SCOPES = ["tweet.write", "tweet.read", "users.read", "media.write"];
type Requirement = { scopes: string[]; reason: string; unsupported?: boolean };
const r = (scopes: string[], reason: string, unsupported = false): Requirement => ({
  scopes,
  reason,
  unsupported,
});
export function platformRequirements(
  platform: SocialPlatform,
  type: SocialAccount["accountType"],
): Record<SocialOperation, Requirement> {
  switch (platform) {
    case "youtube": {
      const read = "https://www.googleapis.com/auth/youtube.readonly";
      const upload = "https://www.googleapis.com/auth/youtube.upload";
      const write = "https://www.googleapis.com/auth/youtube.force-ssl";
      return {
        publish: r(
          [upload],
          "Video upload to the OAuth-verified channel only; title, privacy and audience declarations are required. No text-only Community posts. API enablement, consent approval, channel restrictions and quota apply.",
        ),
        media: r(
          [upload],
          "This adapter accepts one host-uploaded MP4/WebM video up to 64 MiB. Platform processing is separate from upload acceptance.",
        ),
        "comments.read": r(
          [read],
          "Published comments associated with the authenticated channel; thread and reply pages are polled within quota.",
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
          "YouTube search.list exists, but external discovery is not implemented by this adapter; contacts.search searches saved contacts.",
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
    }
    case "x":
      return {
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
          ["dm.write", "dm.read"],
          "Recipient privacy/settings and API access apply.",
        ),
        "message.start": r(
          ["dm.write"],
          "Recipient must permit this sender; storing a contact does not establish consent.",
        ),
        search: r(
          ["tweet.read", "users.read"],
          "Search range and read quota depend on the approved API product.",
        ),
        webhook: r(
          [],
          "Account Activity/webhook product registration and subscription are required.",
        ),
        poll: r(
          ["tweet.read", "users.read"],
          "Only permitted API reads within returned rate limits.",
        ),
      };
    case "instagram":
      return {
        publish: r(
          ["instagram_business_basic", "instagram_business_content_publish"],
          "Instagram Login for professional business/creator accounts; media container then publish.",
        ),
        media: r(
          ["instagram_business_content_publish"],
          "Meta must fetch an HTTPS image/video; Stories have account-type constraints.",
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
    case "facebook":
      return {
        publish: r(
          ["pages_manage_posts", "pages_read_engagement"],
          "Facebook Page access token and Page task/role; personal-profile publishing is unavailable.",
        ),
        media: r(["pages_manage_posts"], "Page photo/video endpoints and format limits apply."),
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
    case "linkedin": {
      const org = type === "organization";
      return {
        publish: r(
          [org ? "w_organization_social" : "w_member_social"],
          "Posts API, approved product and organization role where applicable; versioned headers required.",
        ),
        media: r(
          [org ? "w_organization_social" : "w_member_social"],
          "Images/Videos upload registration and completion are required.",
        ),
        "comments.read": r(
          [org ? "r_organization_social_feed" : "r_member_social_feed"],
          "Community Management approval; member read is restricted/closed.",
        ),
        reply: r(
          [org ? "w_organization_social_feed" : "w_member_social_feed"],
          "Comments API and approved Community Management access. Third-party API content cannot feed AI reply generation.",
        ),
        comment: r(
          [org ? "w_organization_social_feed" : "w_member_social_feed"],
          "Comments API permissions and accessible parent post.",
        ),
        "inbox.read": r(
          [],
          "General member/Page messaging is not available through the approved open Community Management surface.",
          true,
        ),
        "message.reply": r([], "No general messaging API in this integration.", true),
        "message.start": r([], "No general cold-message API in this integration.", true),
        search: r(
          [],
          "No general people/post discovery; restricted organization/follower finders are separate.",
          true,
        ),
        webhook: r(
          [],
          "Social-action notifications require approved product/subscription; inbound transport is not configured for LinkedIn.",
          true,
        ),
        poll: r(
          [org ? "r_organization_social_feed" : "r_member_social_feed"],
          "Read owned/accessible comments using versioned APIs and application/member limits.",
        ),
      };
    }
  }
}
export function accountCapabilities(account: SocialAccount, now = Date.now()): Capability[] {
  return Object.entries(platformRequirements(account.platform, account.accountType)).map(
    ([operation, requirement]) => {
      let status: Capability["status"] = "available";
      let reason = requirement.reason;
      if (requirement.unsupported) status = "unsupported";
      else if (account.expiresAt !== undefined && account.expiresAt <= now) {
        status = "expired";
        reason = "OAuth token expired. Reconnect this account.";
      } else if (
        !account.connected ||
        !account.accessApproved ||
        requirement.scopes.some((scope) => !account.scopes.includes(scope))
      ) {
        status = "pending";
        reason = `Waiting for OAuth scopes/API access: ${requirement.scopes.join(", ") || "platform subscription"}. ${reason}`;
      }
      if (
        account.platform === "linkedin" &&
        operation === "media" &&
        account.accountType === "member"
      ) {
        status = "unsupported";
        reason =
          "This adapter supports organization image upload only. Member write-only tokens cannot verify Images API readiness; video is not implemented.";
      }
      if (
        account.connection === "browser" &&
        !X_BROWSER_OPERATIONS.includes(operation as SocialOperation)
      ) {
        return {
          operation: operation as SocialOperation,
          status: "unsupported" as const,
          reason:
            "Browser-session mode only publishes posts/images and replies to a given post ID. Inbox, DM, search and polling are not automated in this mode.",
          scopes: requirement.scopes,
          source: SOCIAL_DOCUMENTS[account.platform],
        };
      }
      if (account.platform === "x" && operation === "webhook") {
        status = "pending";
        reason =
          "Account Activity webhook product/subscription must be configured separately; use permitted polling.";
      }
      if (account.platform === "x" && operation === "search") {
        status = "unsupported";
        reason =
          "Search exists in approved X API products, but external discovery is not implemented by this adapter. Local contacts.search is available.";
      }
      if (["instagram", "facebook"].includes(account.platform) && operation === "webhook") {
        status = "pending";
        reason =
          "A signed receiver is implemented. App callback verification, review and account subscription still need external configuration; use permitted polling.";
      }
      return {
        operation: operation as SocialOperation,
        status,
        reason,
        scopes: requirement.scopes,
        source: SOCIAL_DOCUMENTS[account.platform],
      };
    },
  );
}
