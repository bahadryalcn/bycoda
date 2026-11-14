import { expect, it } from "vitest";
import {
  EMPTY_MODEL_ROUTING,
  MODEL_ROUTING_DELEGATION_KEYS,
  type ModelRoutingDraft,
} from "../../src/shared/model/host-contracts/model-routing";
import { validateModelRoutingDraft } from "./validation";

const draft = (): ModelRoutingDraft => ({
  ...structuredClone(EMPTY_MODEL_ROUTING),
  entries: [{ id: "a", harness: "codex", model: "x", modelSettings: {}, unknownLimit: "use" }],
  pools: [{ id: "p", name: "P", entryIds: ["a"] }],
});
it("validates structural limits, unique ids and reference integrity", () => {
  const invalid = [
    (d: ModelRoutingDraft) => d.entries.push(d.entries[0]!),
    (d: ModelRoutingDraft) => d.pools.push(d.pools[0]!),
    (d: ModelRoutingDraft) => d.pools[0]!.entryIds.push("a"),
    (d: ModelRoutingDraft) => d.pools[0]!.entryIds.push("absent"),
    (d: ModelRoutingDraft) => {
      d.roles.steward = { kind: "pool", poolId: "absent" };
    },
    (d: ModelRoutingDraft) => {
      d.entries[0]!.minRemainingPercent = 101;
    },
  ];
  for (const mutate of invalid) {
    const d = draft();
    mutate(d);
    expect(() => validateModelRoutingDraft(d, {})).toThrow();
  }
});
it("accepts default accounts, validates named accounts and forbids accounts elsewhere", () => {
  const d = draft();
  expect(validateModelRoutingDraft(d, {})).toEqual(d);
  d.entries[0]!.providerAccountId = "default";
  expect(validateModelRoutingDraft(d, {})).toEqual(d);
  d.entries[0]!.providerAccountId = "work";
  expect(() => validateModelRoutingDraft(d, {})).toThrow("Unknown codex account");
  expect(
    validateModelRoutingDraft(d, { codex: [{ id: "work", label: "Work", color: "blue" }] }),
  ).toEqual(d);
  d.entries[0]!.harness = "grok";
  expect(() => validateModelRoutingDraft(d, {})).toThrow("has no provider accounts");
});
it("checks listed catalog models but permits unavailable catalog", () => {
  const d = draft();
  for (const catalog of [
    undefined,
    { models: {} },
    { models: { codex: [] } },
    { models: { codex: [{ id: "x" }] } },
  ])
    expect(validateModelRoutingDraft(d, {}, catalog)).toEqual(d);
  expect(() => validateModelRoutingDraft(d, {}, { models: { codex: [{ id: "y" }] } })).toThrow(
    "not available",
  );
});
it("validates fixed role targets with identical account, catalog and delegation rules", () => {
  const d = draft();
  d.roles.steward = {
    kind: "fixed",
    target: { harness: "claude", model: "y", modelSettings: {}, providerAccountId: "missing" },
  };
  expect(() => validateModelRoutingDraft(d, {})).toThrow("Unknown claude account");
  delete d.roles.steward.target.providerAccountId;
  expect(() => validateModelRoutingDraft(d, {}, { models: { claude: [{ id: "x" }] } })).toThrow(
    "not available",
  );
  d.roles.steward.target.modelSettings.crossAdvisor = "x";
  expect(() => validateModelRoutingDraft(d, {})).toThrow("Delegation keys belong");
});
it("rejects all reserved entry keys and non-delegation map keys", () => {
  for (const key of MODEL_ROUTING_DELEGATION_KEYS) {
    const d = draft();
    d.entries[0]!.modelSettings[key] = "x";
    expect(() => validateModelRoutingDraft(d, {})).toThrow("Delegation keys belong");
  }
  for (const layer of ["global", "provider", "account"]) {
    const d = draft();
    const settings =
      layer === "global"
        ? d.delegation.global
        : layer === "provider"
          ? (d.delegation.providers.codex = {})
          : (d.delegation.accounts["codex\nwork"] = {});
    settings.effort = "high";
    expect(() => validateModelRoutingDraft(d, {})).toThrow("Only model routing delegation keys");
    delete settings.effort;
    for (const key of MODEL_ROUTING_DELEGATION_KEYS) settings[key] = "x";
    expect(validateModelRoutingDraft(d, {})).toEqual(d);
  }
});

it("rejects unknown, duplicate, self and cyclic included pools and unnormalized project keys", () => {
  const withPools = () => {
    const d = draft();
    d.pools.push({ id: "q", name: "Q", entryIds: [], poolIds: ["p"] });
    return d;
  };
  expect(() => validateModelRoutingDraft(withPools(), {})).not.toThrow();
  const invalid = [
    (d: ModelRoutingDraft) => (d.pools[1]!.poolIds = []),
    (d: ModelRoutingDraft) => (d.pools[1]!.poolIds = ["absent"]),
    (d: ModelRoutingDraft) => (d.pools[1]!.poolIds = ["p", "p"]),
    (d: ModelRoutingDraft) => (d.pools[1]!.poolIds = ["q"]),
    (d: ModelRoutingDraft) => (d.pools[0]!.poolIds = ["q"]),
    (d: ModelRoutingDraft) => (d.projectKinds = { "C:/Work/App": "work" }),
  ];
  for (const mutate of invalid) {
    const d = withPools();
    mutate(d);
    expect(() => validateModelRoutingDraft(d, {})).toThrow();
  }
  const ok = withPools();
  ok.projectKinds = { "c:/work/app": "work" };
  expect(validateModelRoutingDraft(ok, {}).projectKinds).toEqual({ "c:/work/app": "work" });
});
