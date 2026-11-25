import { describe, expect, it } from "vitest";
import { EMPTY_MODEL_ROUTING } from "../../src/shared/model/host-contracts/model-routing";
import type { ModelRoutingDelegation } from "../../src/shared/model/host-contracts/model-routing";
import { resolveHelpers, withoutHelperSettings } from "./helpers";

const claude = { harness: "claude", providerAccountId: "work" };
const codexRef = { harness: "codex" as const, model: "gpt-6.1" };
const otherRef = { harness: "claude" as const, model: "claude:haiku" };
const layers = (patch: Partial<ModelRoutingDelegation> = {}): ModelRoutingDelegation => ({
  ...structuredClone(EMPTY_MODEL_ROUTING.delegation),
  ...patch,
});

describe("resolveHelpers", () => {
  it("defaults to Automatic when no layer says anything", () => {
    const { settings, resolved } = resolveHelpers({ delegation: layers(), target: claude });
    expect(settings).toEqual({ crossSubagents: "auto" });
    expect(resolved).toMatchObject({ mode: "settings", subagents: "auto", source: "default" });
  });

  it("lets account beat provider beat global, and reports the layer", () => {
    const delegation = layers({
      global: { crossSubagents: "[]", crossSubagentMaxEffort: "low" },
      providers: { claude: { crossSubagents: "auto" } },
      accounts: { "claude\nwork": { crossSubagentMaxEffort: "high" } },
    });
    const { settings, resolved } = resolveHelpers({ delegation, target: claude });
    expect(settings).toEqual({ crossSubagents: "auto", crossSubagentMaxEffort: "high" });
    expect(resolved.source).toBe("provider");
    // Another account of the same provider does not see the work account's value.
    expect(resolveHelpers({ delegation, target: { harness: "claude" } }).settings).toEqual({
      crossSubagents: "auto",
      crossSubagentMaxEffort: "low",
    });
  });

  it("lets the task choose off over every layer, advisor included", () => {
    const delegation = layers({
      global: { crossSubagents: "auto", crossAdvisor: JSON.stringify(codexRef) },
    });
    const { settings, resolved } = resolveHelpers({
      delegation,
      target: claude,
      helpers: { mode: "off" },
    });
    expect(settings).toMatchObject({ crossSubagents: "[]", crossAdvisor: "null" });
    expect(resolved).toMatchObject({ mode: "off", subagents: "off", source: "task" });
  });

  it("gives a fixed and an order-following target the same policy for the same task", () => {
    const delegation = layers({ providers: { claude: { crossSubagents: "auto" } } });
    const helpers = { mode: "off" as const };
    // The model's own options differ; the helper policy must not.
    const fixed = resolveHelpers({ delegation, target: claude, helpers }).settings;
    const ordered = resolveHelpers({ delegation, target: { ...claude }, helpers }).settings;
    expect(fixed).toEqual(ordered);
    expect(fixed.crossSubagents).toBe("[]");
  });

  it("narrows an explicit settings list but never widens it", () => {
    const delegation = layers({
      global: { crossSubagents: JSON.stringify([codexRef]) },
    });
    const narrowed = resolveHelpers({
      delegation,
      target: claude,
      helpers: { mode: "use", models: [codexRef, otherRef] },
    });
    expect(JSON.parse(narrowed.settings.crossSubagents!)).toEqual([codexRef]);
    expect(narrowed.resolved.limited).toMatch(/outside the allowed list/);
    const none = resolveHelpers({
      delegation,
      target: claude,
      helpers: { mode: "use", models: [otherRef] },
    });
    expect(none.settings.crossSubagents).toBe("[]");
    expect(none.resolved).toMatchObject({ subagents: "off" });
  });

  it("caps effort at the settings ceiling and at the lower of the two", () => {
    const capped = layers({ global: { crossSubagentMaxEffort: "medium" } });
    expect(
      resolveHelpers({
        delegation: capped,
        target: claude,
        helpers: { mode: "use", maxEffort: "high" },
      }).settings.crossSubagentMaxEffort,
    ).toBe("medium");
    expect(
      resolveHelpers({
        delegation: capped,
        target: claude,
        helpers: { mode: "use", maxEffort: "low" },
      }).settings.crossSubagentMaxEffort,
    ).toBe("low");
    expect(
      resolveHelpers({
        delegation: layers(),
        target: claude,
        helpers: { mode: "use", maxEffort: "high" },
      }).settings.crossSubagentMaxEffort,
    ).toBe("high");
  });

  it("marks a task that turns helpers on while Settings have them off", () => {
    const delegation = layers({ global: { crossSubagents: "[]" } });
    const { settings, resolved } = resolveHelpers({
      delegation,
      target: claude,
      helpers: { mode: "use" },
    });
    expect(settings.crossSubagents).toBe("auto");
    expect(resolved.changesSettings).toBe(true);
  });

  it("keeps image models from Settings and drops stale helper keys from the model's own options", () => {
    const delegation = layers({ global: { imageModels: '[{"harness":"codex"}]' } });
    expect(resolveHelpers({ delegation, target: claude }).settings.imageModels).toBe(
      '[{"harness":"codex"}]',
    );
    expect(
      withoutHelperSettings({ effort: "high", crossSubagents: "[]", crossAdvisor: "x" }),
    ).toEqual({ effort: "high" });
  });
});
