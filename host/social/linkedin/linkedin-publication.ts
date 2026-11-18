import type { SocialJob } from "../../../src/features/social/model/social";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import type { SocialActionContext } from "../core/social-actions";
import { str } from "../core/social-helpers";

export async function ownedLinkedInPublication(
  ctx: SocialActionContext,
  accountId: string,
  jobId: unknown,
) {
  const job = (await ctx.service.call(ctx.principal, "jobs.status", {
    id: str(jobId, "publication job"),
  })) as SocialJob;
  if (
    job.accountId !== accountId ||
    job.kind !== "publish" ||
    job.status !== "succeeded" ||
    typeof job.platformId !== "string" ||
    !/^urn:li:(?:share|ugcPost):[1-9]\d{0,24}$/.test(job.platformId)
  )
    throw new SocialPlatformError("denied");
  return job.platformId;
}
