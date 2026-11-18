import { expect, it, vi } from "vitest";
import { EMPTY_MODEL_ROUTING } from "../../../../shared/model/host-contracts/model-routing";
import { orderDraft } from "../../model/modelRoutingDraft";
import type { SetupCandidate } from "../../model/smartSetup";
import { addAccountModels, addEntriesToPool, removeEntries, setEntriesEffort } from "./orderBulk";
import { groupByAccount, jobsUsingOrder } from "./orderGrouping";

vi.mock("../../../sessions/public/models", () => ({
  resolveModel: (_harness: string, id: string) => ({ id }),
  modelEffortSetting: (model: { id: string }) =>
    model.id === "plain"
      ? undefined
      : { id: "effort", options: [{ value: "low" }, { value: "high", label: "High" }] },
}));
vi.mock("../../../providers/public/providerAccounts", () => ({
  defaultProviderAccountId: () => "default",
  supportsProviderAccounts: (harness: string) => harness !== "grok",
  providerAccounts: () => [{ id: "default", label: "Default account" }],
}));

const entry = (id: string, harness: string, model = "m", providerAccountId?: string) => ({
  id,
  harness,
  model,
  modelSettings: {},
  unknownLimit: "use" as const,
  ...(providerAccountId ? { providerAccountId } : {}),
});
const draftOf = (entries: ReturnType<typeof entry>[], pools: object[] = []) =>
  orderDraft({ ...EMPTY_MODEL_ROUTING, version: 1, updatedAt: 0, entries, pools } as never, {
    maxRunningTasks: 2,
    dailyAgentMinutes: 0,
  });

it("groups by account in first-seen order and keeps each row's priority position", () => {
  const groups = groupByAccount([
    entry("a", "claude"),
    entry("b", "codex"),
    entry("c", "claude", "m2", "default"),
  ] as never);
  expect(groups.map((group) => [group.harness, group.rows.map((row) => row.index)])).toEqual([
    ["claude", [0, 2]],
    ["codex", [1]],
  ]);
  expect(groups[0]!.account?.label).toBe("Default account");
});

it("counts bound-to-order and unbound jobs, but not unbound text helpers", () => {
  const all = jobsUsingOrder({});
  expect(all).toBeGreaterThan(0);
  expect(jobsUsingOrder({ "task.worker": { kind: "pool", poolId: "p" } })).toBe(all - 1);
  expect(jobsUsingOrder({ "text.title": { kind: "order" } } as never)).toBe(all + 1);
});

it("removes several entries and refuses to empty a group", () => {
  const draft = draftOf(
    [entry("a", "claude"), entry("b", "codex"), entry("c", "grok")],
    [{ id: "p", name: "P", entryIds: ["a"] }],
  );
  expect(removeEntries(draft, ["b", "c"]).routing.entries.map((item) => item.id)).toEqual(["a"]);
  expect(() => removeEntries(draft, ["a"])).toThrow(/Group "P" would be empty/);
});

it("sets effort only where the model accepts the value", () => {
  const draft = draftOf([entry("a", "claude"), entry("b", "claude", "plain")]);
  const next = setEntriesEffort(draft, new Set(["a", "b"]), "high");
  expect(next.routing.entries.map((item) => item.modelSettings)).toEqual([{ effort: "high" }, {}]);
});

it("adds entries to a group once", () => {
  const draft = draftOf(
    [entry("a", "claude"), entry("b", "codex")],
    [{ id: "p", name: "P", entryIds: ["a"] }],
  );
  const next = addEntriesToPool(draft, "p", ["a", "b"]);
  expect(next.routing.pools[0]!.entryIds).toEqual(["a", "b"]);
});

it("adds the account's catalog models the order does not list yet", () => {
  const candidate = (model: string, providerAccountId?: string) =>
    ({
      target: {
        harness: "claude",
        model,
        ...(providerAccountId ? { providerAccountId } : {}),
        modelSettings: { effort: "high" },
      },
    }) as unknown as SetupCandidate;
  const draft = draftOf([entry("a", "claude", "m1")]);
  const next = addAccountModels(
    draft,
    [candidate("m1", "default"), candidate("m2", "default"), candidate("m3", "other")],
    "claude",
    "default",
  );
  expect(next.routing.entries.map((item) => item.model)).toEqual(["m1", "m2"]);
  expect(next.percentages[next.routing.entries[1]!.id]).toBe("");
});

it("names the group when the whole selection would empty it, before removing anything", () => {
  const draft = draftOf(
    [entry("a", "claude"), entry("b", "codex"), entry("c", "grok")],
    [{ id: "p", name: "Pair", entryIds: ["a", "b"] }],
  );
  expect(() => removeEntries(draft, ["a", "b"])).toThrow(
    'Group "Pair" would be empty. Remove it or keep one of its models.',
  );
  expect(removeEntries(draft, ["a", "c"]).routing.pools[0]!.entryIds).toEqual(["b"]);
});
