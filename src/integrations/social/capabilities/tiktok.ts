import type { SocialOperation } from "../adapter";
import {
  NOT_YET,
  r,
  type BrowserNotes,
  type CapabilityRequirement,
  type PlatformCapabilities,
} from "./shared";

/**
 * Hashtag and keyword search needs TikTok Research API access, which this app does not hold, and no browser
 * search recipe exists, so the row is NOT_SUPPORTED. capabilities.ts reads `reasonCode` once the owner change
 * in the phase4 TikTok done file is applied; until then the row reports `unsupported.platform`.
 */
export const TIKTOK_SEARCH_REQUIREMENT: CapabilityRequirement & { reasonCode: string } = {
  ...r(
    [],
    "Hashtag and keyword search needs TikTok Research API access, which this app does not have. No browser search is implemented.",
    true,
  ),
  reasonCode: "tiktok.search_requires_research_api",
};

const BROWSER_NOTES: BrowserNotes = {
  publish:
    "Browser publishing uploads one video through TikTok Studio. Photo posts and inbox drafts need the API connection.",
  "audience.collect":
    "Collects commenters from this account's own recent videos in TikTok Studio, bounded to videos already published here.",
};

export function tiktokCapabilities(): PlatformCapabilities {
  const unsupported = r(
    [],
    "Comment and DM management needs eligible TikTok for Business/Organic API access. These adapters are not implemented.",
    true,
  );
  const api: Record<SocialOperation, CapabilityRequirement> = {
    ...NOT_YET,
    publish: r(
      ["user.info.basic", "video.publish"],
      "Direct Post video or photo publishing from TikTok-verified HTTPS URLs. Current creator settings, explicit visibility, media previews, music consent and app audit/access are required. Inbox draft mode also needs the video.upload permission. Processing is tracked until PUBLISH_COMPLETE; a publication that never completes goes to review.",
    ),
    media: r(
      ["video.publish"],
      "One video or up to four photo URLs from a domain or URL prefix verified in the TikTok developer app. Local API uploads are not implemented; browser video uploads are separate.",
    ),
    "comments.read": unsupported,
    reply: unsupported,
    comment: unsupported,
    "inbox.read": unsupported,
    "message.reply": unsupported,
    "message.start": unsupported,
    search: TIKTOK_SEARCH_REQUIREMENT,
    webhook: unsupported,
    poll: unsupported,
    analytics: r(
      ["user.info.basic", "video.list"],
      "Lists this creator's videos and basic metrics (views, likes, comments, shares) through the TikTok Display API. Requires the video.list permission.",
    ),
    "audience.collect": r(
      [],
      "The TikTok API does not give this app commenter lists. Collect from your own video comments through the browser connection instead.",
      true,
    ),
  };
  return { api, browser: BROWSER_NOTES };
}
