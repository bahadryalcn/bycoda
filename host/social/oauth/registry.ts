import type { SocialPlatform } from "../../../src/features/social/model/social";
import type { OAuthPlatformConfig } from "./oauth-platform";
import { facebookOAuth } from "./facebook";
import { instagramOAuth } from "./instagram";
import { linkedinOAuth } from "./linkedin";
import { redditOAuth } from "./reddit";
import { snapchatOAuth } from "./snapchat";
import { tiktokOAuth } from "./tiktok";
import { xOAuth } from "./x";
import { youtubeOAuth } from "./youtube";

/** WhatsApp and Telegram use host token connections and have no entry here. */
export const OAUTH_PLATFORMS: Partial<Record<SocialPlatform, OAuthPlatformConfig>> = {
  x: xOAuth,
  instagram: instagramOAuth,
  facebook: facebookOAuth,
  linkedin: linkedinOAuth,
  youtube: youtubeOAuth,
  tiktok: tiktokOAuth,
  snapchat: snapchatOAuth,
  reddit: redditOAuth,
};

/** The enabled OAuth definition, or undefined for token-connection, disabled or unknown platforms. */
export function enabledOAuthPlatform(platform: SocialPlatform): OAuthPlatformConfig | undefined {
  const definition = OAUTH_PLATFORMS[platform];
  return definition?.enabled ? definition : undefined;
}
