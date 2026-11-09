import type { SocialJob } from "../../src/features/social/model/social";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import { needsHumanError } from "./browser/challenge";
import { UnexpectedScreen } from "./browser-layers/types";
import { messagingRecipe } from "./social-browser-messaging-shared";
import { whatsappLinkScreen } from "./social-browser-whatsapp-login";
import { screenSummary, whatsappPoll } from "./social-browser-whatsapp-poll";
import type { BrowserRecipe, BrowserRecipeContext } from "./social-browser-recipe";

const shared = messagingRecipe("whatsapp");

const isDirectMessage = (job: SocialJob): boolean =>
  (job.kind === "message" || (job.kind === "reply" && !job.payload.postId)) &&
  !!job.payload.recipientId;

/**
 * Personal accounts do not run bulk messaging (owner rule, B11). A job that belongs to a campaign, program,
 * publishing plan, rule or occurrence is bulk-capable, so it is refused before any browser interaction.
 */
export function isPersonalBulkJob(job: SocialJob): boolean {
  return (
    job.kind === "message" &&
    !!(job.campaignId || job.programId || job.publishingPlanId || job.occurrenceId || job.ruleId)
  );
}

/**
 * WhatsApp Web personal messaging. Sending uses the shared code. Reading is WhatsApp-specific (B08). A visible
 * link-device (QR) screen is reported as NEEDS_HUMAN by identity, which the send, poll and verify paths all call.
 * The QR image is never read or scanned here.
 */
export const whatsappBrowserRecipe: BrowserRecipe = {
  ...shared,
  async identity(page, account) {
    const identity = await shared.identity(page, account);
    if (identity) return identity;
    const hit = await whatsappLinkScreen(page);
    if (hit) throw needsHumanError(hit);
    return undefined;
  },
  async send(context: BrowserRecipeContext, job: SocialJob) {
    if (isPersonalBulkJob(job))
      throw new SocialPlatformError("rejected", undefined, {
        reasonCode: "whatsapp.personal_bulk_blocked",
      });
    try {
      return await shared.send(context, job);
    } catch (error) {
      // An unsupported outcome before the submit click means an expected element is missing.
      if (
        error instanceof SocialPlatformError &&
        error.code === "unsupported" &&
        isDirectMessage(job)
      )
        throw new UnexpectedScreen(await screenSummary(context.page));
      throw error;
    }
  },
  poll: (context, _posts, cursor) => whatsappPoll(context, cursor),
};
