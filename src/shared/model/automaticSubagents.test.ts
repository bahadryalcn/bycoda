import { expect, it } from "vitest";
import {
  resolveSubagents,
  subagentTier,
  SUBAGENT_TIERS,
  subagentCatalogModels,
  automaticSubagentEmptyReason,
} from "./automaticSubagents";
import {
  carryCrossDelegation,
  decodeSubagentSelection,
  encodeSubagents,
  providerModelSettings,
} from "./host-contracts/delegation";

it("uses the catalog provider key even for absent or inconsistent harness fields", () => {
  const models = subagentCatalogModels({
    codex: [{ id: "codex:one" }, { id: "codex:two", harness: "claude" }],
  });
  expect(models.map((model) => model.harness)).toEqual(["codex", "codex"]);
  expect(resolveSubagents("auto", { harness: "codex", models, providers: ["codex"] })).toHaveLength(
    2,
  );
});

it("explains disabled models without mistaking them for signed-out accounts", () => {
  expect(
    automaticSubagentEmptyReason({
      harness: "codex",
      models: [{ id: "codex:one", harness: "codex", enabled: false }],
      providers: ["codex"],
    }),
  ).toBe("no enabled models");
});

it("round trips Automatic and carries the ceiling without exposing either to providers", () => {
  expect(decodeSubagentSelection("auto")).toBe("auto");
  const values = { crossSubagents: encodeSubagents("auto")!, crossSubagentMaxEffort: "max" };
  expect(carryCrossDelegation(values, {})).toEqual(values);
  expect(providerModelSettings(values)).toEqual({});
  expect(
    carryCrossDelegation({ crossSubagentMaxEffort: "bogus", crossSubagents: "[]" }, {}),
  ).toEqual({ crossSubagents: "[]" });
});

it.each(["none", "minimal"])("migrates legacy %s ceiling to low", (value) => {
  expect(carryCrossDelegation({ crossSubagentMaxEffort: value }, {})).toEqual({
    crossSubagentMaxEffort: "low",
  });
});

it.each([
  ["claude:fable-6", "best"],
  ["claude:mythos-6", "best"],
  ["claude:opus-6", "strong"],
  ["claude:sonnet-6", "medium"],
  ["claude:haiku-6", "light"],
  ["codex:gpt-6.1-astra", "best"],
  ["codex:gpt-6.1-sol", "strong"],
  ["codex:gpt-6.1-terra", "medium"],
  ["codex:gpt-6.1-luna", "light"],
  ["opencode:vendor/new-family-99", "unranked"],
])("ranks family %s as %s", (model, tier) => expect(subagentTier(model)).toBe(tier));

it("uses own account, other provider default, skips disabled and signed-out, leaves unknown last", () => {
  const input = {
    harness: "claude" as const,
    providerAccountId: "own",
    providers: ["claude", "codex"] as const,
    defaultAccounts: { codex: "work" },
    models: [
      { harness: "claude" as const, id: "claude:sonnet-6" },
      { harness: "codex" as const, id: "codex:gpt-6-sol" },
      { harness: "codex" as const, id: "codex:new" },
      { harness: "claude" as const, id: "claude:opus-6", enabled: false },
    ],
  };
  expect(resolveSubagents("auto", input).map((ref) => [ref.model, ref.providerAccountId])).toEqual([
    ["codex:gpt-6-sol", "work"],
    ["claude:sonnet-6", "own"],
    ["codex:new", "work"],
  ]);
  expect(
    resolveSubagents("auto", { ...input, signedOutAccounts: new Set(["codex:work"]) }),
  ).toHaveLength(1);
  expect(resolveSubagents("[]", input)).toEqual([]);
});

it("caps deterministically while representing every provider and tier, preferring newer versions", () => {
  const providers = ["claude", "codex", "grok"] as const;
  const models = providers.flatMap((harness) =>
    ["fable", "opus", "sonnet", "haiku", "new"].flatMap((family) =>
      Array.from({ length: 20 }, (_, i) => ({ harness, id: `${harness}:${family}-${i}` })),
    ),
  );
  const input = { harness: "claude" as const, providers, models };
  const refs = resolveSubagents("auto", input);
  expect(refs).toHaveLength(24);
  expect(new Set(refs.map((ref) => ref.harness))).toEqual(new Set(providers));
  expect(new Set(refs.map((ref) => ref.tier))).toEqual(new Set(SUBAGENT_TIERS));
  expect(refs).toEqual(resolveSubagents("auto", { ...input, models: [...models].reverse() }));
  expect(refs.some((ref) => ref.model === "claude:fable-19")).toBe(true);
});
