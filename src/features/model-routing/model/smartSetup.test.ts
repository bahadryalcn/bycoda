import { expect, it, vi } from "vitest";
import {
  EMPTY_MODEL_ROUTING,
  MODEL_ROUTING_MAX_ENTRIES,
  MODEL_ROUTING_MAX_POOLS,
  ModelRoutingPoolSchema,
} from "../../../shared/model/host-contracts/model-routing";
import type { ModelSource } from "../../sessions/public/modelSource";
import { orderDraft, prepareOrderSave } from "./modelRoutingDraft";
import {
  applySmartSetup,
  setupCandidates,
  sortOrderDraft,
  type SetupCandidate,
  type SetupPoolNames,
} from "./smartSetup";

vi.mock("../../providers/public/providerAccounts", () => ({
  supportsProviderAccounts: (harness: string) => harness === "codex" || harness === "claude",
  providerAccounts: () => [
    { id: "local-secret", label: "Local" },
    { id: "w", label: "Work", kind: "personal" },
  ],
}));
vi.mock("../../sessions/public/models", () => ({
  defaultModelSettings: () => ({ effort: "high", crossAdvisor: "reserved" }),
  isModelEnabled: (id: string) => id !== "disabled",
  loadHiddenPickerProviders: () => ["claude"],
}));

const names: SetupPoolNames = {
  smartest: "Smartest",
  balanced: "Balanced",
  fast: "Fast",
  work: "Work",
  personal: "Personal",
};
const draft = () =>
  orderDraft(
    { ...structuredClone(EMPTY_MODEL_ROUTING), version: 1, updatedAt: 0 },
    { maxRunningTasks: 2, dailyAgentMinutes: 30 },
  );
const candidate = (
  model: string,
  intelligence: 1 | 2 | 3 | 4 | 5,
  cost: 1 | 2 | 3 | 4,
  account?: SetupCandidate["account"],
): SetupCandidate => ({
  target: {
    harness: "codex",
    model,
    ...(account ? { providerAccountId: account.id } : {}),
    modelSettings: { effort: "high", crossAdvisor: "reserved" },
  },
  modelName: model,
  ...(account ? { account } : {}),
  profile: { intelligence, cost, estimated: false },
});

function source(): ModelSource {
  return {
    modelsFor: (harness) => ["enabled", "disabled"].map((id) => ({ id, harness, name: id })),
    available: (harness) => ["codex", "claude", "cursor"].includes(harness),
    probed: () => true,
    refresh: vi.fn(),
    resolve: vi.fn(),
    find: vi.fn(),
  };
}

it("lists available visible providers, enabled models and local accounts with kinds", () => {
  const found = setupCandidates(source());
  expect(found.map((c) => c.target.model)).toEqual(["enabled", "enabled", "enabled"]);
  expect(found[0].target).toEqual({
    harness: "codex",
    model: "enabled",
    providerAccountId: "local-secret",
    modelSettings: { effort: "high", crossAdvisor: "reserved" },
  });
  expect(found[0].account).toEqual({ id: "local-secret", label: "Local" });
  expect(found[1].account?.kind).toBe("personal");
  expect(found[2].account).toBeUndefined();
});

it("infers the kind from the label and uses explicit Host catalogs only", () => {
  const host = {
    ...source(),
    id: "remote",
    accounts: { codex: [{ id: "host", label: "Company" }] },
  };
  const found = setupCandidates(host);
  expect(found.filter((c) => c.target.harness === "codex")).toHaveLength(2);
  expect(found[0].account?.kind).toBe("work");
  expect(found.some((c) => c.target.providerAccountId === "local-secret")).toBe(false);
  expect(setupCandidates({ ...source(), available: () => false })).toEqual([]);
});

it("adds missing models, sorts smartest-first and creates tier pools", () => {
  const candidates = [
    candidate("mini", 2, 1),
    candidate("opus", 4, 3),
    candidate("opus", 4, 3, { id: "a", label: "A" }),
    candidate("mid", 3, 2),
    candidate("cheap-opus", 4, 2),
  ];
  const original = draft();
  const next = applySmartSetup(original, candidates, names);
  expect(original.routing.entries).toEqual([]);
  expect(next.routing.entries).toHaveLength(5);
  expect(next.routing.entries.every((e) => !e.modelSettings.crossAdvisor)).toBe(true);
  expect(next.routing.pools.map((p) => [p.name, p.entryIds.length])).toEqual([
    ["Smartest", 3],
    ["Balanced", 1],
    ["Fast", 1],
  ]);
  expect(prepareOrderSave(next).routing.entries).toHaveLength(5);
});

it("keeps existing ids, limits, unknown entries and pools; is idempotent", () => {
  const first = applySmartSetup(draft(), [candidate("opus", 4, 3)], names);
  const id = first.routing.entries[0].id;
  first.percentages[id] = "60";
  first.routing.entries[0].unknownLimit = "skip";
  first.routing.entries.push({
    id: "legacy",
    harness: "cursor",
    model: "old",
    modelSettings: {},
    unknownLimit: "use",
  });
  first.percentages.legacy = "0";
  first.routing.pools[0].name = "smartest";
  const candidates = [candidate("opus", 4, 3), candidate("mini", 2, 1)];
  const second = applySmartSetup(first, candidates, names);
  expect(second.routing.entries[0].id).toBe(id);
  expect(second.routing.entries.map((e) => e.model)).toEqual(["opus", "mini", "old"]);
  expect(second.routing.entries[0].unknownLimit).toBe("skip");
  expect(second.percentages[id]).toBe("60");
  expect(second.routing.pools.map((p) => p.name)).toEqual(["smartest", "Fast"]);
  expect(second.routing.pools[0].entryIds).toEqual([id]);
  expect(applySmartSetup(second, candidates, names)).toEqual(second);
});

it("creates Work and Personal pools only when an account has a kind, sharing unlabelled", () => {
  const candidates = [
    candidate("a", 4, 3, { id: "w", label: "Work", kind: "work" }),
    candidate("b", 4, 3, { id: "p", label: "Home", kind: "personal" }),
    candidate("c", 4, 3, { id: "s", label: "Spare" }),
    candidate("d", 4, 3),
  ];
  const next = applySmartSetup(draft(), candidates, names);
  const model = (id: string) => next.routing.entries.find((e) => e.id === id)!.model;
  const pool = (name: string) =>
    next.routing.pools
      .find((p) => p.name === name)!
      .entryIds.map(model)
      .sort();
  expect(pool("Work")).toEqual(["a", "c", "d"]);
  expect(pool("Personal")).toEqual(["b", "c", "d"]);
  const plain = applySmartSetup(draft(), [candidate("d", 4, 3)], names);
  expect(plain.routing.pools.map((p) => p.name)).toEqual(["Smartest"]);
});

it("respects entry and pool limits", () => {
  const full = draft();
  full.routing.entries = Array.from({ length: MODEL_ROUTING_MAX_ENTRIES }, (_, i) => ({
    id: `e${i}`,
    harness: "cursor" as const,
    model: `m${i}`,
    modelSettings: {},
    unknownLimit: "use" as const,
  }));
  expect(() => applySmartSetup(full, [candidate("x", 3, 2)], names)).toThrow("Not enough room");
  const pools = draft();
  pools.routing.pools = Array.from({ length: MODEL_ROUTING_MAX_POOLS }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    entryIds: ["e"],
  }));
  expect(() => applySmartSetup(pools, [candidate("x", 3, 2)], names)).toThrow("catalog pools");
});

it("fits long Unicode pool names into the wire limit", () => {
  const next = applySmartSetup(draft(), [candidate("x", 5, 4)], {
    ...names,
    smartest: "\u{1F9D1}\u{1F3FD}‍\u{1F4BB}".repeat(48),
  });
  expect(next.routing.pools[0].name.length).toBeLessThanOrEqual(80);
  expect(ModelRoutingPoolSchema.safeParse(next.routing.pools[0]).success).toBe(true);
});

it("sorts the main order by intelligence or cost, stably", () => {
  const base = applySmartSetup(
    draft(),
    [candidate("claude-haiku-4-5", 2, 1), candidate("claude-opus-4-6", 4, 3)],
    names,
  );
  const reversed = {
    ...base,
    routing: { ...base.routing, entries: [...base.routing.entries].reverse() },
  };
  expect(sortOrderDraft(reversed, "intelligence").routing.entries.map((e) => e.model)).toEqual([
    "claude-opus-4-6",
    "claude-haiku-4-5",
  ]);
  expect(sortOrderDraft(base, "cost").routing.entries.map((e) => e.model)).toEqual([
    "claude-haiku-4-5",
    "claude-opus-4-6",
  ]);
  expect(sortOrderDraft(base, "cost").routing.pools).toEqual(base.routing.pools);
});
