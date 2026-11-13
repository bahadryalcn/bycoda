import { expect, it } from "vitest";
import { mapDefaultsToProviders, type DefaultsProviderSupport } from "./providerDefaultsMapping";
import { withAutoCompactSettings, withAutoCompactToggle } from "../../sessions/model/autoCompact";

it("copies compaction only to providers that offer the exact control and threshold", () => {
  const model = withAutoCompactSettings({
    id: "codex:test",
    name: "Test",
    harness: "codex",
    contextWindow: 200_000,
  });
  const omp = withAutoCompactToggle({ id: "omp:test", name: "Test", harness: "omp" });
  const result = mapDefaultsToProviders(
    {
      accounts: {},
      providers: { claude: { extras: { autoCompact: "off", autoCompactWindow: "500000" } } },
    },
    "claude",
    [
      { harness: "codex", effort: [], permissions: [], extras: model.settings! },
      { harness: "omp", effort: [], permissions: [], extras: omp.settings! },
    ],
  );
  expect(result.draft.providers.omp?.extras).toEqual({ autoCompact: "off" });
  expect(result.draft.providers.codex).toBeUndefined();
  expect(result.skipped).toEqual(
    expect.arrayContaining([
      { harness: "codex", field: "autoCompact", value: "off" },
      { harness: "codex", field: "autoCompactWindow", value: "500000" },
      { harness: "omp", field: "autoCompactWindow", value: "500000" },
    ]),
  );
});

const codex: DefaultsProviderSupport = {
  harness: "codex",
  effort: ["low", "high"],
  permissions: ["full-access"],
  extras: [
    {
      id: "serviceTier",
      label: "Service Tier",
      kind: "select",
      value: "default",
      options: [
        { value: "default", label: "Standard" },
        { value: "fast", label: "Fast" },
      ],
    },
  ],
};

it("copies supported explicit values, maps fast, and never copies model/account identities", () => {
  const draft = {
    accounts: { "claude\na": { model: "opus" } },
    providers: {
      claude: {
        model: "opus",
        effort: "high",
        runtimeMode: "full-access",
        extras: { fast: "true", crossAdvisor: "model-identity", crossSubagents: "[]" },
      },
    },
  };
  const mapped = mapDefaultsToProviders(draft, "claude", [codex]);
  expect(mapped.draft.providers.codex).toEqual({
    effort: "high",
    runtimeMode: "full-access",
    extras: { serviceTier: "fast", crossSubagents: "[]" },
  });
  expect(mapped.draft.accounts).toEqual(draft.accounts);
  expect(mapped.skipped).toContainEqual({
    harness: "codex",
    field: "crossAdvisor",
    value: "model-identity",
  });
  expect(draft.providers).not.toHaveProperty("codex");
});

it("reports unsupported values and preserves resets and explicit Off", () => {
  const mapped = mapDefaultsToProviders(
    {
      accounts: {},
      providers: {
        claude: {
          effort: "max",
          runtimeMode: null,
          extras: { fast: "false", crossAdvisor: "null" },
        },
      },
    },
    "claude",
    [codex],
  );
  expect(mapped.skipped).toEqual([{ harness: "codex", field: "effort", value: "max" }]);
  expect(mapped.draft.providers.codex).toEqual({
    runtimeMode: null,
    extras: { serviceTier: "default", crossAdvisor: "null" },
  });
});

it("does not reinterpret unknown service tiers as Standard", () => {
  const claude: DefaultsProviderSupport = {
    harness: "claude",
    permissions: [],
    effort: [],
    extras: [
      {
        id: "fast",
        label: "Fast",
        kind: "toggle",
        value: "false",
        options: [
          { value: "true", label: "On" },
          { value: "false", label: "Off" },
        ],
      },
    ],
  };
  const mapped = mapDefaultsToProviders(
    { accounts: {}, providers: { codex: { extras: { serviceTier: "flex" } } } },
    "codex",
    [claude],
  );
  expect(mapped.draft.providers.claude).toBeUndefined();
  expect(mapped.skipped).toEqual([{ harness: "claude", field: "serviceTier", value: "flex" }]);
});

it("copies Automatic and subagent ceiling independently of the main effort", () => {
  const result = mapDefaultsToProviders(
    {
      accounts: {},
      providers: {
        claude: {
          effort: "low",
          extras: { crossSubagents: "auto", crossSubagentMaxEffort: "max" },
        },
      },
    },
    "claude",
    [codex],
  );
  expect(result.draft.providers.codex).toEqual({
    effort: "low",
    extras: { crossSubagents: "auto", crossSubagentMaxEffort: "max" },
  });
  expect(result.skipped).toEqual([]);
});
