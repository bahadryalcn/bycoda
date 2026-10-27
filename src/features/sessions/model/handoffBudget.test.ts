import { describe, expect, it } from "vitest";
import { newSession } from "./session";
import { buildBudgetedHandoff, handoffTokenEstimate } from "./handoffBudget";
import { modelContextWindow, resetHarnessModelOverlays, setHarnessModels } from "./models";

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
    const packet = buildBudgetedHandoff(newSession("codex", "/project"), {
      contextWindow: 32,
      request: "a".repeat(200),
      historyPath: "/host/history.json",
    });
    expect(packet.text).toBe("");
    expect(packet.notice).toContain("not transferred");
    expect(packet.notice).toContain("/host/history.json");
    expect(packet.estimatedTokens).toBe(0);
    expect(handoffTokenEstimate("Türkçe")).toBe(6);
    expect(handoffTokenEstimate("界")).toBe(2);
  });
  it("sends a long Turkish request with reduced history on an unknown Codex model", () => {
    const session = newSession("codex", "/project");
    session.model = "codex:unknown-modern-model";
    session.blocks = [
      { id: "old", role: "user", text: "ğ".repeat(80_000) },
      { id: "recent", role: "assistant", text: "Preserve this decision." },
    ];
    const request = "İşlemleri değiştir, önceki çalışmaları koru. ".repeat(700);
    expect(new TextEncoder().encode(request).length).toBeGreaterThan(20_000);
    const packet = buildBudgetedHandoff(session, { request, historyPath: "/history.json" });
    expect(packet.omittedIds).toEqual(["old"]);
    expect(packet.selectedIds).toEqual(["recent"]);
    expect(packet.text).toContain("/history.json");
    expect(packet.notice).toBeUndefined();
  });
  it("degrades history, recap, reference, then supplies a notice without clipping the request", () => {
    const session = newSession("codex", "/project");
    session.blocks = [{ id: "old", role: "user", text: "x".repeat(1000) }];
    const options = {
      contextWindow: 2000,
      reservedTokens: 512,
      brief: "recap ".repeat(50),
      historyPath: "/history.json",
    };
    const full = buildBudgetedHandoff(session, options);
    expect(full.selectedIds).toEqual([]);
    expect(full.text).toContain("Recap:");
    const reference = buildBudgetedHandoff(session, { ...options, request: "x".repeat(1100) });
    expect(reference.text).toContain("/history.json");
    expect(reference.text).not.toContain("Recap:");
    expect(
      buildBudgetedHandoff(
        { ...session, blocks: [{ id: "small", role: "user", text: "Keep." }] },
        { ...options, request: "x".repeat(1100) },
      ).selectedIds,
    ).toEqual([]);
    const empty = buildBudgetedHandoff(session, { ...options, request: "x".repeat(2000) });
    expect(empty.text).toBe("");
    expect(empty.notice).toContain("/history.json");
  });
  it("uses discovered exact/native/alias windows ahead of static values and harness defaults", () => {
    try {
      setHarnessModels("grok", [
        { id: "grok:grok-4.6", harness: "grok", name: "Live", contextWindow: 2048 },
      ]);
      expect(modelContextWindow("grok:grok-4.6", "grok")).toBe(2048);
      setHarnessModels("grok", [{ id: "grok:grok-4.6", harness: "grok", name: "No capacity" }]);
      expect(modelContextWindow("grok:grok-4.6", "grok")).toBe(500_000);
      expect(modelContextWindow("unreported-custom-model")).toBeUndefined();
      setHarnessModels("codex", [
        {
          id: "codex:live",
          nativeId: "live",
          harness: "codex",
          name: "Live",
          contextWindow: 256_000,
        },
      ]);
      expect(modelContextWindow("live", "codex")).toBe(256_000);
      expect(modelContextWindow("codex:custom", "codex")).toBe(128_000);
      setHarnessModels("claude", [
        {
          id: "claude:opus",
          nativeId: "opus",
          aliasTarget: "claude-opus-5-5",
          harness: "claude",
          name: "Opus",
          contextWindow: 200_000,
        },
      ]);
      expect(modelContextWindow("claude:opus-5-5", "claude")).toBe(200_000);
      expect(modelContextWindow("custom", "acp")).toBe(32_000);
      setHarnessModels("codex", [
        { id: "codex:invalid", harness: "codex", name: "Invalid", contextWindow: Infinity },
      ]);
      expect(modelContextWindow("codex:invalid", "codex")).toBe(128_000);
    } finally {
      resetHarnessModelOverlays();
    }
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
