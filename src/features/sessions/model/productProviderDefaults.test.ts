import { describe, expect, it } from "vitest";
import { productProviderDefaults } from "../../../shared/model/productProviderDefaults";

const models = [
  { id: "claude:opus", nativeId: "opus", harness: "claude" as const, name: "Opus" },
  { id: "claude:sonnet", nativeId: "sonnet", harness: "claude" as const, name: "Sonnet" },
];

describe("productProviderDefaults", () => {
  it("binds preferred delegation to the selected account", () => {
    const result = productProviderDefaults("claude", models, "account-2");
    expect(result.model).toBe("claude:opus");
    expect(JSON.parse(result.extras!.crossSubagents)).toEqual([
      { harness: "claude", model: "claude:sonnet", providerAccountId: "account-2" },
    ]);
    expect(JSON.parse(result.extras!.crossAdvisor)).toEqual({
      harness: "claude",
      model: "claude:opus",
      providerAccountId: "account-2",
    });
  });
  it("uses available fallback and never invents unavailable models", () => {
    const result = productProviderDefaults("claude", [models[1]]);
    expect(result.model).toBe("claude:sonnet");
    expect(JSON.parse(result.extras!.crossAdvisor).model).toBe("claude:sonnet");
    expect(productProviderDefaults("acp", []).extras).toBeUndefined();
  });
});
