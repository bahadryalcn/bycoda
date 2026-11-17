import { expect, it } from "vitest";
import type { ModelRoutingDelegation } from "../../../shared/model/host-contracts/model-routing";
import {
  accountLayerKey,
  inheritedValues,
  overrideTargets,
  readLayer,
  setLayerKey,
  storedOverrides,
  writeLayer,
  type DelegationLayer,
} from "./delegationDraft";

const base: ModelRoutingDelegation = {
  global: { crossSubagents: "auto", crossSubagentMaxEffort: "medium" },
  providers: { codex: { crossSubagentMaxEffort: "high" } },
  accounts: { [accountLayerKey("claude", "work")]: { crossAdvisor: "null" } },
};
const codex: DelegationLayer = { kind: "provider", harness: "codex" };
const work: DelegationLayer = { kind: "account", harness: "claude", accountId: "work" };

it("reads and writes each layer, dropping non-delegation keys", () => {
  expect(readLayer(base, codex)).toEqual({ crossSubagentMaxEffort: "high" });
  expect(readLayer(base, work)).toEqual({ crossAdvisor: "null" });
  const next = writeLayer(base, { kind: "global" }, { crossSubagents: "[]", fast: "true" });
  expect(next.global).toEqual({ crossSubagents: "[]" });
  expect(next.providers).toBe(base.providers);
});

it("removes an override layer that becomes empty", () => {
  const next = setLayerKey(base, codex, "crossSubagentMaxEffort", undefined);
  expect(next.providers.codex).toBeUndefined();
  expect(base.providers.codex).toBeDefined();
});

it("stores Off explicitly in overrides but clears it globally", () => {
  expect(setLayerKey(base, codex, "crossAdvisor", "").providers.codex).toEqual({
    crossSubagentMaxEffort: "high",
    crossAdvisor: "null",
  });
  expect(setLayerKey(base, codex, "crossSubagents", "").providers.codex?.crossSubagents).toBe("[]");
  expect(setLayerKey(base, { kind: "global" }, "crossSubagents", "").global).toEqual({
    crossSubagentMaxEffort: "medium",
  });
  expect(setLayerKey(base, codex, "crossSubagentMaxEffort", "").providers.codex).toBeUndefined();
});

it("resolves what a layer inherits", () => {
  expect(inheritedValues(base, { kind: "global" })).toEqual({});
  expect(inheritedValues(base, codex)).toEqual(base.global);
  expect(inheritedValues(base, { kind: "account", harness: "codex", accountId: "a" })).toEqual({
    ...base.global,
    ...base.providers.codex,
  });
});

it("lists stored overrides and the targets an order offers", () => {
  expect(storedOverrides(base)).toEqual([codex, work]);
  const entry = (harness: "claude" | "codex", providerAccountId?: string) => ({
    id: `${harness}${providerAccountId ?? ""}`,
    harness,
    model: "m",
    unknownLimit: "use" as const,
    ...(providerAccountId ? { providerAccountId } : {}),
  });
  expect(
    overrideTargets([entry("claude", "work"), entry("claude", "work"), entry("codex")]),
  ).toEqual([{ kind: "provider", harness: "claude" }, work, codex]);
});
