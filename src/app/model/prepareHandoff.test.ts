import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareBudgetedHandoff } from "./prepareHandoff";
import { newSession } from "../../features/sessions/model/session";
import { resetHarnessModelOverlays, setHarnessModels } from "../../features/sessions/model/models";

const native = vi.hoisted(() => ({ invoke: vi.fn(), remote: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("../../features/connections/model/hostFeatureClient", () => ({
  hostFeatureRequest: native.remote,
}));

beforeEach(() => {
  native.invoke.mockReset().mockResolvedValue({ path: "/saved/history.json" });
  native.remote.mockReset().mockResolvedValue({ path: "/remote/history.json" });
});
afterEach(resetHarnessModelOverlays);

describe("desktop handoff preparation", () => {
  it("archives earlier text and admits a Turkish request over 20KB without known metadata", async () => {
    const request = "Önceki çalışmayı koru, değişiklikleri sürdür. ".repeat(600);
    expect(new TextEncoder().encode(request).length).toBeGreaterThan(20_000);
    const session = {
      ...newSession("codex", "/repo"),
      model: "codex:unknown-model",
      blocks: [{ id: "old", role: "user" as const, text: "Eski bağlam ".repeat(30_000) }],
    };
    const packet = await prepareBudgetedHandoff(session, "Preserve earlier work.", request);
    expect(packet.text).toContain("/saved/history.json");
    expect(packet.omittedIds).toContain("old");
    expect(packet.estimatedTokens).toBeLessThanOrEqual(packet.budgetTokens);
    expect(native.invoke).toHaveBeenCalledWith("handoff_history_save", {
      history: { sessionId: session.id, messages: session.blocks },
    });
  });

  it("uses a discovered tiny window and returns a recoverable notice instead of throwing", async () => {
    setHarnessModels("codex", [
      { id: "codex:tiny", harness: "codex", name: "Tiny", contextWindow: 32 },
    ]);
    const session = { ...newSession("codex", "/repo"), model: "codex:tiny" };
    const packet = await prepareBudgetedHandoff(session, "Earlier work", "Continue".repeat(100));
    expect(packet.text).toBe("");
    expect(packet.notice).toContain("/saved/history.json");
  });
});
