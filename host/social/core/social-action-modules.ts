import { accountRequestActions } from "../accounts/account-request-actions";
import { snapchatActions } from "../accounts/snapchat-actions";
import { aiActions } from "../ai/ai-actions";
import { audienceActions } from "../audience/audience-actions";
import { autonomyActions } from "../autonomy/autonomy-actions";
import { browserLayerActions } from "../browser-layers/browser-layer-actions";
import { inboxActions } from "../inbox/inbox-actions";
import { instagramActions } from "../inbox/instagram-actions";
import { linkedinActions } from "../linkedin/linkedin-actions";
import { instagramModerationRequests } from "../inbox/instagram-moderation-requests";
import { instagramManagementRequests } from "../inbox/instagram-management-requests";
import { outreachActions } from "../outreach/outreach-actions";
import { youtubeActions } from "../youtube/youtube-actions";
import type { SocialActionModule } from "./social-actions";
import { createXActions } from "./x-actions";
import { tiktokActions } from "../tiktok/tiktok-actions";
// Facebook Page actions
import { facebookPageActions } from "./facebook-page-actions";
import { facebookLiveActions } from "../facebook-live/actions";
import { facebookManagementActions } from "./facebook-management-actions";
import { ownerPublishedPostActions } from "./published-post-actions";

/** Every registry action module. Phase 4 adds an action by editing its own module, not this list. */
export const SOCIAL_ACTION_MODULES: SocialActionModule[] = [
  audienceActions,
  outreachActions,
  inboxActions,
  aiActions,
  browserLayerActions,
  autonomyActions,
  accountRequestActions,
  // Instagram
  instagramActions,
  // X API and owner browser handoffs.
  createXActions(),
  // YouTube management.
  youtubeActions,
  // TikTok account operations.
  tiktokActions,
  // Snapchat
  snapchatActions,
  linkedinActions,
  // Facebook Page actions
  facebookPageActions,
  facebookLiveActions,
  facebookManagementActions,
  ownerPublishedPostActions,
  instagramModerationRequests,
  instagramManagementRequests,
];
