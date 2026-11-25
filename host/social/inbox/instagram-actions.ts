import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import type { SocialActionContext, SocialActionModule } from "../core/social-actions";
import { exact, finite, str } from "../core/social-helpers";

async function instagramAccount(ctx: SocialActionContext, accountId: string) {
  const account = await ctx.service.access(ctx.principal, accountId, "read");
  if (account.platform !== "instagram" || account.connection === "browser")
    throw new SocialPlatformError("unsupported");
  return account;
}

async function instagramToken(ctx: SocialActionContext, accountId: string) {
  const credential = await ctx.service.credentialFor(accountId);
  if (!credential?.accessToken) throw new SocialPlatformError("expired");
  return credential.accessToken;
}

export const instagramActions: SocialActionModule = {
  "instagram.mentions": {
    readOnly: true,
    ownerOnly: false,
    tool: true,
    async run(ctx, input) {
      exact(input, ["accountId", "cursor"]);
      const account = await instagramAccount(ctx, str(input.accountId, "account"));
      ctx.service.capability(account, "webhook");
      const cursor = input.cursor === undefined ? undefined : str(input.cursor, "cursor", 16);
      return ctx.store.instagramMentions(account.id, cursor);
    },
  },
  "instagram.insights": {
    readOnly: true,
    ownerOnly: false,
    tool: true,
    async run(ctx, input) {
      exact(input, ["accountId", "mediaId", "demographics", "since", "until"]);
      const account = await instagramAccount(ctx, str(input.accountId, "account"));
      ctx.service.capability(account, "analytics");
      const adapter = ctx.service.adapterFor(account);
      if (!adapter.instagramInsights) throw new SocialPlatformError("unsupported");
      const demographics = input.demographics;
      if (
        demographics !== undefined &&
        demographics !== "age" &&
        demographics !== "gender" &&
        demographics !== "country" &&
        demographics !== "city"
      )
        throw new Error("Invalid Instagram demographic breakdown.");
      return adapter.instagramInsights(account, await instagramToken(ctx, account.id), {
        mediaId: input.mediaId === undefined ? undefined : str(input.mediaId, "media", 100),
        demographics,
        since: input.since === undefined ? undefined : finite(input.since, "since", 1),
        until: input.until === undefined ? undefined : finite(input.until, "until", 1),
      });
    },
  },
  "instagram.comments.moderate": {
    readOnly: false,
    ownerOnly: true,
    async run(ctx, input) {
      exact(input, ["threadId", "commentId", "action", "confirm"]);
      const action = input.action;
      if (action !== "hide" && action !== "unhide" && action !== "delete")
        throw new Error("Invalid Instagram moderation action.");
      if (input.confirm !== "MODERATE_INSTAGRAM_COMMENT")
        throw new Error("Confirm this Instagram moderation action.");
      const thread = await ctx.service.thread(str(input.threadId, "conversation"));
      if (!thread || thread.kind !== "comment" || thread.replyAllowed === false)
        throw new Error("Instagram comment conversation not found.");
      const commentId = str(input.commentId, "comment", 100);
      if (
        !thread.events.some(
          (event) => event.direction === "inbound" && event.platformId === commentId,
        )
      )
        throw new Error("Instagram comment is no longer in this conversation.");
      const account = await instagramAccount(ctx, thread.accountId);
      ctx.service.capability(account, "comments.read");
      const adapter = ctx.service.adapterFor(account);
      if (!adapter.instagramCommentAction) throw new SocialPlatformError("unsupported");
      await adapter.instagramCommentAction(
        account,
        await instagramToken(ctx, account.id),
        commentId,
        action,
      );
      return { accountId: account.id, commentId, action };
    },
  },
};
