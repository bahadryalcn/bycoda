import type { SocialActionContext, SocialActionModule } from "../core/social-actions";
import { exact } from "../core/social-helpers";
import { setInboxStatus, unifiedInbox } from "./inbox-unified";
import { inboxReplyOptions, inboxTimeline } from "./inbox-thread-ops";
import {
  AUTO_REFRESH_KEY,
  INBOX_INTERVALS_KEY,
  readInboxSettings,
  validateIntervals,
} from "./inbox-settings";

/** Unified inbox, thread status, timelines and inbox settings (Phase 4C). Flags are the section 3 contract. */
export const inboxActions: SocialActionModule = {
  "inbox.unified": {
    readOnly: true,
    ownerOnly: false,
    tool: true,
    run: (ctx, input) => unifiedInbox(ctx, input),
  },
  "inbox.setStatus": {
    readOnly: false,
    ownerOnly: false,
    tool: true,
    run: (ctx, input) => setInboxStatus(ctx, input),
  },
  "inbox.timeline": {
    readOnly: true,
    ownerOnly: false,
    tool: true,
    run: (ctx, input) => inboxTimeline(ctx, input),
  },
  "inbox.replyOptions": {
    readOnly: true,
    ownerOnly: false,
    tool: true,
    run: (ctx, input) => inboxReplyOptions(ctx, input),
  },
  "inbox.settings": {
    readOnly: false,
    ownerOnly: true,
    run: (ctx, input) => updateInboxSettings(ctx, input),
  },
};

/**
 * Owner sets auto-refresh and, when given, replaces the per-platform periods. The legacy
 * `inbox.polling` action writes the same auto-refresh value.
 */
async function updateInboxSettings(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["autoRefresh", "intervals"]);
  if (typeof input.autoRefresh !== "boolean") throw new Error("Invalid auto-refresh setting.");
  await ctx.service.setSetting(AUTO_REFRESH_KEY, input.autoRefresh ? "true" : "false");
  if (input.intervals !== undefined)
    await ctx.service.setSetting(
      INBOX_INTERVALS_KEY,
      JSON.stringify(validateIntervals(input.intervals)),
    );
  return await readInboxSettings(ctx.service);
}
