import { SocialHttp, type SocialAdapters } from "./adapter";
import { createFacebookAdapter } from "./adapters/facebook";
import { createInstagramAdapter } from "./adapters/instagram";
import { createLinkedInAdapter } from "./adapters/linkedin";
import { createRedditAdapter } from "./adapters/reddit";
import { createTelegramAdapter } from "./adapters/telegram-bot";
import { createWhatsAppAdapter } from "./adapters/whatsapp";
import { createXAdapter } from "./adapters/x";
import { createSnapchatAdapter } from "./snapchat";
import { createTelegramChannelAdapter } from "./telegramChannel";
import { createTikTokAdapter } from "./tiktok";
import { createYouTubeAdapter } from "./youtube";

export { contentSupport } from "./content-support";

/** Composes the per-platform adapters. Platform code lives in ./adapters and the platform modules. */
export function createSocialAdapters(
  http = new SocialHttp(),
  graphVersion = "v25.0",
  linkedinVersion = "202609",
): SocialAdapters {
  if (!/^v\d+\.0$/.test(graphVersion) || !/^20\d{4}$/.test(linkedinVersion))
    throw new Error("Invalid social API version.");
  const telegramBot = createTelegramAdapter(http);
  const telegramChannel = createTelegramChannelAdapter(http);
  return {
    x: createXAdapter(http),
    instagram: createInstagramAdapter(http, graphVersion),
    facebook: createFacebookAdapter(http, graphVersion),
    linkedin: createLinkedInAdapter(http, linkedinVersion),
    youtube: createYouTubeAdapter(http),
    tiktok: createTikTokAdapter(http),
    snapchat: createSnapchatAdapter(http),
    whatsapp: createWhatsAppAdapter(http, graphVersion),
    telegram: {
      send: (...args) =>
        (args[0].accountType === "channel" ? telegramChannel : telegramBot).send(...args),
      poll: (...args) =>
        (args[0].accountType === "channel" ? telegramChannel : telegramBot).poll(...args),
    },
    reddit: createRedditAdapter(http),
  };
}
