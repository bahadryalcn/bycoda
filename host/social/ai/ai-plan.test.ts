import { describe, expect, it } from "vitest";
import { SOCIAL_TOOLS } from "../../../src/features/social/model/socialTools";
import { AI_PLAN_ACTIONS, AI_PLAN_MAX_STEPS, PLAN_AUTONOMY, parseAiPlan } from "./ai-plan";

describe("AI plan contract", () => {
  it("accepts tool-set steps, numbers them and defaults the summary and input", () => {
    const steps = parseAiPlan({
      steps: [
        { action: "drafts.read", input: { id: "d1" }, summary: "Read the draft." },
        { action: "lists.list" },
      ],
    });
    expect(steps).toEqual([
      { id: "s1", action: "drafts.read", input: { id: "d1" }, summary: "Read the draft." },
      { id: "s2", action: "lists.list", input: {}, summary: "lists.list" },
    ]);
  });

  it("refuses the whole plan for an action outside the tool set, including ai.stop and ai.command", () => {
    for (const action of ["execution.enable", "ai.stop", "ai.command", "people.delete"])
      expect(() => parseAiPlan({ steps: [{ action, input: {} }] })).toThrow("not available");
  });

  it("refuses identity fields, non-object inputs, empty and oversized plans", () => {
    expect(() =>
      parseAiPlan({ steps: [{ action: "drafts.read", input: { actorId: "x" } }] }),
    ).toThrow("Host identity field");
    expect(() => parseAiPlan({ steps: [{ action: "drafts.read", input: [] }] })).toThrow(
      "must be an object",
    );
    expect(() => parseAiPlan({ steps: [] })).toThrow("could not make a plan");
    const many = Array.from({ length: AI_PLAN_MAX_STEPS + 1 }, () => ({ action: "lists.list" }));
    expect(() => parseAiPlan({ steps: many })).toThrow(`at most ${AI_PLAN_MAX_STEPS}`);
  });

  it("keeps the planning action list and the autonomy map inside the tool set", () => {
    expect(AI_PLAN_ACTIONS).toEqual(SOCIAL_TOOLS.filter((action) => action !== "ai.stop"));
    for (const action of Object.keys(PLAN_AUTONOMY)) expect(AI_PLAN_ACTIONS).toContain(action);
  });
});
