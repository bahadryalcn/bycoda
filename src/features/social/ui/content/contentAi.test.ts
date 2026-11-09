import { describe, expect, it, vi } from "vitest";
import type { AiPlan, AiPlanStep } from "../../model/socialActions";
import { askAiForPost, draftFromAiPlan } from "./contentAi";

function step(patch: Partial<AiPlanStep>): AiPlanStep {
  return {
    id: "s",
    action: "campaigns.create",
    input: {},
    summary: "",
    needsApproval: true,
    ...patch,
  };
}

function create(variant: Record<string, unknown>, rest: Record<string, unknown> = {}): AiPlanStep {
  return step({ input: { variants: [variant], ...rest } });
}

describe("askAiForPost", () => {
  it("asks the Host for a plan once and sends nothing else", async () => {
    const plan: AiPlan = {
      planId: "p1",
      steps: [
        create({ text: "Fresh idea" }, { name: "Idea" }),
        step({ id: "s2", action: "campaigns.schedule", input: { id: "c1" }, needsApproval: false }),
      ],
    };
    const request = vi.fn(async (_action: string, _input?: unknown) => plan);
    const draft = await askAiForPost({ request } as never, {
      instruction: "Write a post",
      projectId: "p1",
    });
    expect(draft).toEqual({ text: "Fresh idea", name: "Idea" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("ai.command", { text: "Write a post", projectId: "p1" });
  });

  it("returns nothing when the plan has no post to load, so the editor can say so", async () => {
    const request = vi.fn(async (_action: string, _input?: unknown) => ({
      planId: "p1",
      steps: [step({ action: "campaigns.status" })],
    }));
    expect(
      await askAiForPost({ request } as never, { instruction: "x", projectId: "p1" }),
    ).toBeUndefined();
  });

  it("lets a Host failure reach the caller instead of inventing a draft", async () => {
    const request = vi.fn(async (_action: string, _input?: unknown): Promise<AiPlan> => {
      throw new Error("AI is offline.");
    });
    await expect(
      askAiForPost({ request } as never, { instruction: "x", projectId: "p1" }),
    ).rejects.toThrow("AI is offline.");
  });
});

describe("draftFromAiPlan", () => {
  it("uses the first campaigns.create step when the plan has several", () => {
    const plan: AiPlan = {
      planId: "p",
      steps: [create({ text: "First" }), create({ text: "Second" })],
    };
    expect(draftFromAiPlan(plan)).toEqual({ text: "First" });
  });

  it("ignores a name or link that is not text or only blank", () => {
    expect(
      draftFromAiPlan({ planId: "p", steps: [create({ text: "Hi", link: "  " }, { name: 5 })] }),
    ).toEqual({
      text: "Hi",
    });
    expect(
      draftFromAiPlan({ planId: "p", steps: [create({ text: "Hi", link: 7 }, { name: "   " })] }),
    ).toEqual({
      text: "Hi",
    });
  });

  it("treats a post text that is not a string as no post", () => {
    expect(draftFromAiPlan({ planId: "p", steps: [create({ text: 42 })] })).toBeUndefined();
    expect(draftFromAiPlan({ planId: "p", steps: [step({ input: {} })] })).toBeUndefined();
  });

  it("takes only the first variant of the step", () => {
    const plan: AiPlan = {
      planId: "p",
      steps: [step({ input: { variants: [{ text: "" }, { text: "Second account" }] } })],
    };
    expect(draftFromAiPlan(plan)).toBeUndefined();
  });
});
