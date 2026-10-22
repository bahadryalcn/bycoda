import { describe, expect, it } from "vitest";
import {
  buildPlanPrompt,
  approvedPlanForMessage,
  consumePlanCommand,
  isProviderFailureText,
  isReviewablePlan,
  planTurnPrompt,
} from "./plan";
import { newSession, type Block } from "./session";

describe("explicit plan approval", () => {
  const plan: Block = {
    id: "p",
    role: "plan",
    text: "# Edited plan\n\n1. Implement",
    plan: { status: "ready", originalText: "# Old plan" },
  };
  const session = { ...newSession("codex", "/repo"), blocks: [plan] };
  it.each([
    "planı uygula",
    "Planı başlat!",
    "PLANI UYGULA",
    "tamam, bu planı uygula",
    "uygulamaya geç",
    "Implement the plan.",
    "yes, build this plan",
  ])("approves the exact pending plan: %s", (text) => {
    expect(approvedPlanForMessage(session, text)).toBe(plan);
  });
  it.each([
    "tamam",
    "evet",
    "Planı uygula mı?",
    "planı uygulama",
    "planı uygula ama önce güvenliği tartışalım",
    "explain how to implement the plan",
    "implement the plan\nexcept delete the tests",
  ])("leaves ambiguous or conditional text as a normal message: %s", (text) => {
    expect(approvedPlanForMessage(session, text)).toBeUndefined();
  });
  it("does not approve stale, running, or built plans", () => {
    expect(approvedPlanForMessage({ ...session, busy: true }, "planı uygula")).toBeUndefined();
    expect(
      approvedPlanForMessage(
        { ...session, blocks: [plan, { id: "u", role: "user", text: "Different task" }] },
        "planı uygula",
      ),
    ).toBeUndefined();
    for (const status of ["streaming", "building", "built"] as const) {
      expect(
        approvedPlanForMessage(
          { ...session, blocks: [plan, { ...plan, id: "new", plan: { status } }] },
          "planı uygula",
        ),
      ).toBeUndefined();
    }
  });
});

describe("plan mode prompts", () => {
  it("consumes only a leading /plan command", () => {
    expect(consumePlanCommand("/plan build a settings page")).toEqual({
      text: "build a settings page",
      planning: true,
    });
    expect(consumePlanCommand("  /PLAN\ninspect this")).toEqual({
      text: "inspect this",
      planning: true,
    });
    expect(consumePlanCommand("mention /plan in docs")).toEqual({
      text: "mention /plan in docs",
      planning: false,
    });
  });

  it("separates investigation from explicit approved-plan execution", () => {
    expect(planTurnPrompt("Add search")).toContain("do not modify files");
    const build = buildPlanPrompt("# Plan\n\n1. Add search");
    expect(build).toContain("explicitly approved");
    expect(build).toContain("# Plan\n\n1. Add search");
  });

  it("rejects provider blockers and ordinary commentary as fallback plans", () => {
    expect(isProviderFailureText("Upgrade your plan to continue")).toBe(true);
    expect(isReviewablePlan("Upgrade your plan to continue")).toBe(false);
    expect(isReviewablePlan("I checked the repository and found the issue.")).toBe(false);
  });

  it("accepts structured markdown fallback plans", () => {
    expect(isReviewablePlan("# Plan\n\nInspect the flow and update the adapter.")).toBe(true);
    expect(isReviewablePlan("1. Inspect the flow\n2. Update the adapter")).toBe(true);
  });
});
