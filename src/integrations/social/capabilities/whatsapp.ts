import { NOT_YET, r, type OperationRequirements, type PlatformCapabilities } from "./shared";

const SCOPES = ["whatsapp_business_messaging", "bycoda.webhook"];

/**
 * WhatsApp rows. API: Business Cloud API (phone number ID, host token, signed webhook). Browser: personal
 * WhatsApp Web session; its operation list comes from BROWSER_PLATFORM_OPERATIONS and only the notes here apply.
 */
export function whatsappCapabilities(): PlatformCapabilities {
  const unsupported = r(
    [],
    "Public publishing, comments and discovery are not implemented. Supported messages may include one uploaded image or video.",
    true,
  );
  const inbox = r(
    SCOPES,
    "Signed WhatsApp Business Account webhooks deliver incoming text messages. The Cloud API has no historical inbox.",
  );
  const api: OperationRequirements = {
    ...NOT_YET,
    publish: unsupported,
    media: r(
      SCOPES,
      "One host-uploaded PNG/JPEG image or MP4 video in a permitted 24-hour customer reply; captions fit 1024 characters.",
    ),
    "comments.read": unsupported,
    reply: unsupported,
    comment: unsupported,
    "inbox.read": inbox,
    "message.reply": r(
      SCOPES,
      "Text or single-image/video replies within 24 hours of an inbound customer message.",
    ),
    "message.start": r(
      ["whatsapp_business_messaging"],
      "Business-initiated messages only from an approved template. Free-form text outside the 24-hour customer window is rejected.",
    ),
    search: unsupported,
    webhook: inbox,
    poll: unsupported,
  };
  // Overrides come after NOT_YET so the reason text is specific; reasonCode stays unsupported.not_yet.
  api["audience.collect"] = r(
    [],
    "The Cloud API has no list of past senders. Inbound senders are recorded from the signed webhook.",
    true,
  );
  return {
    api,
    browser: {
      "inbox.read":
        "Visible personal chats only: direct chats are read in bounded batches, groups are skipped. Media-only messages are not read.",
      "message.reply":
        "Replies in a visible personal chat, text with at most one image or video. Groups are not written to.",
      "message.start":
        "One message to one chat per job. Bulk, campaign, program, plan and rule-driven sends are refused for personal accounts.",
      media: "One image or video attachment in a personal chat; the composer must be empty.",
      poll: "Visible personal chats only. Each poll advances through the chat list even when a chat is skipped.",
    },
  };
}
