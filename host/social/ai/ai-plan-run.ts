import {
  autonomyLevel,
  type AiAction,
  type AutonomyLevel,
} from "../../../src/features/social/model/autonomy";
import type { AiPlanRunResult, AiPlanStep } from "../../../src/features/social/model/socialActions";
import type { SocialActionContext } from "../core/social-actions";
import { sanitizeSocialError } from "../core/social-helpers";
import { readAutonomyPolicy } from "../autonomy/autonomy-policy";
import { isWriteAction, newAiAction, recordAiAction } from "../autonomy/ai-actions-log";
import { PLAN_AUTONOMY, type ParsedPlanStep } from "./ai-plan";
import { AI_STOPPED_MESSAGE, assertAiNotStopped, callAction } from "./ai-host";
import { loadPlan, savePlan, type StoredPlan } from "./ai-plan-store";

export type StepGate = { needsApproval: boolean; level?: AutonomyLevel; reason?: string };

/**
 * Approval need for one step, from the account's autonomy level for the step's action. Only the
 * level is read here; the action's own gates still run when the step is dispatched.
 */
export async function stepGate(
  ctx: SocialActionContext,
  step: Pick<ParsedPlanStep, "action" | "input">,
): Promise<StepGate> {
  const mapped = PLAN_AUTONOMY[step.action];
  if (!mapped) return { needsApproval: false };
  const accountId = typeof step.input.accountId === "string" ? step.input.accountId : undefined;
  if (!accountId)
    return {
      needsApproval: true,
      reason: "Owner approval required: no account is named for this step.",
    };
  const level = autonomyLevel(await readAutonomyPolicy(ctx.store, accountId), mapped);
  if (level === "autonomous") return { needsApproval: false, level };
  return {
    needsApproval: true,
    level,
    reason:
      level === "suggest"
        ? "Autonomy is set to suggest for this account. Owner approval required."
        : "Owner approval required.",
  };
}

type Hold = { status: AiAction["status"]; reason: string };

/** Why a step must not run now, or undefined when it may run. */
function holdFor(gate: StepGate, owner: boolean, approved: boolean): Hold | undefined {
  if (!gate.needsApproval) return undefined;
  if (owner)
    return approved ? undefined : { status: "queued", reason: "Waiting for owner approval." };
  // An AI principal cannot approve. "suggest" blocks outright; "approve" waits for the owner.
  if (gate.level === "suggest")
    return { status: "blocked", reason: gate.reason ?? "Owner approval required." };
  return { status: "queued", reason: "Waiting for owner approval." };
}

/** One retry with the same receipt, so an uncertain first attempt cannot send twice. */
async function execute(
  ctx: SocialActionContext,
  plan: StoredPlan,
  step: AiPlanStep,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const requestId = isWriteAction(step.action) ? `plan-${plan.id}-${step.id}` : undefined;
  let error: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await callAction(ctx, ctx.principal, step.action, step.input, requestId);
      return { ok: true };
    } catch (caught) {
      error = caught;
    }
  }
  return { ok: false, reason: sanitizeSocialError(error) };
}

async function finish(
  ctx: SocialActionContext,
  plan: StoredPlan,
  step: AiPlanStep,
  status: AiAction["status"],
  message?: string,
): Promise<AiPlanRunResult["results"][number]> {
  const accountId = typeof step.input.accountId === "string" ? step.input.accountId : undefined;
  await recordAiAction(ctx.store, {
    ...newAiAction({
      actor: ctx.principal.actorId,
      action: step.action,
      accountId,
      status,
      reason: message,
      input: step.input,
      at: ctx.now(),
    }),
    planId: plan.id,
  });
  return { stepId: step.id, status, ...(message ? { message } : {}) };
}

/**
 * Runs a stored plan through the ordinary operations. Steps run in order; a failed step does not
 * stop the independent ones after it. Global AI stop is checked before every step.
 */
export async function runPlan(
  ctx: SocialActionContext,
  input: { planId: string; approvedStepIds: string[] },
): Promise<AiPlanRunResult> {
  await assertAiNotStopped(ctx);
  const plan = await loadPlan(ctx, input.planId);
  const owner = ctx.principal.kind === "owner";
  if (!owner && plan.actor !== ctx.principal.actorId)
    throw new Error("This AI plan belongs to another actor.");
  const approved = new Set(input.approvedStepIds);
  const results: AiPlanRunResult["results"] = [];
  for (const step of plan.steps) {
    if (plan.completed.includes(step.id)) {
      results.push({ stepId: step.id, status: "done", message: "Already done." });
      continue;
    }
    if ((await ctx.service.setting("ai.stopped")) === "true") {
      results.push(await finish(ctx, plan, step, "blocked", AI_STOPPED_MESSAGE));
      continue;
    }
    const hold = holdFor(await stepGate(ctx, step), owner, approved.has(step.id));
    if (hold) {
      results.push(await finish(ctx, plan, step, hold.status, hold.reason));
      continue;
    }
    const outcome = await execute(ctx, plan, step);
    if (outcome.ok) {
      plan.completed.push(step.id);
      results.push(await finish(ctx, plan, step, "done"));
    } else {
      results.push(await finish(ctx, plan, step, "failed", outcome.reason));
    }
  }
  await savePlan(ctx, plan);
  return { results };
}
