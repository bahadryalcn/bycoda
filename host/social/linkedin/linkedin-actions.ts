import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import type { LinkedInAnalyticsQuery } from "../../../src/integrations/social/adapters/linkedin-analytics";
import type { SocialActionContext, SocialActionModule } from "../core/social-actions";
import { exact, str } from "../core/social-helpers";
import { ownedLinkedInPublication } from "./linkedin-publication";
import { linkedinManagementActions } from "./linkedin-management-actions";
import { linkedinLiveActions } from "./linkedin-live";
import { linkedinCreatorActions } from "./linkedin-creator-actions";

async function analytics(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["accountId", "kind", "jobId"]);
  const accountId = str(input.accountId, "account");
  const account = await ctx.service.access(ctx.principal, accountId, "read");
  if (account.platform !== "linkedin" || account.connection !== "oauth")
    throw new SocialPlatformError("unsupported");
  if (!account.connected) throw new SocialPlatformError("expired");
  const kind = input.kind;
  if (kind !== "posts" && kind !== "page" && kind !== "followers")
    throw new Error("Choose LinkedIn post, Page or follower analytics.");
  const query: LinkedInAnalyticsQuery = { kind };
  if (input.jobId !== undefined) {
    if (kind !== "posts") throw new Error("A publication job is only valid for post analytics.");
    query.postId = await ownedLinkedInPublication(ctx, accountId, input.jobId);
  }
  const adapter = ctx.service.adapterFor(account);
  if (!adapter.linkedinAnalytics) throw new SocialPlatformError("unsupported");
  const credential = await ctx.service.credentialFor(accountId);
  if (!credential || (credential.expiresAt !== undefined && credential.expiresAt <= ctx.now()))
    throw new SocialPlatformError("expired");
  const current = await ctx.service.access(ctx.principal, accountId, "read");
  if (
    !current.connected ||
    current.platformId !== account.platformId ||
    current.connection !== "oauth"
  )
    throw new SocialPlatformError("denied");
  return await adapter.linkedinAnalytics(current, credential.accessToken, query);
}

export const linkedinActions: SocialActionModule = {
  "linkedin.analytics": { readOnly: true, ownerOnly: false, tool: true, run: analytics },
  ...linkedinManagementActions,
  ...linkedinLiveActions,
  ...linkedinCreatorActions,
};
