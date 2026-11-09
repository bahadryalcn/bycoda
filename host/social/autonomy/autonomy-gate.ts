import {
  autonomyLevel,
  nextWorkingStart,
  withinWorkingHours,
  type AutonomyAction,
  type AutonomyPolicy,
} from "../../../src/features/social/model/autonomy";
import type { SocialApproval, SocialJob } from "../../../src/features/social/model/social";
import type { SocialAudienceStore } from "../store/social-audience-store";
import { isWriteAction } from "./ai-actions-log";
import type { SocialPrincipal } from "../social";
import {
  autonomyLimit,
  nextPolicyDayStart,
  policyDay,
  readAutonomyPolicy,
} from "./autonomy-policy";

/** Structural subset of SocialServiceInternals that the gate needs. */
export type AutonomyDeps = {
  audience: SocialAudienceStore;
  setting: (key: string) => Promise<string | undefined>;
  now: () => number;
};

export type AutonomyApproval = Extract<SocialApproval, { kind: "autonomy" }>;

export type AutonomyDecision =
  | { mode: "suggest" }
  | { mode: "approve" }
  | { mode: "autonomous"; approval: AutonomyApproval; scheduledAt: number };

/** Thrown before submit when an autonomous job must wait (outside hours or over the day's limit). */
export class AutonomyDeferred extends Error {
  constructor(public readonly at: number) {
    super("Autonomous action deferred until the next allowed time.");
  }
}

/** Global stops that every AI-originated send obeys. */
export async function assertAiRunnable(deps: AutonomyDeps): Promise<void> {
  if ((await deps.setting("ai.stopped")) === "true")
    throw new Error("AI actions are stopped by the owner.");
  if ((await deps.setting("stopped")) === "true") throw new Error("Social sending is stopped.");
  if ((await deps.setting("sending")) !== "true")
    throw new Error("External sending is off. Turn it on before autonomous actions run.");
}

/** Only AI-originated jobs are held by the AI stop; owner-created jobs are not. */
export function isAiJob(job: SocialJob): boolean {
  return (
    Boolean(job.sessionId || job.roomSource || job.approval?.kind === "autonomy") ||
    /^(rule:|assistant-thread:)/.test(job.actorId)
  );
}

export function autonomyActionOf(job: Pick<SocialJob, "kind">): AutonomyAction {
  return job.kind === "publish" ? "publish" : job.kind;
}

/**
 * Queue-time decision for an AI principal's send without owner approval. Owner principals and
 * "suggest" levels get the existing refusal; "approve" holds the item for owner review.
 */
export async function authorizeAutonomous(
  deps: AutonomyDeps,
  input: { accountId: string; action: AutonomyAction; principal: SocialPrincipal },
): Promise<AutonomyDecision> {
  if (input.principal.kind === "owner") return { mode: "suggest" };
  const policy = await readAutonomyPolicy(deps.audience, input.accountId);
  const level = autonomyLevel(policy, input.action);
  if (level !== "autonomous") return { mode: level };
  await assertAiRunnable(deps);
  const now = deps.now();
  const scheduledAt = nextWorkingStart(policy, now);
  if (!Number.isFinite(scheduledAt))
    throw new Error("Working hours do not open in the next nine days. Review autonomy settings.");
  const counted = await deps.audience.getCounter(
    input.accountId,
    input.action,
    policyDay(policy, now),
  );
  if (counted >= autonomyLimit(policy, input.action))
    throw new Error("Daily AI limit reached for this account and action.");
  return {
    mode: "autonomous",
    approval: { kind: "autonomy", accountId: input.accountId, version: policy.version },
    scheduledAt,
  };
}

/**
 * Execution-time re-check for a job carrying an autonomy approval. Throws on a changed policy,
 * stop or lowered level; throws AutonomyDeferred when the window or the day's limit is closed.
 */
export async function revalidateAutonomy(deps: AutonomyDeps, job: SocialJob): Promise<void> {
  const approval = job.approval;
  if (approval?.kind !== "autonomy") return;
  const policy = await readAutonomyPolicy(deps.audience, approval.accountId);
  if (policy.version !== approval.version)
    throw new Error("Autonomy policy changed after this action was queued. Review it again.");
  if (autonomyLevel(policy, autonomyActionOf(job)) !== "autonomous")
    throw new Error("Autonomy was lowered for this action.");
  await assertAiRunnable(deps);
  const now = deps.now();
  if (!withinWorkingHours(policy, now)) throw new AutonomyDeferred(nextWorkingStart(policy, now));
  const day = policyDay(policy, now);
  if (approval.counted === day) return;
  const counted = await deps.audience.getCounter(approval.accountId, autonomyActionOf(job), day);
  if (counted >= autonomyLimit(policy, autonomyActionOf(job)))
    throw new AutonomyDeferred(nextPolicyDayStart(policy, now));
}

/**
 * Charges one dispatch to the daily counter. Called once per job inside the dispatch
 * transaction, before dispatchedAt is set; a job already charged is never charged again.
 */
export async function chargeAutonomy(deps: AutonomyDeps, job: SocialJob): Promise<void> {
  const approval = job.approval;
  if (approval?.kind !== "autonomy" || approval.counted) return;
  const policy: AutonomyPolicy = await readAutonomyPolicy(deps.audience, approval.accountId);
  const action = autonomyActionOf(job);
  const day = policyDay(policy, deps.now());
  if (
    (await deps.audience.getCounter(approval.accountId, action, day)) >=
    autonomyLimit(policy, action)
  )
    throw new AutonomyDeferred(nextPolicyDayStart(policy, deps.now()));
  await deps.audience.incrementCounter(approval.accountId, action, day);
  job.approval = { ...approval, counted: day };
}

/** The AI stop blocks every non-read AI action; the stop itself stays allowed. */
export async function assertAiWritable(
  deps: AutonomyDeps,
  principal: SocialPrincipal,
  action: string,
): Promise<void> {
  if (
    principal.kind !== "owner" &&
    action !== "ai.stop" &&
    isWriteAction(action) &&
    (await deps.setting("ai.stopped")) === "true"
  )
    throw new Error("AI actions are stopped by the owner.");
}
