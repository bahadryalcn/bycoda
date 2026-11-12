import { expect, it } from "vitest";
import { mapDefaultsToProviders, type DefaultsProviderSupport } from "./providerDefaultsMapping";

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
