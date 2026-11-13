import { describe, expect, it } from "vitest";
import {
  parseCodexGoalCommand,
  codexGoalRequest,
  codexGoalSummary,
  codexGoalState,
} from "./codexGoal";

describe("Codex goal commands", () => {
  it.each(["active", "paused", "blocked", "usageLimited", "budgetLimited", "complete"])(
    "projects native %s status without inferring a reason",
    (status) => {
      expect(codexGoalState({ goal: { threadId: "t", objective: "Ship", status } })).toEqual({
        provider: "codex",
        providerSessionId: "t",
        objective: "Ship",
        status,
      });
    },
  );
  it("distinguishes cleared goals from unsupported or incomplete state", () => {
    expect(codexGoalState({ goal: null })).toBeNull();
    expect(codexGoalState({})).toBeUndefined();
    expect(codexGoalState({ goal: { objective: "Ship", status: "active" } })).toBeUndefined();
    expect(
      codexGoalState({ goal: { threadId: "t", objective: "Ship", status: "achieved" } }),
    ).toBeUndefined();
  });
  it("uses persisted goal RPCs for objectives and lifecycle actions", () => {
    expect(codexGoalRequest(parseCodexGoalCommand("/goal keep tests green")!, "t")).toEqual({
      method: "thread/goal/set",
      params: {
        threadId: "t",
        objective: "keep tests green",
        status: "active",
      },
    });
    expect(codexGoalRequest(parseCodexGoalCommand("/goal")!, "t")).toEqual({
      method: "thread/goal/get",
      params: { threadId: "t" },
    });
    expect(codexGoalRequest(parseCodexGoalCommand("/goal clear")!, "t")).toEqual({
      method: "thread/goal/clear",
      params: { threadId: "t" },
    });
    expect(codexGoalRequest(parseCodexGoalCommand("/goal pause")!, "t").params).toEqual({
      threadId: "t",
      status: "paused",
    });
    expect(codexGoalRequest(parseCodexGoalCommand("/goal resume")!, "t").params).toEqual({
      threadId: "t",
      status: "active",
    });
  });
  it("ignores ordinary prose and paths", () => {
    expect(parseCodexGoalCommand("explain /goal")).toBeNull();
    expect(parseCodexGoalCommand("/goal/path")).toBeNull();
  });
  it("forwards long objectives intact for the provider to validate", () => {
    const objective = "Uzun hedef: tüm gereksinimleri doğrula.\n".repeat(300);
    expect(objective.length).toBeGreaterThan(4000);
    expect(codexGoalRequest(parseCodexGoalCommand(`/goal ${objective.trim()}`)!, "t")).toEqual({
      method: "thread/goal/set",
      params: { threadId: "t", objective: objective.trim(), status: "active" },
    });
  });
  it("reports actual stored progress or the absence of a goal", () => {
    expect(codexGoalSummary({ goal: null })).toContain("No active Codex goal");
    expect(
      codexGoalSummary({
        goal: {
          objective: "Ship",
          status: "paused",
          tokensUsed: 10,
          tokenBudget: 100,
        },
      }),
    ).toContain("Codex goal (paused): Ship\n\nTokens used: 10 / 100.");
  });
});
