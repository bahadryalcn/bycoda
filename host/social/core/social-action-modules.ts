import { accountRequestActions } from "../accounts/account-request-actions";
import { aiActions } from "../ai/ai-actions";
import { audienceActions } from "../audience/audience-actions";
import { autonomyActions } from "../autonomy/autonomy-actions";
import { browserLayerActions } from "../browser-layers/browser-layer-actions";
import { inboxActions } from "../inbox/inbox-actions";
import { instagramActions } from "../inbox/instagram-actions";
import { outreachActions } from "../outreach/outreach-actions";
import { youtubeActions } from "../youtube/youtube-actions";
import type { SocialActionModule } from "./social-actions";
import { createXActions } from "./x-actions";

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
];
