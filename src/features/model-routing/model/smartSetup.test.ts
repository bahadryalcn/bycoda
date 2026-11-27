import { expect, it, vi } from "vitest";
import {
  EMPTY_MODEL_ROUTING,
  MODEL_ROUTING_MAX_ENTRIES,
  MODEL_ROUTING_MAX_POOLS,
  ModelRoutingPoolSchema,
} from "../../../shared/model/host-contracts/model-routing";
import { decodeAdvisor, decodeSubagents } from "../../../shared/model/host-contracts/delegation";
import type { ModelSource } from "../../sessions/public/modelSource";
import { orderDraft, prepareOrderSave } from "./modelRoutingDraft";
import {
  applySmartSetup,
  baselineOrder,
  enforceRoleNeeds,
  planDelegation,
  ROLE_NEED,
  rulePlan,
  setupCandidates,
  sortOrderDraft,
  type SetupCandidate,
  type SetupPoolNames,
} from "./smartSetup";

vi.mock("../../providers/public/providerAccounts", () => ({
  DEFAULT_PROVIDER_ACCOUNT_ID: "default",
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
  modelEffortSetting: () => ({
    id: "effort",
    options: ["low", "medium", "high", "xhigh"].map((value) => ({ value })),
  }),
}));

const names: SetupPoolNames = {
  smartest: "Smartest",
  balanced: "Balanced",
  light: "Low",
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

const setup = (base: ReturnType<typeof draft>, list: SetupCandidate[], poolNames = names) =>
  applySmartSetup(base, list, rulePlan(list, poolNames), {
    ...source(),
    accountsKnown: () => false,
  });

it("turns off accelerated settings in new and reused model rows", () => {
  const codex = candidate("worker", 4, 2);
  codex.target.modelSettings.serviceTier = "fast";
  const claude = candidate("reviewer", 5, 3);
  claude.target.harness = "claude";
  claude.target.modelSettings.fast = "true";
  const base = draft();
  base.routing.entries.push({ ...claude.target, id: "existing", unknownLimit: "use" });
  const next = setup(base, [codex, claude]);
  expect(next.routing.entries.find((entry) => entry.id === "existing")?.modelSettings.fast).toBe(
    "false",
  );
  expect(
    next.routing.entries.find((entry) => entry.harness === "codex")?.modelSettings.serviceTier,
  ).toBe("default");
  expect(base.routing.entries[0].modelSettings.fast).toBe("true");
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
  expect(found[0].account).toEqual({ id: "local-secret", label: "Local", kind: "personal" });
  expect(found[0].effort).toEqual({ id: "effort", options: ["low", "medium", "high", "xhigh"] });
  expect(found[1].account?.kind).toBe("personal");
  expect(found[2].account).toBeUndefined();
});

it("defaults legacy Host accounts to Personal and uses explicit Host catalogs only", () => {
  const host = {
    ...source(),
    id: "remote",
    accounts: { codex: [{ id: "host", label: "Company" }] },
  };
  const found = setupCandidates(host);
  expect(found.filter((c) => c.target.harness === "codex")).toHaveLength(2);
  expect(found[0].account?.kind).toBe("personal");
  expect(found.some((c) => c.target.providerAccountId === "local-secret")).toBe(false);
  expect(setupCandidates({ ...source(), available: () => false })).toEqual([]);
});

it("proposes concrete models available to the Host and skips mismatched Claude aliases", () => {
  const concrete = {
    id: "claude:fable-5-2",
    nativeId: "claude-fable-5-2",
    harness: "claude",
    name: "Fable 5.2",
  } as const;
  const alias = {
    ...concrete,
    id: "claude:fable",
    nativeId: "fable",
    aliasTarget: "claude-fable-5-2",
  };
  const renderer = {
    ...source(),
    id: "remote",
    accounts: { claude: [{ id: "default", label: "Default" }] },
    modelsFor: () => [alias, concrete, { ...concrete, id: "claude:missing" }],
  };
  const catalog = { models: { claude: [concrete] } };
  expect(setupCandidates(renderer, catalog).map(({ target }) => target.model)).toEqual([
    concrete.id,
  ]);
  expect(
    setupCandidates(renderer, { models: { claude: [alias, concrete] } }).map(
      ({ target }) => target.model,
    ),
  ).toEqual([concrete.id]);
});

it("adds missing models, orders strong moderately priced models first and creates tier pools", () => {
  const candidates = [
    candidate("mini", 2, 1),
    candidate("opus", 4, 3),
    candidate("opus", 4, 3, { id: "a", label: "A" }),
    candidate("mid", 3, 2),
    candidate("cheap-opus", 4, 2),
  ];
  const original = draft();
  const next = setup(original, candidates);
  expect(original.routing.entries).toEqual([]);
  expect(next.routing.entries.map((e) => e.model)).toEqual(["cheap-opus", "opus", "mid", "mini"]);
  expect(next.routing.entries.every((e) => !e.modelSettings.crossAdvisor)).toBe(true);
  expect(next.routing.pools.map((p) => [p.name, p.entryIds.length])).toEqual([
    ["Smartest", 2],
    ["Balanced", 3],
    ["Low", 1],
  ]);
  expect(prepareOrderSave(next).routing.entries).toHaveLength(4);
});

it("puts Opus and Sol first, cheaper capable models next and top-priced models after them", () => {
  const list = (
    [
      ["claude:fable-5-2", 5, 4],
      ["codex:gpt-6-astra", 5, 4],
      ["codex:gpt-6-luna", 2, 1],
      ["claude:haiku-5-5", 2, 1],
      ["codex:gpt-6.1-terra", 3, 1],
      ["claude:sonnet-5-5", 3, 2],
      ["codex:gpt-6.1-sol", 4, 2],
      ["claude:opus-5-5", 4, 3],
    ] as const
  ).map(([model, intelligence, cost]) => candidate(model, intelligence, cost));
  for (const item of list)
    if (item.target.model.startsWith("claude:")) item.target.harness = "claude";
  expect(baselineOrder(list).map((i) => list[i]!.target.model)).toEqual([
    "claude:opus-5-5",
    "codex:gpt-6.1-sol",
    "claude:sonnet-5-5",
    "codex:gpt-6.1-terra",
    "claude:fable-5-2",
    "codex:gpt-6-astra",
    "claude:haiku-5-5",
    "codex:gpt-6-luna",
  ]);
  const plan = rulePlan(list, names);
  const members = (name: string) =>
    plan.pools.find((pool) => pool.name === name)!.members.map((i) => list[i]!.target.model);
  expect(members("Smartest").slice(0, 2)).toEqual(["claude:fable-5-2", "codex:gpt-6-astra"]);
  expect(members("Balanced")).toEqual([
    "claude:opus-5-5",
    "codex:gpt-6.1-sol",
    "claude:sonnet-5-5",
    "codex:gpt-6.1-terra",
  ]);
});

it("plans the advisor, one standard and one light subagent per provider, and clears overrides", () => {
  const list = (
    [
      ["claude:fable-5-2", 5, 4],
      ["claude:sonnet-5-5", 3, 2],
      ["claude:haiku-5-5", 2, 1],
      ["codex:gpt-6.1-sol", 4, 2],
      ["codex:gpt-6.1-terra", 3, 1],
    ] as const
  ).map(([model, intelligence, cost]) => candidate(model, intelligence, cost));
  list[1]!.target.harness = "claude";
  list[2]!.target.harness = "claude";
  list[0]!.target.harness = "claude";
  const next = planDelegation(
    {
      global: { crossSubagentMaxEffort: "max", imageModels: "keep" },
      providers: { claude: { crossAdvisor: "old" } },
      accounts: { "claude\nwork": { crossSubagents: "old", other: "kept" } },
    },
    list,
  );
  expect(decodeAdvisor(next.global.crossAdvisor)).toEqual({
    harness: "claude",
    model: "claude:fable-5-2",
  });
  expect(decodeSubagents(next.global.crossSubagents).map((ref) => ref.model)).toEqual([
    "claude:sonnet-5-5",
    "codex:gpt-6.1-terra",
    "claude:haiku-5-5",
  ]);
  expect(next.global.crossSubagentMaxEffort).toBe("medium");
  expect(next.global.imageModels).toBe("keep");
  expect(next.providers).toEqual({});
  expect(next.accounts).toEqual({ "claude\nwork": { other: "kept" } });
});

it("binds every role to a tier pool and replaces earlier fixed bindings", () => {
  const base = draft();
  base.routing.roles = {
    "task.worker": { kind: "fixed", target: { harness: "codex", model: "x", modelSettings: {} } },
  };
  const next = setup(base, [
    candidate("opus", 4, 3),
    candidate("mid", 3, 2),
    candidate("mini", 2, 1),
  ]);
  const poolName = (role: keyof typeof next.routing.roles) => {
    const choice = next.routing.roles[role];
    return choice?.kind === "pool"
      ? next.routing.pools.find((p) => p.id === choice.poolId)?.name
      : choice?.kind;
  };
  expect(poolName("task.worker")).toBe("Balanced");
  expect(poolName("task.reviewer")).toBe("Smartest");
  expect(poolName("text.title")).toBe("Low");
  expect(poolName("voice.reply")).toBe("Low");
  expect(() => prepareOrderSave(next)).not.toThrow();
});

it("keeps existing ids, limits and unknown entries, refills same-named pools; is idempotent", () => {
  const first = setup(draft(), [candidate("opus", 4, 3)]);
  const id = first.routing.entries[0].id;
  const poolId = first.routing.pools[0].id;
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
  first.routing.pools.push({ id: "mine", name: "Mine", entryIds: ["legacy"] });
  const candidates = [candidate("opus", 4, 3), candidate("mini", 2, 1)];
  const second = setup(first, candidates);
  expect(second.routing.entries[0].id).toBe(id);
  expect(second.routing.entries.map((e) => e.model)).toEqual(["opus", "mini", "old"]);
  expect(second.routing.entries[0].unknownLimit).toBe("skip");
  expect(second.percentages[id]).toBe("60");
  expect(second.routing.pools.map((p) => p.name)).toEqual(["smartest", "Balanced", "Mine", "Low"]);
  expect(second.routing.pools[0].id).toBe(poolId);
  expect(second.routing.pools[2].entryIds).toEqual(["legacy"]);
  expect(setup(second, candidates)).toEqual(second);
});

it("drops removed account rows and cleans up their group and role references", () => {
  const base = draft();
  const gone = candidate("retired", 5, 3, { id: "removed", label: "Removed" });
  const active = candidate("worker", 4, 2, { id: "w", label: "Work" });
  base.routing.entries.push(
    { ...gone.target, id: "gone", unknownLimit: "use" },
    { ...active.target, id: "keep", unknownLimit: "skip" },
  );
  base.percentages = { gone: "70", keep: "20" };
  base.routing.pools = [
    { id: "gone-group", name: "Retired", entryIds: ["gone"] },
    { id: "nested", name: "Nested", entryIds: [], poolIds: ["gone-group"] },
    { id: "mixed", name: "Mixed", entryIds: ["keep", "gone"], poolIds: ["nested"] },
  ];
  base.routing.roles["voice.reply"] = { kind: "pool", poolId: "nested" };
  const modelSource = { ...source(), accounts: { codex: [{ id: "w", label: "Work" }] } };
  const next = applySmartSetup(base, [active], { order: [0], pools: [], roles: {} }, modelSource);
  expect(next.routing.entries.map((entry) => entry.id)).toEqual(["keep"]);
  expect(next.percentages).toEqual({ keep: "20" });
  expect(next.routing.pools).toEqual([{ id: "mixed", name: "Mixed", entryIds: ["keep"] }]);
  expect(next.routing.roles["voice.reply"]).toBeUndefined();
  expect(base.routing.entries).toHaveLength(2);
  const unknown = applySmartSetup(
    base,
    [active],
    { order: [0], pools: [], roles: {} },
    {
      ...modelSource,
      accountsKnown: () => false,
    },
  );
  expect(unknown.routing.entries.map((entry) => entry.id)).toEqual(["keep", "gone"]);
});

it("applies planned pool includes and drops ones that would loop", () => {
  const list = [candidate("a", 4, 3), candidate("b", 2, 1)];
  const next = applySmartSetup(
    draft(),
    list,
    {
      order: [1, 0],
      pools: [
        { name: "Top", members: [0], includes: ["Low"] },
        { name: "Low", members: [1], includes: [] },
      ],
      roles: { "task.worker": { pool: "Top" }, "text.git": "order" },
    },
    { ...source(), accountsKnown: () => false },
  );
  const low = next.routing.pools.find((p) => p.name === "Low")!;
  expect(next.routing.entries.map((e) => e.model)).toEqual(["b", "a"]);
  expect(next.routing.pools.find((p) => p.name === "Top")!.poolIds).toEqual([low.id]);
  expect(next.routing.roles["text.git"]).toEqual({ kind: "order" });
  const looping = applySmartSetup(
    draft(),
    list,
    {
      order: [],
      pools: [
        { name: "Top", members: [0], includes: ["Low"] },
        { name: "Low", members: [1], includes: ["Top"] },
      ],
      roles: {},
    },
    { ...source(), accountsKnown: () => false },
  );
  expect(looping.routing.pools.every((p) => !p.poolIds)).toBe(true);
});

it("creates Work and Personal pools only when an account has a kind, sharing unlabelled", () => {
  const candidates = [
    candidate("a", 4, 3, { id: "w", label: "Work", kind: "work" }),
    candidate("b", 4, 3, { id: "p", label: "Home", kind: "personal" }),
    candidate("c", 4, 3, { id: "s", label: "Spare" }),
    candidate("d", 4, 3),
  ];
  const next = setup(draft(), candidates);
  const model = (id: string) => next.routing.entries.find((e) => e.id === id)!.model;
  const pool = (name: string) =>
    next.routing.pools
      .find((p) => p.name === name)!
      .entryIds.map(model)
      .sort();
  expect(pool("Work")).toEqual(["a", "c", "d"]);
  expect(pool("Personal")).toEqual(["b", "c", "d"]);
  const plain = setup(draft(), [candidate("d", 4, 3)]);
  expect(plain.routing.pools.map((p) => p.name)).toEqual(["Smartest", "Balanced"]);
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
  expect(() => setup(full, [candidate("x", 3, 2)])).toThrow("Not enough room");
  const pools = draft();
  pools.routing.pools = Array.from({ length: MODEL_ROUTING_MAX_POOLS }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    entryIds: ["e"],
  }));
  expect(() => setup(pools, [candidate("x", 3, 2)])).toThrow("catalog pools");
});

it("fits long Unicode pool names into the wire limit", () => {
  const next = setup(draft(), [candidate("x", 5, 4)], {
    ...names,
    smartest: "\u{1F9D1}\u{1F3FD}‍\u{1F4BB}".repeat(48),
  });
  expect(next.routing.pools[0].name.length).toBeLessThanOrEqual(80);
  expect(ModelRoutingPoolSchema.safeParse(next.routing.pools[0]).success).toBe(true);
});

it("sorts the main order by intelligence or cost, stably", () => {
  const base = setup(draft(), [
    candidate("claude-haiku-4-5", 2, 1),
    candidate("claude-opus-4-6", 4, 3),
  ]);
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

it("moves each job to a pool that suits it when a plan binds it wrongly", () => {
  const list = [candidate("frontier", 5, 4), candidate("worker", 4, 2), candidate("cheap", 2, 1)];
  const plan = enforceRoleNeeds(list, {
    order: [0, 1, 2],
    pools: [
      { name: "Top", members: [0], includes: [] },
      { name: "Value", members: [1], includes: [] },
      { name: "Quick", members: [2], includes: [] },
      { name: "Wrapper", members: [], includes: ["Quick"] },
    ],
    roles: {
      "text.title": { pool: "Top" },
      "text.git": "order",
      "voice.reply": { pool: "Wrapper" },
      "task.reviewer": { pool: "Quick" },
      "task.worker": { pool: "Top" },
      "goal.planner": { pool: "Top" },
    },
  });
  expect(plan.roles).toEqual({
    "text.title": { pool: "Quick" },
    "text.git": { pool: "Quick" },
    "voice.reply": { pool: "Wrapper" },
    "task.reviewer": { pool: "Top" },
    "task.worker": { pool: "Value" },
    "goal.planner": { pool: "Top" },
  });
});

it("binds light jobs to the low-effort pool and heavy jobs to the smartest in the rule plan", () => {
  const list = [candidate("frontier", 5, 4), candidate("worker", 4, 2), candidate("cheap", 2, 1)];
  const { roles } = rulePlan(list, names);
  for (const [role, need] of Object.entries(ROLE_NEED))
    expect(roles[role as keyof typeof roles]).toEqual({
      pool: need === "light" ? "Low" : need === "heavy" ? "Smartest" : "Balanced",
    });
});

it("runs light pools at low, the order at medium and heavy pools at high, never above", () => {
  const efforts = { id: "effort", options: ["minimal", "low", "medium", "high", "xhigh"] };
  const list = [
    { ...candidate("strong", 5, 3), effort: efforts },
    { ...candidate("mid", 3, 2), effort: efforts },
    { ...candidate("mini", 2, 1), effort: efforts },
  ];
  const next = setup(draft(), list);
  const [strong, , mini] = next.routing.entries;
  const pool = (name: string) => next.routing.pools.find((item) => item.name === name)!;
  expect(next.routing.entries.map((e) => e.modelSettings.effort)).toEqual([
    "medium",
    "medium",
    "medium",
  ]);
  // Each group sets the effort per model; the order entries stay at medium.
  expect(pool("Smartest")).toMatchObject({
    entryIds: [strong!.id],
    memberSettings: { [strong!.id]: { effort: "high" } },
  });
  expect(Object.values(pool("Balanced").memberSettings ?? {})).toEqual(
    pool("Balanced").entryIds.map(() => ({ effort: "medium" })),
  );
  expect(pool("Low")).toMatchObject({
    entryIds: [mini!.id],
    memberSettings: { [mini!.id]: { effort: "low" } },
  });
  expect(next.routing.pools.some((item) => item.effort)).toBe(false);
  expect(next.routing.entries.some((e) => e.modelSettings.effort === "xhigh")).toBe(false);
  expect(setup(next, list).routing.entries).toHaveLength(next.routing.entries.length);
});

it("keeps legacy copies and refills pools using the existing medium entry when available", () => {
  const list = [{ ...candidate("strong", 5, 3), effort: { id: "effort", options: ["xhigh"] } }];
  expect(setup(draft(), list).routing.entries.map((e) => e.modelSettings.effort)).toEqual(["high"]);
  const owner = draft();
  owner.routing.entries = [
    { ...list[0]!.target, id: "own", modelSettings: { effort: "max" }, unknownLimit: "use" },
    { ...list[0]!.target, id: "medium", modelSettings: { effort: "medium" }, unknownLimit: "use" },
  ];
  const tuned = [{ ...list[0]!, effort: { id: "effort", options: ["medium", "high", "max"] } }];
  const next = setup(owner, tuned);
  expect(next.routing.pools.find((p) => p.name === "Smartest")).toMatchObject({
    entryIds: ["medium"],
    memberSettings: { medium: { effort: "high" } },
  });
  expect(next.routing.entries.map((e) => e.id)).toEqual(["medium", "own"]);
  expect(next.routing.entries.find((e) => e.id === "own")!.modelSettings.effort).toBe("max");
});

it("applies AI order to pool members and baseline tier fallbacks only", () => {
  const account = { id: "other", label: "Other" };
  const list = [
    candidate("top", 5, 3),
    candidate("pool-only", 4, 3),
    candidate("unused", 4, 3),
    candidate("other-best", 5, 3, account),
    candidate("other-unused", 4, 3, account),
    candidate("light", 2, 1),
  ];
  const next = applySmartSetup(
    draft(),
    list,
    {
      order: [2, 1],
      pools: [{ name: "Top", members: [1], includes: [] }],
      roles: { "task.reviewer": { pool: "Top" } },
    },
    { ...source(), accountsKnown: () => false },
  );
  expect(next.routing.entries.map((entry) => entry.model)).toEqual([
    "pool-only",
    "top",
    "other-best",
    "light",
  ]);
  expect(next.routing.pools[0]!.entryIds).toEqual([next.routing.entries[0]!.id]);
});
