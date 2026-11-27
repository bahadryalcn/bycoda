import { afterEach, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({ run: vi.fn(), resolve: vi.fn() }));
vi.mock("../../../integrations/harness/core/registry", () => ({
  runHarnessTextPrompt: provider.run,
  canRunHarnessTextPrompt: () => true,
}));
vi.mock("../../sessions/public/models", () => ({
  isModelEnabled: () => true,
  modelBelongsToHarness: () => true,
}));
vi.mock("../../sessions/public/modelDisplayName", () => ({
  modelDisplayName: (model: string) => model,
}));
vi.mock("../../providers/public/providerAccounts", () => ({
  DEFAULT_PROVIDER_ACCOUNT_ID: "default",
  supportsProviderAccounts: () => true,
  defaultProviderAccountId: () => "default",
  providerAccounts: () => [
    { id: "default", label: "Personal" },
    { id: "work", label: "Work" },
  ],
}));
vi.mock("../../sessions/public/titlePreferences", () => ({
  titleGenerationChoice: () => undefined,
}));
vi.mock("./helperModelRouting", () => ({
  resolveHelperModel: provider.resolve,
}));

import { rulePlan, type SetupCandidate, type SetupPoolNames } from "./smartSetup";
import { buildSetupPrompt, parsePlanAnswer, planFromAnswer, planSmartSetup } from "./smartSetupAi";

const names: SetupPoolNames = {
  smartest: "Smartest",
  balanced: "Balanced",
  light: "Low",
  work: "Work",
  personal: "Personal",
};

const make = (
  model: string,
  estimated: boolean,
  account?: SetupCandidate["account"],
  intelligence: 1 | 2 | 3 | 4 | 5 = 3,
): SetupCandidate => ({
  target: {
    harness: "codex",
    model,
    ...(account ? { providerAccountId: account.id } : {}),
    modelSettings: {},
  },
  modelName: model,
  ...(account ? { account } : {}),
  profile: { intelligence, cost: 2, estimated },
});

const answer = {
  accounts: [{ ref: "a1", kind: "work" }],
  models: [{ key: 1, intelligence: 5, cost: 3 }],
  order: [1, 0, 99],
  pools: [
    { name: "Heavy", members: [1, 42], includes: [] },
    { name: "Empty", members: [99], includes: [] },
  ],
  roles: { "task.worker": { pool: "Heavy" }, "text.title": "order", "not.a.role": "order" },
};

afterEach(() => {
  vi.useRealTimers();
  provider.run.mockReset();
  provider.resolve.mockReset();
});

it("sends every candidate with researched facts, the baseline, accounts and roles", () => {
  const prompt = buildSetupPrompt(
    [make("codex:gpt-6.1-sol", false, { id: "x", label: "Spare" }), make("mystery", true)],
    names,
  );
  expect(prompt).toContain('"researchedScore":87');
  expect(prompt).toContain('"usdPerMInput":2');
  expect(prompt).toContain('"profile":"estimated"');
  expect(prompt).toContain('"baselineOrder":[');
  expect(prompt).toContain('"ref":"a1"');
  expect(prompt).toContain('"kind":"unknown"');
  expect(prompt).toContain('"role":"task.worker"');
  expect(prompt).not.toContain('"id":"x"');
});

it("tolerates a code fence and drops invalid items instead of the whole answer", () => {
  const fenced = ["```json", JSON.stringify(answer), "```"].join(String.fromCharCode(10));
  expect(parsePlanAnswer(fenced)?.pools).toHaveLength(2);
  expect(parsePlanAnswer("nope")).toBeUndefined();
  const partial = parsePlanAnswer(
    JSON.stringify({
      ...answer,
      models: [{ key: 0, intelligence: 9, cost: 2 }, ...answer.models],
      accounts: [{ ref: "a1", kind: "unknown" }],
      roles: { ...answer.roles, steward: { pool: 3 } },
      pools: [...answer.pools, ...Array.from({ length: 20 }, (_, i) => ({ name: `P${i}` }))],
    }),
  )!;
  expect(partial.models).toEqual(answer.models);
  expect(partial.accounts).toEqual([]);
  expect(partial.roles).not.toHaveProperty("steward");
  expect(partial.pools).toHaveLength(12);
});

it("keeps only valid keys, known roles and estimated or kind-less answers", () => {
  const candidates = [
    make("known", false, { id: "a", label: "Spare" }),
    make("mystery", true, { id: "b", label: "Home", kind: "personal" }),
  ];
  const { candidates: refined, plan } = planFromAnswer(
    candidates,
    parsePlanAnswer(JSON.stringify(answer))!,
  );
  expect(refined[0]!.account?.kind).toBe("work");
  expect(refined[0]!.profile).toEqual(candidates[0]!.profile);
  expect(refined[1]!.profile).toEqual({ intelligence: 5, cost: 3, estimated: true });
  expect(refined[1]!.account?.kind).toBe("personal");
  expect(plan.order).toEqual([1, 0]);
  expect(plan.pools).toEqual([{ name: "Heavy", members: [1], includes: [] }]);
  expect(plan.roles).toEqual({ "task.worker": { pool: "Heavy" }, "text.title": "order" });
});

it("plans through the routing-setup binding and names the planner", async () => {
  provider.resolve.mockResolvedValue({
    harness: "codex",
    model: "helper",
    providerAccountId: "work",
    modelSettings: { serviceTier: "ultrafast", reasoningEffort: "high" },
  });
  provider.run.mockResolvedValue(JSON.stringify(answer));
  const candidates = [make("known", false), make("mystery", true)];
  const onPlanner = vi.fn();
  const result = await planSmartSetup(candidates, names, { onPlanner });
  expect(onPlanner).toHaveBeenCalledWith("helper · Codex · Work");
  expect(result.plannedBy).toBe("helper · Codex · Work");
  expect(result.plan.pools[0]!.name).toBe("Heavy");
  expect(provider.resolve).toHaveBeenCalledWith("text.routingSetup");
  expect(provider.run).toHaveBeenCalledWith(
    expect.objectContaining({
      model: "helper",
      providerAccountId: "work",
      modelSettings: { serviceTier: "default", reasoningEffort: "high" },
      cwd: "~",
      ephemeral: true,
      timeoutMs: expect.any(Number),
    }),
  );
});

it("discards Fast groups, includes and bindings returned by a planner", () => {
  const { plan } = planFromAnswer(
    [make("known", false)],
    parsePlanAnswer(
      JSON.stringify({
        pools: [
          { name: "Fast", members: [0] },
          { name: "Balanced", members: [0], includes: ["Fast"] },
        ],
        roles: { "task.worker": { pool: "Balanced" }, "text.title": { pool: "Fast" } },
      }),
    )!,
  );
  expect(plan.pools).toEqual([{ name: "Balanced", members: [0], includes: [] }]);
  expect(plan.roles).toEqual({ "task.worker": { pool: "Balanced" } });
});

it("falls back to the cheapest strong catalog model when no binding exists", async () => {
  provider.resolve.mockResolvedValue({
    harness: "codex",
    model: "removed-helper",
    providerAccountId: "removed",
  });
  provider.run.mockResolvedValue(JSON.stringify(answer));
  const strong = make("strong", false, undefined, 4);
  const result = await planSmartSetup([make("weak", false), strong], names, {});
  expect(provider.run.mock.calls[0]![0].model).toBe("strong");
  expect(result.plannedBy).toBe("strong · Codex · Personal");
});

it("runs the chosen model and account with its explicit effort and speed", async () => {
  provider.run.mockResolvedValue(JSON.stringify(answer));
  const planner = {
    harness: "codex",
    model: "chosen",
    providerAccountId: "work",
    modelSettings: { reasoningEffort: "high", serviceTier: "fast" },
  } as const;
  const candidates = [make("known", false), make("mystery", true)];
  const result = await planSmartSetup(candidates, names, { planner });
  expect(provider.run).toHaveBeenCalledWith(expect.objectContaining(planner));
  expect(provider.resolve).not.toHaveBeenCalled();
  expect(result.plannedBy).toBe("chosen · Codex · Work");

  provider.run.mockClear();
  const failed = await planSmartSetup(candidates, names, {
    planner: { ...planner, providerAccountId: "removed" },
  });
  expect(provider.run).not.toHaveBeenCalled();
  expect(failed.failure?.planner).toBe("chosen · Codex · removed");
});

it("never rejects: no model, garbage, failure and hang use the researched rules", async () => {
  const candidates = [make("mystery", true)];
  const rules = { candidates, plan: rulePlan(candidates, names) };
  expect(await planSmartSetup(candidates, names, {})).toEqual(rules);
  provider.resolve.mockResolvedValue({ harness: "codex", model: "helper", modelSettings: {} });
  provider.run.mockResolvedValueOnce("garbage");
  expect(await planSmartSetup(candidates, names, {})).toEqual({
    ...rules,
    failure: { planner: "helper · Codex · Personal", reason: "unreadable" },
  });
  provider.run.mockResolvedValueOnce(
    JSON.stringify({ models: [{ key: 0, intelligence: 5, cost: 4 }] }),
  );
  expect(await planSmartSetup(candidates, names, {})).toEqual({
    ...rules,
    failure: { planner: "helper · Codex · Personal", reason: "unreadable" },
  });
  provider.run.mockRejectedValueOnce(new Error("offline"));
  expect(await planSmartSetup(candidates, names, {})).toEqual({
    ...rules,
    failure: { planner: "helper · Codex · Personal", reason: "error", detail: "offline" },
  });
  vi.useFakeTimers();
  provider.run.mockReturnValueOnce(new Promise(() => {}));
  const pending = planSmartSetup(candidates, names, {});
  await vi.advanceTimersByTimeAsync(250_000);
  expect(await pending).toEqual({
    ...rules,
    failure: { planner: "helper · Codex · Personal", reason: "timeout" },
  });
  expect(provider.run.mock.calls.at(-1)?.[0].signal.aborted).toBe(true);
});
