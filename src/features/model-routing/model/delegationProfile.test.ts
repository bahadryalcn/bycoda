import { describe, expect, it } from "vitest";
import {
  EMPTY_MODEL_ROUTING,
  type ModelRoutingState,
} from "../../../shared/model/host-contracts/model-routing";
import { DELEGATION_LIMITS } from "../../../shared/model/host-contracts/delegation";
import { delegationKeys, delegationSaveInput, replaceDelegation } from "./delegationProfile";

describe("delegation profile edits", () => {
  it("preserves routing fields, version and untouched layers, including explicit Off", () => {
    const state: ModelRoutingState = {
      ...structuredClone(EMPTY_MODEL_ROUTING),
      version: 7,
      updatedAt: 10,
      defaultMaxRunMinutes: 30,
      entries: [
        { id: "one", harness: "claude", model: "sonnet", modelSettings: {}, unknownLimit: "use" },
      ],
      pools: [{ id: "pool", name: "Pool", entryIds: ["one"] }],
      roles: { automation: { kind: "pool", poolId: "pool" } },
      delegation: {
        global: { crossAdvisor: "auto" },
        providers: { claude: { crossSubagents: "[]", crossAdvisor: "auto" } },
        accounts: {},
      },
    };
    const input = delegationSaveInput(state, {
      providers: { claude: { extras: { crossAdvisor: null, fast: "true" } } },
      accounts: { "claude\nwork": { extras: { crossSubagentMaxEffort: "high", effort: "low" } } },
    });
    expect(input.expectedVersion).toBe(7);
    expect(input.draft).toEqual({
      entries: state.entries,
      pools: state.pools,
      roles: state.roles,
      defaultMaxRunMinutes: 30,
      delegation: {
        global: { crossAdvisor: "auto" },
        providers: { claude: { crossSubagents: "[]" } },
        accounts: { "claude\nwork": { crossSubagentMaxEffort: "high" } },
      },
    });
    expect(state.delegation.providers.claude?.crossAdvisor).toBe("auto");
  });
  it("admits only reserved keys and command-sized strings", () => {
    expect(delegationKeys({ effort: "high", crossSubagents: "x".repeat(8192) })).toEqual({
      crossSubagents: "x".repeat(8192),
    });
    expect(() =>
      delegationKeys({ imageModels: "x".repeat(DELEGATION_LIMITS.valueBytes + 1) }),
    ).toThrow(/Invalid delegation/);
    expect(() => delegationKeys({ crossAdvisor: "bad\0value" })).toThrow(/Invalid delegation/);
  });
  it("replaces and removes delegation while retaining unrelated defaults", () => {
    const own = { model: "sonnet", effort: "low", extras: { fast: "true", crossSubagents: "[]" } };
    expect(replaceDelegation(own, { crossAdvisor: "auto" })).toEqual({
      model: "sonnet",
      effort: "low",
      extras: { fast: "true", crossAdvisor: "auto" },
    });
    expect(replaceDelegation({ extras: { crossAdvisor: "auto" } }, {})).toEqual({});
  });
});
