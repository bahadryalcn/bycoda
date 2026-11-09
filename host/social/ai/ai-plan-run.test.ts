import { describe, expect, it } from "vitest";
import { defaultAutonomyPolicy } from "../autonomy/autonomy-policy";
import { runPlan, stepGate } from "./ai-plan-run";
import { savePlan, type StoredPlan } from "./ai-plan-store";
import { AI_PRINCIPAL, makeKit, NOW, OWNER } from "./ai-fixtures";
import type { AiPlanStep } from "../../../src/features/social/model/socialActions";

const PLAN_ID = "3f2a9c1e-7b4d-4e8f-9a6b-1c2d3e4f5a6b";

function plan(actor: string, steps: AiPlanStep[]): StoredPlan {
  return { id: PLAN_ID, actor, createdAt: NOW, steps, completed: [] };
}

const READ: AiPlanStep = {
  id: "s1",
  action: "drafts.read",
  input: { id: "d1" },
  summary: "Read the draft.",
  needsApproval: false,
};
const SEND: AiPlanStep = {
  id: "s2",
  action: "replies.send",
  input: { id: "d1", accountId: "a1" },
  summary: "Send the reply.",
  needsApproval: true,
};

describe("AI plan run", () => {
  it("dispatches each step through SocialService.call and passes a receipt for writes only", async () => {
    const kit = makeKit();
    await savePlan(kit.ctx, plan("owner", [READ, SEND]));
    const result = await runPlan(kit.ctx, { planId: PLAN_ID, approvedStepIds: ["s2"] });
    expect(kit.call).toHaveBeenNthCalledWith(
      1,
      OWNER,
      "social.drafts.read",
      { id: "d1" },
      undefined,
    );
    expect(kit.call).toHaveBeenNthCalledWith(
      2,
      OWNER,
      "social.replies.send",
      { id: "d1", accountId: "a1" },
      `plan-${PLAN_ID}-s2`,
    );
    expect(result.results).toEqual([
      { stepId: "s1", status: "done" },
      { stepId: "s2", status: "done" },
    ]);
  });

  it("holds an owner step that has no approval and never dispatches it", async () => {
    const kit = makeKit();
    await savePlan(kit.ctx, plan("owner", [SEND]));
    const result = await runPlan(kit.ctx, { planId: PLAN_ID, approvedStepIds: [] });
    expect(kit.call).not.toHaveBeenCalled();
    expect(result.results[0]).toMatchObject({ stepId: "s2", status: "queued" });
  });

  it("blocks an AI principal's step when the account is on suggest, and never dispatches it", async () => {
    const kit = makeKit({ principal: AI_PRINCIPAL });
    await savePlan(kit.ctx, plan(AI_PRINCIPAL.actorId, [SEND]));
    const result = await runPlan(kit.ctx, { planId: PLAN_ID, approvedStepIds: ["s2"] });
    expect(kit.call).not.toHaveBeenCalled();
    expect(result.results[0]).toMatchObject({ stepId: "s2", status: "blocked" });
  });

  it("runs an autonomous step for an AI principal through the same dispatch", async () => {
    const policy = {
      ...defaultAutonomyPolicy("a1"),
      levels: { ...defaultAutonomyPolicy("a1").levels, reply: "autonomous" as const },
    };
    const kit = makeKit({ principal: AI_PRINCIPAL, policies: { a1: policy } });
    await savePlan(kit.ctx, plan(AI_PRINCIPAL.actorId, [SEND]));
    const result = await runPlan(kit.ctx, { planId: PLAN_ID, approvedStepIds: [] });
    expect(kit.call).toHaveBeenCalledWith(
      AI_PRINCIPAL,
      "social.replies.send",
      { id: "d1", accountId: "a1" },
      `plan-${PLAN_ID}-s2`,
    );
    expect(result.results[0].status).toBe("done");
  });

  it("refuses every step once the owner has stopped AI, for any principal", async () => {
    const kit = makeKit();
    await savePlan(kit.ctx, plan("owner", [READ]));
    kit.settings.set("ai.stopped", "true");
    await expect(runPlan(kit.ctx, { planId: PLAN_ID, approvedStepIds: [] })).rejects.toThrow(
      "AI actions are stopped by the owner.",
    );
    expect(kit.call).not.toHaveBeenCalled();
  });

  it("retries a failed write once with the same receipt, records the failure, and continues", async () => {
    const kit = makeKit({
      call: async (...args: unknown[]) => {
        if (args[1] === "social.replies.send") throw new Error("Platform refused the reply.");
        return { ok: true };
      },
    });
    await savePlan(kit.ctx, plan("owner", [SEND, READ]));
    const result = await runPlan(kit.ctx, { planId: PLAN_ID, approvedStepIds: ["s2"] });
    const sends = kit.call.mock.calls.filter((args) => args[1] === "social.replies.send");
    expect(sends).toHaveLength(2);
    expect(new Set(sends.map((args) => args[3])).size).toBe(1);
    expect(result.results).toEqual([
      { stepId: "s2", status: "failed", message: "Platform refused the reply." },
      { stepId: "s1", status: "done" },
    ]);
    expect(kit.actions.size).toBe(2);
  });

  it("does not let one actor run another actor's plan", async () => {
    const kit = makeKit({ principal: AI_PRINCIPAL });
    await savePlan(kit.ctx, plan("owner", [READ]));
    await expect(runPlan(kit.ctx, { planId: PLAN_ID, approvedStepIds: [] })).rejects.toThrow(
      "belongs to another actor",
    );
  });

  it("asks for an account before it can decide a step's autonomy", async () => {
    const kit = makeKit();
    const gate = await stepGate(kit.ctx, { action: "email.send", input: { personId: "p1" } });
    expect(gate.needsApproval).toBe(true);
    expect(gate.reason).toContain("no account");
  });
});
