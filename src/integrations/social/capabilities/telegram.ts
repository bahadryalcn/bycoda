import type { SocialAccount, SocialOperation } from "../adapter";
import {
  NOT_YET,
  r,
  type CapabilityRequirement,
  type OperationRequirements,
  type PlatformCapabilities,
} from "./shared";

/**
 * Telegram API rows describe the Bot API token connections only. Personal Telegram Web sessions use
 * browser operations from BROWSER_PLATFORM_OPERATIONS, and MTProto personal clients are not implemented.
 */
export function telegramCapabilities(type: SocialAccount["accountType"]): PlatformCapabilities {
  const unsupported = r(
    [],
    "Public publishing, comments and discovery are not implemented. Supported messages may include one uploaded image or video.",
    true,
  );
  const base: Record<SocialOperation, CapabilityRequirement> = {
    publish: unsupported,
    media: unsupported,
    "comments.read": unsupported,
    reply: unsupported,
    comment: unsupported,
    "inbox.read": unsupported,
    "message.reply": unsupported,
    "message.start": unsupported,
    search: unsupported,
    webhook: unsupported,
    poll: unsupported,
    delete: unsupported,
    analytics: unsupported,
    "audience.collect": unsupported,
    "profile.read": unsupported,
  };
  // NOT_YET marks the operations no platform opens yet; the overrides below must come after it.
  const api: OperationRequirements = { ...base, ...NOT_YET };
  if (type === "channel") {
    api.publish = r(
      ["channel.publish"],
      "Publish to the exact Telegram channel using its verified administrator bot. Current bot identity, channel identity and can_post_messages rights are checked before every approved publication. Channel creation and direct messages are separate operations.",
    );
    api.media = r(
      ["channel.publish"],
      "One host-uploaded PNG/JPEG image up to 10 MiB or MP4 up to 50 MiB; media captions fit 1024 UTF-16 characters. Channel text posts fit 4096 UTF-16 characters.",
    );
    api.delete = r(
      ["channel.publish"],
      "Deletes a post this bot published in the verified channel, when the bot still has delete rights.",
    );
  } else {
    api.media = r(
      ["bot.send"],
      "One host-uploaded PNG/JPEG image up to 10 MiB or MP4 up to 50 MiB in an existing bot chat; captions fit 1024 characters. Bot and chat permissions apply.",
    );
    api["inbox.read"] = r(
      ["bot.poll"],
      "Incoming bot text messages via getUpdates. An existing webhook must be removed by its owner before polling.",
    );
    api.poll = api["inbox.read"];
    api["message.reply"] = r(
      ["bot.send"],
      "Reply in a chat accessible to the bot; group privacy and chat permissions apply.",
    );
    api["message.start"] = r(
      [],
      "Bots cannot start a conversation. The user must message the bot first.",
      true,
    );
    api.delete = r(
      ["bot.send"],
      "Deletes a message this bot sent, when Telegram allows deletion in that chat.",
    );
    api["audience.collect"] = r(
      ["bot.poll"],
      "Private users who messaged the bot, read from its pending updates. Telegram keeps unconfirmed updates for a limited time; reading does not advance the inbox cursor.",
    );
    api.webhook = r(
      [],
      "Webhook ingest is not enabled on this host yet. Polling stays the default.",
      true,
    );
  }
  return { api, browser: {} };
}
