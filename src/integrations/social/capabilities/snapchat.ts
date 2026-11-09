import type { SocialOperation } from "../adapter";
import { NOT_YET, r, type CapabilityRequirement, type PlatformCapabilities } from "./shared";

/**
 * API: Public Profile Spotlight only. Marketing API and Creative Kit are deferred and have no
 * operation row (they are not implemented). Browser: Public Profile Spotlight/Story uploads and
 * existing member chats; each row says what the browser path can and cannot confirm.
 */
export function snapchatCapabilities(): PlatformCapabilities {
  const unsupported = r(
    [],
    "Public Profile connection and Spotlight publishing only. Comments, messaging, Stories, metrics and audience collection are not implemented in this API adapter. Marketing API and Creative Kit are deferred.",
    true,
  );
  const api: Record<SocialOperation, CapabilityRequirement> = {
    ...NOT_YET,
    publish: r(
      ["snapchat-profile-api"],
      "Spotlight video publishing through an allowlisted Snap Public Profile API app. One uploaded MP4, explicit locale and verified API profile are required; processing is tracked by the exact Spotlight ID until LIVE. Stories and messaging are not implemented in this API adapter.",
    ),
    media: r(
      ["snapchat-profile-api"],
      "One host-uploaded 6–60 second MP4 of at least 540 × 960 pixels, encrypted for the Public Profile media upload. No credentials or encryption keys are stored in job progress.",
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
      ...NOT_YET,
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
      poll: "Bounded visible snapshots of up to two existing chats per run. An unrecognized layout is handed to the layered browser driver instead of reporting an empty inbox.",
      "audience.collect":
        "Contacts of existing chats on the signed-in member account, limited to what the chat list shows.",
    },
  };
}
