import { describe, expect, it } from "vitest";
import { newSession } from "./session";
import { buildBudgetedHandoff, handoffTokenEstimate } from "./handoffBudget";

describe("capacity-aware handoff", () => {
  it("preserves recent whole messages and archives oversized old text", () => {
    const session = {
      ...newSession("codex", "/project"),
      blocks: [
        { id: "old", role: "user" as const, text: "界".repeat(30_000) },
        { id: "new", role: "assistant" as const, text: "Keep the existing worktree." },
        { id: "private", role: "reasoning" as const, text: "private reasoning" },
      ],
    };
    const packet = buildBudgetedHandoff(session, {
      contextWindow: 4096,
      historyPath: "/host/history.json",
    });
    expect(packet.selectedIds).toEqual(["new"]);
    expect(packet.omittedIds).toEqual(["old"]);
    expect(packet.text).toContain("/host/history.json");
    expect(packet.history.messages).toHaveLength(2);
    expect(packet.estimatedTokens).toBeLessThanOrEqual(packet.budgetTokens);
  });
  it("never exceeds even a tiny target or a request consuming the window", () => {
    expect(() =>
      buildBudgetedHandoff(newSession("codex", "/project"), {
        contextWindow: 32,
        request: "a".repeat(200),
      }),
    ).toThrow("capacity");
    expect(handoffTokenEstimate("界")).toBe(3);
  });
  it("keeps original user intent before spending remaining budget on recent exchanges", () => {
    const session = {
      ...newSession("codex", "/project"),
      blocks: [
        { id: "original", role: "user" as const, text: "Preserve all user work." },
        { id: "large", role: "assistant" as const, text: "x".repeat(5000) },
        { id: "recent", role: "user" as const, text: "Continue." },
      ],
    };
    expect(buildBudgetedHandoff(session, { contextWindow: 1024 }).selectedIds).toEqual([
      "original",
      "recent",
    ]);
  });
});
