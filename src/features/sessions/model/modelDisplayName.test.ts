import { afterEach, describe, expect, it } from "vitest";
import {
  catalogModelFor,
  modelDisplayName,
  modelHarness,
  modelSearchText,
} from "./modelDisplayName";
import { resetHarnessModelOverlays } from "./models";

afterEach(() => resetHarnessModelOverlays());

describe("modelDisplayName", () => {
  it("uses the catalog display name for ids and native ids", () => {
    expect(modelDisplayName("claude:opus-5-5")).toBe("Claude Opus 5.5");
    expect(modelDisplayName("claude-opus-5-5")).toBe("Claude Opus 5.5");
    expect(modelDisplayName("claude-opus-4-6", "claude")).toBe("Claude Opus 4.6");
    expect(modelDisplayName("gpt-5.4", "cursor")).toBe("GPT-5.4");
  });

  it("matches dated native ids to the catalog entry", () => {
    expect(modelDisplayName("claude-haiku-4-5-20251001")).toBe("Claude Haiku 4.5");
  });

  it("derives a readable name for unknown ids instead of showing the id", () => {
    expect(modelDisplayName("claude-opus-9-1-20290101")).toBe("Claude Opus 9.1");
    expect(modelDisplayName("gpt-9.9-sol")).toBe("GPT-9.9-Sol");
    expect(modelDisplayName("some-vendor-model-3-2")).toBe("Some Vendor Model 3.2");
  });

  it("keeps non-Claude catalog vendors readable", () => {
    expect(modelDisplayName("opencode:glm-5")).toBe("GLM 5");
    expect(modelDisplayName("grok-4.6", "grok")).toBe("Grok 4.6");
    expect(modelDisplayName("composer-2.5")).toBe("Composer 2.5");
  });

  it("prefers the entry of the given harness", () => {
    expect(modelDisplayName("grok-4.6", "cursor")).toBe("Cursor Grok 4.6");
    expect(catalogModelFor("grok-4.6", "grok")?.harness).toBe("grok");
  });

  it("returns an empty name for an empty id", () => {
    expect(modelDisplayName("  ")).toBe("");
  });

  it("searches both the readable name and the raw id", () => {
    const text = modelSearchText("claude-haiku-4-5-20251001");
    expect(text).toContain("Haiku 4.5");
    expect(text).toContain("claude-haiku-4-5-20251001");
  });
});

describe("modelHarness", () => {
  it("takes the given harness, then the catalog, then the id's vendor", () => {
    expect(modelHarness("anything", "pi")).toBe("pi");
    expect(modelHarness("claude-opus-5-5", "not-a-harness")).toBe("claude");
    expect(modelHarness("claude-opus-5-5")).toBe("claude");
    expect(modelHarness("claude-opus-9-1")).toBe("claude");
    expect(modelHarness("gpt-9.9")).toBe("codex");
    expect(modelHarness("grok-9")).toBe("grok");
    expect(modelHarness("totally-unknown")).toBeUndefined();
  });
  it("names every Claude family model with its vendor", () => {
    expect(modelDisplayName("claude-haiku-4-5-20251001", "claude")).toBe("Claude Haiku 4.5");
    expect(modelDisplayName("claude-haiku-4-5")).toBe("Claude Haiku 4.5");
  });
});
