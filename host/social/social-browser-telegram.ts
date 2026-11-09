import type { SocialJob } from "../../src/features/social/model/social";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import { UnexpectedScreen } from "./browser-layers/types";
import { messagingRecipe } from "./social-browser-messaging-shared";
import { screenSummary, telegramPoll } from "./social-browser-telegram-poll";
import type { BrowserRecipe, BrowserRecipeContext } from "./social-browser-recipe";

const shared = messagingRecipe("telegram");

const isDirectMessage = (job: SocialJob): boolean =>
  (job.kind === "message" || (job.kind === "reply" && !job.payload.postId)) &&
  !!job.payload.recipientId;

/**
 * Telegram Web personal messaging. Sending stays in the shared messaging code, which refuses before any
 * submit. Reading and screen handling are Telegram-specific (B08, B34). Challenges are caught by the
 * shared verifyIdentity path and become needs_human; this recipe never interacts with them.
 */
export const telegramBrowserRecipe: BrowserRecipe = {
  ...shared,
  async send(context: BrowserRecipeContext, job: SocialJob) {
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
  poll: (context, _posts, cursor) => telegramPoll(context, cursor),
};
