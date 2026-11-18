import type { SocialOperation } from "../adapter";
import { NOT_YET, r, type CapabilityRequirement, type PlatformCapabilities } from "./shared";

/**
 * Public Profile API actions and verified browser-only Snapchat surfaces.
 */
export function snapchatCapabilities(): PlatformCapabilities {
  const unsupported = r(
    [],
    "The Public Profile API does not offer this Snapchat operation.",
    true,
  );
  const api: Record<SocialOperation, CapabilityRequirement> = {
    ...NOT_YET,
    publish: r(
      ["snapchat-profile-api"],
      "Publish Spotlight, Public Stories and Saved Stories through an allowlisted Snap Public Profile API app. Unconfirmed submissions are held for review.",
    ),
    media: r(
      ["snapchat-profile-api"],
      "Use Host-uploaded media for the selected Snapchat format. The Public Profile API encrypts media uploads.",
    ),
    "comments.read": unsupported,
    reply: unsupported,
    comment: unsupported,
    "inbox.read": unsupported,
    "message.reply": unsupported,
    "message.start": unsupported,
    search: unsupported,
    webhook: unsupported,
    poll: unsupported,
  };
  return {
    api: {
      ...api,
      // Snapchat Public Profile API
      delete: r(["snapchat-profile-api"], "Delete an exact Spotlight or Saved Story after owner review."),
      analytics: r(["snapchat-profile-api"], "Read Public Profile, content, and aggregate subscriber metrics. Earnings require creator access."),
      "profile.read": r(["snapchat-profile-api"], "Read the connected Public Profile and list its published content."),
      "audience.collect": r(
        [],
        "The Public Profile API exposes no audience source in this adapter. Existing chat contacts are collected through the browser connection of a member account.",
        true,
      ),
    },
    browser: {
      publish:
        "Spotlight is confirmed only when the posted Spotlight is read back from the Public Profile list. Public Story uploads and unreadable results are held for review. Creator Terms must already be accepted in the browser.",
      media:
        "One owner-uploaded 5–60 second MP4 of at least 540 × 960 pixels for a Spotlight or Public Story.",
      "inbox.read":
        "Existing one-to-one chats of the signed-in member account, read from the visible chat list. New conversations and media are not supported.",
      "message.reply":
        "Replies in an existing chat only: the exact thread and recipient are verified before typing, and the sent message is read back. Text only.",
      // Snapchat member chats
      "message.start": "Start a text chat only after the exact username is verified in the connected member's friends list.",
      poll: "Bounded visible snapshots of up to two existing chats per run. An unrecognized layout is handed to the layered browser driver instead of reporting an empty inbox.",
      "audience.collect":
        "Contacts of existing chats on the signed-in member account, limited to what the chat list shows.",
    },
  };
}
