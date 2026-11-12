import { describe, expect, it } from "vitest";
import { productProviderDefaults } from "./productProviderDefaults";
import { decodeAdvisor } from "./host-contracts/delegation";
import type { HarnessId } from "./harnessIdentity";

describe("product provider defaults", () => {
  it.each([
    ["grok", "grok:grok-4.7", "grok:grok-4.7"],
    ["cursor", "cursor:composer-2.5", "cursor:composer-2.5"],
    ["opencode", "opencode:opencode/glm-5.3", "opencode:opencode/glm-5.3-flash"],
    ["antigravity", "antigravity:gemini-3.8-flash-high", "antigravity:gemini-3.8-flash-medium"],
    ["pi", "pi:default", "pi:default"],
    ["omp", "omp:default", "omp:default"],
    ["hermes", "hermes:default", "hermes:default"],
    ["fx", "fx:zai/glm-5.2-fast", "fx:zai/glm-5.2-fast"],
  ])("keeps %s defaults within its own catalog", (provider, main, sub) => {
    const harness = provider as HarnessId;
    const models = [...new Set([sub, main])].map((id) => ({ harness, id }));
    const result = productProviderDefaults(harness, models);
    expect(result.model).toBe(main);
    expect(decodeAdvisor(result.extras?.crossAdvisor)).toEqual({ harness, model: main });
    expect(result.extras?.crossSubagents).toBe("auto");
  });

  it("prefers exact Claude 5.5 versions over aliases targeting 5.6", () => {
    const models = [
      { harness: "claude" as const, id: "claude:opus", aliasTarget: "claude-opus-5-6" },
      { harness: "claude" as const, id: "claude:sonnet", aliasTarget: "claude-sonnet-5-6" },
      { harness: "claude" as const, id: "claude:opus-5-5" },
      { harness: "claude" as const, id: "claude:sonnet-5-5" },
    ];
    const result = productProviderDefaults("claude", models, "account");
    expect(result.model).toBe("claude:opus-5-5");
    expect(decodeAdvisor(result.extras?.crossAdvisor)).toEqual({
      harness: "claude",
      model: "claude:opus-5-5",
      providerAccountId: "account",
    });
    expect(result.extras?.crossSubagents).toBe("auto");
  });

  it("uses available aliases whose targets or names identify 5.5", () => {
    const result = productProviderDefaults("claude", [
      { harness: "claude", id: "claude:opus", aliasTarget: "claude-opus-5-5" },
      { harness: "claude", id: "claude:sonnet", name: "Sonnet 5.5" },
    ]);
    expect(result.model).toBe("claude:opus");
    expect(result.extras?.crossSubagents).toBe("auto");
  });

  it("retains empty and other-provider catalog behavior", () => {
    expect(productProviderDefaults("claude", [])).toEqual({});
    const result = productProviderDefaults("codex", [
      { harness: "codex", id: "codex:gpt-6.1-terra" },
      { harness: "codex", id: "codex:gpt-6.1-sol" },
    ]);
    expect(result.model).toBe("codex:gpt-6.1-sol");
    expect(result.extras?.crossSubagents).toBe("auto");
  });
});
