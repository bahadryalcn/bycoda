import type { AiPlanStep } from "../../../src/features/social/model/socialActions";
import type { SocialActionContext } from "../core/social-actions";

export type StoredPlan = {
  id: string;
  actor: string;
  createdAt: number;
  steps: AiPlanStep[];
  /** Step ids that finished successfully; a rerun skips them. */
  completed: string[];
};

const PLAN_ID = /^[0-9a-f-]{36}$/;
const MAX_STORED = 64_000;
const key = (id: string) => `ai.plan.${id}`;

/**
 * shortcut: plans live in the settings table as JSON, not a `social_records` kind (the store owner
 * has not added "ai-plan"). Upgrade: a typed record kind once the store is reopened for Social.
 */
export async function savePlan(ctx: SocialActionContext, plan: StoredPlan): Promise<void> {
  const value = JSON.stringify(plan);
  if (value.length > MAX_STORED) throw new Error("The AI plan is too large to keep.");
  await ctx.service.setSetting(key(plan.id), value);
}

export async function loadPlan(ctx: SocialActionContext, id: string): Promise<StoredPlan> {
  if (!PLAN_ID.test(id)) throw new Error("Invalid AI plan id.");
  const raw = await ctx.service.setting(key(id));
  if (!raw) throw new Error("AI plan not found.");
  return JSON.parse(raw) as StoredPlan;
}

/** A finished plan stays this long so a retried run still reports "Already done." */
export const PLAN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Deletes plans whose every step completed and that are older than the retention window. A plan
 * with a pending, failed or blocked step is kept: its outcome is unfinished or uncertain, and the
 * owner may still rerun it. A row that cannot be parsed is kept for review.
 */
export async function prunePlans(ctx: SocialActionContext, now: number): Promise<number> {
  let removed = 0;
  for (const storedKey of await ctx.service.settingKeys("ai.plan.")) {
    const raw = await ctx.service.setting(storedKey);
    if (!raw) continue;
    let plan: StoredPlan;
    try {
      plan = JSON.parse(raw) as StoredPlan;
    } catch {
      continue;
    }
    if (!Number.isFinite(plan.createdAt) || !Array.isArray(plan.steps)) continue;
    if (!Array.isArray(plan.completed)) continue;
    if (now - plan.createdAt < PLAN_RETENTION_MS) continue;
    if (!plan.steps.every((step) => plan.completed.includes(step.id))) continue;
    await ctx.service.deleteSetting(storedKey);
    removed += 1;
  }
  return removed;
}
