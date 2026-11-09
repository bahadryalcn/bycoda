import { autonomyLevel } from "../../../src/features/social/model/autonomy";
import type { OutreachChannel } from "../../../src/features/social/model/outreach";
import type {
  SocialAccount,
  SocialJob,
  SocialPlatform,
  SocialThread,
} from "../../../src/features/social/model/social";
import {
  fallbackAllowed,
  type SocialAdapter,
  type SocialSendResult,
} from "../../../src/integrations/social/adapter";
import { assertSendable } from "../autonomy/suppression";
import type { SocialPrincipal } from "../social";
import {
  authorizeAutonomous,
  isAiJob,
  revalidateAutonomy,
  type AutonomyDecision,
  type AutonomyDeps,
} from "../autonomy/autonomy-gate";
import { readAutonomyPolicy } from "../autonomy/autonomy-policy";
import type { SocialAudienceStore } from "../store/social-audience-store";
import type { SocialServiceInternals } from "../core/social-internals";

/** B03 / owner decision D10: a rate-limited or processing job stops retrying after this. */
export const RETRY_ATTEMPT_LIMIT = 8;
export const RETRY_WINDOW_MS = 72 * 60 * 60 * 1000;

/** Whether a requeue-able job has used its retry budget. Such jobs move to review, never resend. */
export function retryExhausted(job: SocialJob, now: number): boolean {
  // shortcut: the window counts from job creation, not from the first attempt; no first-attempt field exists.
  return job.attempts >= RETRY_ATTEMPT_LIMIT || now - job.createdAt >= RETRY_WINDOW_MS;
}

/**
 * D10 before a send: a job that already failed with a retryable error and has spent its budget
 * goes to review instead of being resent. Fresh scheduled work (no attempt yet) and jobs an owner
 * requeued from human review (error cleared) keep their normal dispatch. Returns true when held.
 */
// shortcut: "already failed" is inferred from attempts and error; add an explicit retry marker to the job when this inference misfires.
export async function holdExhaustedRetry(
  s: Pick<SocialServiceInternals, "writeJob" | "now">,
  job: SocialJob,
): Promise<boolean> {
  if (job.attempts === 0 || job.error === undefined || !retryExhausted(job, s.now())) return false;
  job.status = "review";
  job.reviewReason = "retry_exhausted";
  await s.writeJob(job);
  return true;
}

const PERMISSION = {
  publish: "publish",
  reply: "reply",
  message: "message",
  comment: "comment",
} as const;

/**
 * Execution-time authority that does not depend on the content: the AI stop for AI-originated
 * jobs, the project grant (B06, a revoked grant cancels the queued job), and the autonomy re-check.
 */
export async function assertJobAuthority(
  s: SocialServiceInternals,
  job: SocialJob,
  account: SocialAccount,
): Promise<void> {
  if (isAiJob(job) && (await s.setting("ai.stopped")) === "true")
    throw new Error("AI actions are stopped by the owner.");
  for (const projectId of job.projectIds)
    if (!account.grants[projectId]?.includes(PERMISSION[job.kind]))
      throw new Error("Project grant was revoked before dispatch.");
  await revalidateAutonomy(s, job);
}

/**
 * Hybrid mode (plan section 4): the API adapter runs first. The browser adapter is tried once
 * only for errors raised before the platform accepted the content, and only when the account
 * has a browser fallback. Outcome-uncertain errors never reach the browser.
 */
export async function sendWithFallback(
  account: SocialAccount,
  job: SocialJob,
  primary: SocialAdapter,
  browser: SocialAdapter | undefined,
  send: (adapter: SocialAdapter, target: SocialAccount) => Promise<SocialSendResult>,
): Promise<SocialSendResult> {
  try {
    return await send(primary, account);
  } catch (error) {
    // The adapter failed before submit, so the dispatch marker set by the caller is not a submit.
    const notSubmitted = { ...job, dispatchedAt: undefined };
    const browserSupports =
      account.fallback === "browser" && account.connection !== "browser" && !!browser;
    if (!browser || !fallbackAllowed(notSubmitted, error, browserSupports)) throw error;
    return await send(browser, { ...account, connection: "browser" });
  }
}

/** Owner approval of a draft or campaign releases the jobs that were held for it. */
export async function releaseAwaitingApproval(
  s: Pick<SocialServiceInternals, "jobArchive" | "writeJob" | "now">,
  field: "draftId" | "campaignId",
  id: string,
): Promise<void> {
  for await (const page of s.jobArchive.jobPages(
    `json_extract(value,'$.${field}')=? AND status='review' AND json_extract(value,'$.reviewReason')='awaiting_approval'`,
    [id],
  ))
    for (const job of page) {
      job.status = "queued";
      delete job.reviewReason;
      job.scheduledAt = s.now();
      await s.writeJob(job);
    }
}

/** Channel a send is checked against. Opt-outs use "all", which every channel matches. */
function sendChannel(
  platform: SocialPlatform,
  kind: SocialJob["kind"],
  thread?: SocialThread,
): OutreachChannel {
  if (platform === "whatsapp" || platform === "telegram") return platform;
  return kind === "message" || (kind === "reply" && thread?.kind === "message") ? "dm" : "comment";
}

/**
 * Per-account autonomy decisions for an unapproved campaign. Any account that needs the owner
 * (suggest) refuses the whole campaign, as before; "approve" accounts hold their jobs for review.
 */
export async function campaignDecisions(
  deps: AutonomyDeps,
  principal: SocialPrincipal,
  campaign: { variants: { accountId: string }[] },
  approved: boolean,
): Promise<Map<string, AutonomyDecision>> {
  const decisions = new Map<string, AutonomyDecision>();
  if (approved) return decisions;
  for (const variant of campaign.variants)
    decisions.set(
      variant.accountId,
      await authorizeAutonomous(deps, {
        accountId: variant.accountId,
        action: "publish",
        principal,
      }),
    );
  if (!decisions.size || [...decisions.values()].some((item) => item.mode === "suggest"))
    throw new Error("Owner must approve this exact campaign preview first.");
  return decisions;
}

/** Send-time suppression for a contact target, with the channel derived from the job. */
export async function assertContactSendable(
  s: Pick<SocialServiceInternals, "audience" | "get" | "now">,
  contactId: string,
  platform: SocialPlatform,
  kind: SocialJob["kind"],
  thread?: SocialThread,
): Promise<void> {
  await assertSendable(s, { contactId }, sendChannel(platform, kind, thread));
}

/**
 * Owner approval for a reply, message or comment. Covered sends (owner approval or a rule) skip
 * the decision; "suggest" keeps the existing refusal; other levels return the decision.
 */
export async function draftAutonomy(
  deps: AutonomyDeps,
  principal: SocialPrincipal,
  accountId: string,
  kind: "reply" | "message" | "comment",
  covered: boolean,
): Promise<AutonomyDecision | undefined> {
  if (covered) return undefined;
  const decision = await authorizeAutonomous(deps, { accountId, action: kind, principal });
  if (decision.mode === "suggest")
    throw new Error("Owner approval required for this exact recipient/content.");
  return decision;
}

/** Job status and approval fields for a decision; "approve" holds the job for owner review. */
export function approvalJobFields(
  decision: AutonomyDecision | undefined,
  fallbackAt: number,
): Pick<SocialJob, "status" | "reviewReason" | "approval" | "scheduledAt"> {
  if (decision?.mode === "approve")
    return { status: "review", reviewReason: "awaiting_approval", scheduledAt: fallbackAt };
  if (decision?.mode === "autonomous")
    return { status: "queued", approval: decision.approval, scheduledAt: decision.scheduledAt };
  return { status: "queued", scheduledAt: fallbackAt };
}

/** Publish level "autonomous": AI may publish without a per-campaign owner approval. */
export async function publishIsAutonomous(
  audience: SocialAudienceStore,
  accountId: string,
): Promise<boolean> {
  return autonomyLevel(await readAutonomyPolicy(audience, accountId), "publish") === "autonomous";
}

/**
 * Unattended publication by a program occurrence or a publishing plan. Only an account whose
 * publish level is "autonomous" gets a decision; every other level returns undefined and keeps
 * the owner-approval path. The decision is checked again at each dispatch (revalidateAutonomy).
 */
export async function automationPublish(
  deps: AutonomyDeps,
  accountId: string,
  automation: { kind: "program" | "publishing-plan"; id: string; projectId: string },
): Promise<AutonomyDecision | undefined> {
  if (!(await publishIsAutonomous(deps.audience, accountId))) return undefined;
  return await authorizeAutonomous(deps, {
    accountId,
    action: "publish",
    principal: {
      kind: "external",
      actorId: `${automation.kind}:${automation.id}`,
      provider: automation.kind,
      projectId: automation.projectId,
    },
  });
}
