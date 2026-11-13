import { describe, expect, it } from "vitest";
import {
  EMPTY_MODEL_ROUTING,
  MODEL_ROUTING_DELEGATION_KEYS,
  type ModelRoutingEntry,
  type ModelRoutingState,
} from "../../../shared/model/host-contracts/model-routing";
import {
  entrySettings,
  orderDraft,
  prepareOrderSave,
  removeOrderEntry,
  removeOrderPool,
  replaceOrderEntry,
  sameOrderDraft,
  setPoolEntries,
} from "./modelRoutingDraft";

const entry = (id: string): ModelRoutingEntry => ({
  id,
  harness: "codex",
  model: "gpt",
  modelSettings: { effort: "high" },
  unknownLimit: "use",
});
const state = (): ModelRoutingState => ({
  ...structuredClone(EMPTY_MODEL_ROUTING),
  version: 3,
  updatedAt: 1,
  entries: [entry("a"), entry("b")],
  pools: [{ id: "p", name: "Work", entryIds: ["b", "a"] }],
});
const draft = () => orderDraft(state(), { maxRunningTasks: 2, dailyAgentMinutes: 0 });

describe("model routing order draft", () => {
  it("clones state, retains roles and delegation, omits storage metadata", () => {
    const original = state();
    original.roles["task.worker"] = { kind: "pool", poolId: "p" };
    original.delegation.global = { crossAdvisor: "test" };
    const edit = orderDraft(original, { maxRunningTasks: 3, dailyAgentMinutes: 120 });
    edit.routing.entries.reverse();
    const input = prepareOrderSave(edit);
    expect(original.entries.map((row) => row.id)).toEqual(["a", "b"]);
    expect(input.routing.entries.map((row) => row.id)).toEqual(["b", "a"]);
    expect(input.routing.roles).toEqual(original.roles);
    expect(input.routing.delegation).toEqual(original.delegation);
    expect(input.routing).not.toHaveProperty("version");
    expect(input.limits).toEqual({ maxRunningTasks: 3, dailyAgentMinutes: 120 });
  });

  it("filters every delegation key on defaults, edits and save", () => {
    const settings = {
      effort: "high",
      ...Object.fromEntries(MODEL_ROUTING_DELEGATION_KEYS.map((key) => [key, "value"])),
    };
    expect(entrySettings(settings)).toEqual({ effort: "high" });
    const edit = replaceOrderEntry(draft(), { ...entry("a"), modelSettings: settings });
    expect(edit.routing.entries[0]!.modelSettings).toEqual({ effort: "high" });
    edit.routing.entries[0]!.modelSettings = settings;
    expect(prepareOrderSave(edit).routing.entries[0]!.modelSettings).toEqual({ effort: "high" });
  });

  it("removes a main entry from every pool without mutating original", () => {
    const edit = draft();
    edit.routing.pools.push({ id: "second", name: "Second", entryIds: ["a", "b"] });
    const removed = removeOrderEntry(edit, "a");
    expect(removed.routing.entries.map((row) => row.id)).toEqual(["b"]);
    expect(removed.routing.pools.map((pool) => pool.entryIds)).toEqual([["b"], ["b"]]);
    expect(removed.percentages).not.toHaveProperty("a");
    expect(edit.routing.entries).toHaveLength(2);
  });

  it("blocks emptying any pool, including through main-order removal", () => {
    const edit = setPoolEntries(draft(), "p", ["a"]);
    expect(() => removeOrderEntry(edit, "a")).toThrow("last model in a pool");
    expect(() => setPoolEntries(edit, "p", [])).toThrow("at least one model");
    expect(edit.routing.pools[0]!.entryIds).toEqual(["a"]);
  });

  it("blocks deleting role-bound pools and permits unused pools", () => {
    const edit = draft();
    expect(removeOrderPool(edit, "p").routing.pools).toEqual([]);
    edit.routing.roles["voice.reply"] = { kind: "pool", poolId: "p" };
    expect(() => removeOrderPool(edit, "p")).toThrow("A role uses this pool");
  });

  it("pool priority is independent from main order", () => {
    const changed = setPoolEntries(draft(), "p", ["a", "b"]);
    expect(changed.routing.pools[0]!.entryIds).toEqual(["a", "b"]);
    expect(changed.routing.entries.map((row) => row.id)).toEqual(["a", "b"]);
  });

  it.each(["", "-1", "101", "1.5", "NaN", "Infinity"])(
    "rejects invalid percentage %s without clamping",
    (value) => {
      const edit = draft();
      edit.percentages.a = value;
      expect(() => prepareOrderSave(edit)).toThrow("whole percentage");
      expect(edit.percentages.a).toBe(value);
    },
  );

  it("validates run, daily and concurrency limits", () => {
    const edit = draft();
    edit.maxRunMinutes = "10081";
    expect(() => prepareOrderSave(edit)).toThrow("Run time");
    edit.maxRunMinutes = "60";
    expect(prepareOrderSave(edit).routing.defaultMaxRunMinutes).toBe(60);
    edit.limits.dailyAgentMinutes = "1.5";
    expect(() => prepareOrderSave(edit)).toThrow("Daily agent time");
    edit.limits.dailyAgentMinutes = "0";
    edit.limits.maxRunningTasks = "9";
    expect(() => prepareOrderSave(edit)).toThrow("Concurrent tasks");
  });

  it.each([1080, 2880, 750, 0])("retains custom daily work budgets of %i minutes", (minutes) => {
    const edit = draft();
    edit.limits.dailyAgentMinutes = String(minutes);
    expect(prepareOrderSave(edit).limits.dailyAgentMinutes).toBe(minutes);
  });

  it("rejects duplicate IDs, missing references, blank names and invalid account providers", () => {
    const edit = draft();
    edit.routing.entries.push(entry("a"));
    expect(() => prepareOrderSave(edit)).toThrow("IDs must be unique");
    edit.routing.entries.pop();
    edit.routing.pools[0]!.entryIds = ["missing"];
    expect(() => prepareOrderSave(edit)).toThrow("unique models");
    edit.routing.pools[0]!.entryIds = ["a", "a"];
    expect(() => prepareOrderSave(edit)).toThrow("unique models");
    edit.routing.pools[0]!.entryIds = ["a"];
    edit.routing.pools[0]!.name = " ";
    expect(() => prepareOrderSave(edit)).toThrow("Give every pool a name");
    edit.routing.pools[0]!.name = "Work";
    edit.routing.roles["task.worker"] = { kind: "pool", poolId: "missing" };
    expect(() => prepareOrderSave(edit)).toThrow("no longer exists");
    edit.routing.roles = {};
    edit.routing.entries[0]!.harness = "grok";
    edit.routing.entries[0]!.providerAccountId = "default";
    expect(() => prepareOrderSave(edit)).toThrow("Only Claude and Codex");
  });

  it("empty main order is valid and one shared draft includes numeric text edits", () => {
    const edit = orderDraft(
      { ...structuredClone(EMPTY_MODEL_ROUTING), version: 0, updatedAt: 0 },
      { maxRunningTasks: 2, dailyAgentMinutes: 0 },
    );
    expect(prepareOrderSave(edit).routing.entries).toEqual([]);
    expect(sameOrderDraft(edit, structuredClone(edit))).toBe(true);
    const changed = structuredClone(edit);
    changed.maxRunMinutes = "30";
    expect(sameOrderDraft(edit, changed)).toBe(false);
  });
});
