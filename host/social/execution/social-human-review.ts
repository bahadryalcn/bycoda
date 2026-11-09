import type { SocialJob } from "../../../src/features/social/model/social";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { NeedsHumanQueue } from "../browser-layers/needs-human";
import { UnexpectedScreen, type NeedsHumanKind } from "../browser-layers/types";
import type { SocialServiceInternals } from "../core/social-internals";

/** Review reasons that mean "a person must look at the page". The Host never retries these jobs. */
export const HUMAN_REVIEW_REASONS = ["needs_human", "unexpected_screen"] as const;

/**
 * Holds a job whose browser page needs a person: an unrecognized screen, or a captcha, verification
 * or suspicious-login page. Records a needs-human item and moves the job to review. Returns false
 * for any other error so the caller keeps its normal handling.
 */
export async function holdForHuman(
  s: Pick<SocialServiceInternals, "audience" | "now">,
  job: SocialJob,
  accountId: string,
  error: unknown,
): Promise<boolean> {
  const screen = error instanceof UnexpectedScreen ? error : undefined;
  const human =
    error instanceof SocialPlatformError && error.code === "needs_human" ? error : undefined;
  if (!screen && !human) return false;
  const kind: NeedsHumanKind = screen ? "unexpected" : "verification";
  const url = screen ? screen.snapshot.url : (human?.detail?.url ?? "");
  const screenshotId = human?.detail?.screenshotId;
  await new NeedsHumanQueue(s.audience, s.now).open({
    accountId,
    kind,
    url,
    jobId: job.id,
    ...(screenshotId === undefined ? {} : { screenshotId }),
  });
  job.status = "review";
  job.reviewReason = screen ? "unexpected_screen" : "needs_human";
  job.error = screen
    ? "The page did not match the expected layout. A person must check it."
    : "A person must complete a verification step in the browser.";
  return true;
}

/**
 * Owner resolved the needs-human item: a job in human review goes back to the queue once, and runs
 * again only through the normal gates. Any other job is refused.
 */
export function requeueJobForHuman(job: SocialJob, now: number): SocialJob {
  if (job.status !== "review" || !HUMAN_REVIEW_REASONS.includes(job.reviewReason as never))
    throw new Error("This job is not waiting for a person.");
  job.status = "queued";
  delete job.reviewReason;
  delete job.error;
  job.scheduledAt = now;
  return job;
}
