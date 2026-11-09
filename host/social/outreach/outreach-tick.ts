import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import type {
  Sequence,
  SequenceEnrollment,
  SequenceStep,
} from "../../../src/features/social/model/outreach";
import type { SecretValueStore } from "../../secrets/secret-store";
import { newAiAction } from "../autonomy/ai-actions-log";
import { sanitizeSocialError } from "../core/social-helpers";
import type { SocialServiceApi } from "../core/social-service-api";
import type { SocialPrincipal } from "../social";
import type { SocialAudienceStore } from "../store/social-audience-store";
import { HOUR_MS } from "./outreach-input";
import { countStat } from "./outreach-pacing";
import {
  dispatchStep,
  prepareStep,
  StepStop,
  type Personalize,
  type StepContext,
  type StepPlan,
} from "./outreach-steps";

export type OutreachTickContext = {
  service: SocialServiceApi;
  store: SocialAudienceStore;
  now: number;
  /** Optional model access for personalized steps; absent means template-only sends. */
  personalize?: Personalize;
  /** Vault for email credentials; absent means email steps wait (they are never sent without it). */
  emailSecrets?: SecretValueStore;
};

const TICK_BATCH = 50;

/** The principal a sequence acts as. It is an external AI principal, so every send is autonomy-gated. */
export function sequencePrincipal(
  sequence: Pick<Sequence, "id">,
  projectId: string,
): SocialPrincipal {
  return { kind: "external", actorId: `sequence:${sequence.id}`, provider: "sequence", projectId };
}

/** Global stops: nothing is sent while AI is stopped, sending is stopped, or external sending is off. */
async function sendingOpen(service: SocialServiceApi): Promise<boolean> {
  const [aiStopped, stopped, sending] = await Promise.all([
    service.setting("ai.stopped"),
    service.setting("stopped"),
    service.setting("sending"),
  ]);
  return aiStopped !== "true" && stopped !== "true" && sending === "true";
}

/**
 * Runs due outreach steps, one step per enrollment per tick. The enrollment advances before the
 * send (so a crash cannot repeat a step), and returns to its previous state when the send is
 * refused before anything left the Host, or rate limited.
 */
export async function runOutreachTick(ctx: OutreachTickContext): Promise<void> {
  if (!(await sendingOpen(ctx.service))) return;
  const due = await ctx.store.dueEnrollments(ctx.now, TICK_BATCH);
  for (const enrollment of due) {
    await runEnrollment(ctx, enrollment.id).catch((error) =>
      console.error("Social outreach step failed; retrying later:", sanitizeSocialError(error)),
    );
  }
}

async function runEnrollment(ctx: OutreachTickContext, id: string): Promise<void> {
  const { store, now } = ctx;
  const current = await store.getEnrollment(id);
  if (
    !current ||
    current.status !== "active" ||
    current.nextAt === undefined ||
    current.nextAt > now
  )
    return;
  const sequence = await store.getRecord("sequence", current.sequenceId);
  if (!sequence) {
    await store.putEnrollment({ ...current, status: "stopped", nextAt: undefined, updatedAt: now });
    return;
  }
  // Paused or draft sequences are re-checked later instead of being dropped from the queue.
  if (sequence.status !== "active") {
    await store.putEnrollment({ ...current, nextAt: now + HOUR_MS, updatedAt: now });
    return;
  }
  const list = await store.getList(sequence.listId);
  const projectId = list?.projectIds[0];
  if (!projectId) {
    await store.putEnrollment({ ...current, nextAt: now + HOUR_MS, updatedAt: now });
    return;
  }
  const step = sequence.steps[current.stepIndex];
  if (!step) {
    await store.putEnrollment({ ...current, status: "done", nextAt: undefined, updatedAt: now });
    return;
  }
  const stepContext: StepContext = {
    service: ctx.service,
    store,
    now,
    ...(ctx.personalize ? { personalize: ctx.personalize } : {}),
    ...(ctx.emailSecrets ? { emailSecrets: ctx.emailSecrets } : {}),
  };
  const principal = sequencePrincipal(sequence, projectId);
  let plan: StepPlan;
  try {
    plan = await prepareStep(stepContext, {
      sequence,
      step,
      enrollment: current,
      projectId,
      principal,
    });
  } catch (error) {
    if (!(error instanceof StepStop)) throw error;
    await settleStop(ctx, sequence, step, current, error);
    return;
  }
  const next = sequence.steps[current.stepIndex + 1];
  const advanced: SequenceEnrollment = {
    ...current,
    stepIndex: current.stepIndex + 1,
    status: next ? "active" : "done",
    nextAt: next ? now + next.delayHours * HOUR_MS : undefined,
    variantId: plan.variantId,
    updatedAt: now,
  };
  await store.putEnrollment(advanced);
  try {
    const jobId = await dispatchStep(stepContext, sequence, step, current, plan);
    if (jobId) await store.putEnrollment({ ...advanced, lastJobId: jobId, updatedAt: now });
  } catch (error) {
    if (error instanceof SocialPlatformError && error.code === "rate_limit") {
      // The provider refused before accepting anything: the same step waits for the limit to reset.
      await store.putEnrollment({
        ...current,
        nextAt: error.retryAt ?? now + HOUR_MS,
        updatedAt: now,
      });
      return;
    }
    // Any other failure after the advance ends the enrollment. An uncertain send is never repeated.
    await markFailed(ctx, sequence, step, advanced, sanitizeSocialError(error));
  }
}

async function settleStop(
  ctx: OutreachTickContext,
  sequence: Sequence,
  step: SequenceStep,
  current: SequenceEnrollment,
  stop: StepStop,
): Promise<void> {
  const { store, now } = ctx;
  if (stop.outcome === "defer") {
    await store.putEnrollment({
      ...current,
      nextAt: stop.retryAt ?? now + HOUR_MS,
      updatedAt: now,
    });
    return;
  }
  if (stop.outcome === "suppressed") {
    await store.putEnrollment({
      ...current,
      status: "suppressed",
      nextAt: undefined,
      updatedAt: now,
    });
    return;
  }
  await markFailed(ctx, sequence, step, current, stop.message);
}

async function markFailed(
  ctx: OutreachTickContext,
  sequence: Sequence,
  step: SequenceStep,
  enrollment: SequenceEnrollment,
  reason: string,
): Promise<void> {
  const { store, service, now } = ctx;
  await store.putEnrollment({ ...enrollment, status: "failed", nextAt: undefined, updatedAt: now });
  await countStat(store, sequence.id, "failed");
  await service.recordAiAction(
    newAiAction({
      actor: `sequence:${sequence.id}`,
      action: `outreach.${step.channel}`,
      ...(step.accountId ? { accountId: step.accountId } : {}),
      status: "failed",
      reason: sanitizeSocialError(reason),
      at: now,
    }),
  );
}
