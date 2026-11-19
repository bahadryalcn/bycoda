import { describe, expect, it } from "vitest";
import { planCommand } from "./ai-command";
import { PLAN_RETENTION_MS, prunePlans, savePlan, type StoredPlan } from "./ai-plan-store";
import { makeKit, NOW } from "./ai-fixtures";
import type { AiPlanStep } from "../../../src/features/social/model/socialActions";

const STEP: AiPlanStep = {
  id: "s1",
  action: "drafts.read",
  input: { id: "d1" },
  summary: "Read the draft.",
  needsApproval: false,
};
const OLD = NOW - PLAN_RETENTION_MS - 1;
const RECENT = NOW - 1000;
const id = (n: number) => `3f2a9c1e-7b4d-4e8f-9a6b-1c2d3e4f5a${String(n).padStart(2, "0")}`;

function stored(
  planId: string,
  createdAt: number,
  completed: string[],
  steps: AiPlanStep[] = [STEP],
): StoredPlan {
  return { id: planId, actor: "owner", createdAt, steps, completed };
}

describe("AI plan retention", () => {
  it("removes only finished plans past the retention window", async () => {
    const kit = makeKit();
    await savePlan(kit.ctx, stored(id(1), OLD, ["s1"]));
    await savePlan(kit.ctx, stored(id(2), OLD, []));
    await savePlan(kit.ctx, stored(id(3), RECENT, ["s1"]));
    await savePlan(kit.ctx, stored(id(4), OLD, ["s1"], [STEP, { ...STEP, id: "s2" }]));
    kit.settings.set("ai.stopped", "false");

    expect(await prunePlans(kit.ctx, NOW)).toBe(1);
    expect([...kit.settings.keys()].sort()).toEqual(
      [`ai.plan.${id(2)}`, `ai.plan.${id(3)}`, `ai.plan.${id(4)}`, "ai.stopped"].sort(),
    );
  });

  it("keeps a plan whose stored value cannot be read, and does not throw", async () => {
    const kit = makeKit();
    kit.settings.set(`ai.plan.${id(5)}`, "{not json");
    expect(await prunePlans(kit.ctx, NOW)).toBe(0);
    expect(kit.settings.has(`ai.plan.${id(5)}`)).toBe(true);
  });

  it("prunes when a new plan is made, and keeps the new plan", async () => {
    const kit = makeKit();
    await savePlan(kit.ctx, stored(id(1), OLD, ["s1"]));
    const created = await planCommand(kit.ctx, { text: "Reply to the draft." });
    expect(kit.settings.has(`ai.plan.${id(1)}`)).toBe(false);
    expect(kit.settings.has(`ai.plan.${created.planId}`)).toBe(true);
  });
});
