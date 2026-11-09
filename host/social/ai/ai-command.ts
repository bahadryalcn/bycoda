import { randomUUID } from "node:crypto";
import type { AiPlan, AiPlanStep } from "../../../src/features/social/model/socialActions";
import { AI_MODEL_REQUIRED_MESSAGE } from "../../../src/features/social/model/socialTools";
import type { SocialActionContext } from "../core/social-actions";
import { str } from "../core/social-helpers";
import { askSuggestionModel } from "../social-suggestions";
import { aiCommandPrompt, parseAiPlan } from "./ai-plan";
import { aiHost, assertAiNotStopped } from "./ai-host";
import { savePlan, type StoredPlan } from "./ai-plan-store";
import { stepGate } from "./ai-plan-run";

/**
 * The text agent for AI planning and reports: the first accessible account's effective policy.
 * shortcut: one agent per account is not chosen yet; the first account's policy stands for all.
 */
export async function textModel(ctx: SocialActionContext) {
  const host = aiHost(ctx);
  const first = (await ctx.service.accounts(ctx.principal))[0];
  if (!first || !host.generateText) return undefined;
  const policy = await host.policy(first);
  return policy.agent && host.generateText
    ? { agent: policy.agent, generate: host.generateText }
    : undefined;
}

/**
 * Turns one owner sentence into a stored plan. The model proposes; nothing runs here. Each step
 * carries whether the Host will need an owner approval for it, from the autonomy level.
 */
export async function planCommand(
  ctx: SocialActionContext,
  input: Record<string, unknown>,
): Promise<AiPlan> {
  await assertAiNotStopped(ctx);
  const text = str(input.text, "command", 2000);
  const projectId =
    input.projectId === undefined ? undefined : str(input.projectId, "project", 200);
  const accounts = await ctx.service.accounts(ctx.principal);
  if (!accounts.length) throw new Error("Connect a social account before asking AI to plan.");
  const model = await textModel(ctx);
  if (!model) throw new Error(AI_MODEL_REQUIRED_MESSAGE);
  const answer = await askSuggestionModel(
    model,
    aiCommandPrompt({
      text,
      projectId,
      accounts: accounts.map((account) => ({
        id: account.id,
        platform: account.platform,
        name: account.name,
      })),
    }),
    "AI plan",
  );
  const steps: AiPlanStep[] = [];
  for (const step of parseAiPlan(answer)) {
    const gate = await stepGate(ctx, step);
    steps.push({
      ...step,
      needsApproval: gate.needsApproval,
      ...(gate.reason ? { reason: gate.reason } : {}),
    });
  }
  const plan: StoredPlan = {
    id: randomUUID(),
    actor: ctx.principal.actorId,
    createdAt: ctx.now(),
    steps,
    completed: [],
  };
  await savePlan(ctx, plan);
  return { planId: plan.id, steps };
}
