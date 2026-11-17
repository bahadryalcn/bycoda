import { describe, expect, it } from "vitest";
import {
  EMPTY_MODEL_ROUTING,
  MODEL_ROUTING_DELEGATION_KEYS,
  type ModelRoutingEntry,
  type ModelRoutingState,
} from "../../../shared/model/host-contracts/model-routing";
import {
  entrySettings,
  findUnavailableOrderEntry,
  groupEntriesByKind,
  orderDraft,
  reorderKind,
  prepareOrderSave,
  removeOrderEntry,
  removeOrderPool,
  replaceOrderEntry,
  sameOrderDraft,
  includablePools,
  setPoolMembers,
  unavailableOrderEntryId,
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
  it("identifies a rejected row using a known Host catalog or the Host error", () => {
    const entries = [entry("available"), { ...entry('invalid"id'), model: "claude:fable" }];
    expect(findUnavailableOrderEntry(entries, { models: {} })).toBeUndefined();
    expect(findUnavailableOrderEntry(entries, { models: { codex: [] } })).toBeUndefined();
    expect(
      findUnavailableOrderEntry(entries, { models: { codex: [{ id: "gpt", name: "GPT" }] } }),
    ).toMatchObject({ id: 'invalid"id' });
    expect(
      unavailableOrderEntryId(
        `Host rejected request: Model "claude:fable" is not available for codex (entry id: "invalid\\"id").`,
      ),
    ).toBe('invalid"id');
    expect(unavailableOrderEntryId('Model "missing" is not available for codex.')).toBeUndefined();
  });
  it("clones state, retains roles and delegation, omits storage metadata", () => {
    const original = state();
    original.roles["task.worker"] = { kind: "pool", poolId: "p" };
    original.delegation.global = { crossAdvisor: "test" };
    const edit = orderDraft(original, {
      maxRunningTasks: 3,
      dailyAgentMinutes: 120,
    });
    edit.routing.entries.reverse();
    const input = prepareOrderSave(edit);
    expect(original.entries.map((row) => row.id)).toEqual(["a", "b"]);
    expect(input.routing.entries.map((row) => row.id)).toEqual(["b", "a"]);
    expect(input.routing.roles).toEqual(original.roles);
    expect(input.routing.delegation).toEqual(original.delegation);
    expect(input.routing).not.toHaveProperty("version");
    expect(input.limits).toEqual({
      maxRunningTasks: 3,
      dailyAgentMinutes: 120,
    });
  });

  it("filters every delegation key on defaults, edits and save", () => {
    const settings = {
      effort: "high",
      ...Object.fromEntries(MODEL_ROUTING_DELEGATION_KEYS.map((key) => [key, "value"])),
    };
    expect(entrySettings(settings)).toEqual({ effort: "high" });
    const edit = replaceOrderEntry(draft(), {
      ...entry("a"),
      modelSettings: settings,
    });
    expect(edit.routing.entries[0]!.modelSettings).toEqual({ effort: "high" });
    edit.routing.entries[0]!.modelSettings = settings;
    expect(prepareOrderSave(edit).routing.entries[0]!.modelSettings).toEqual({
      effort: "high",
    });
  });

  it("removes a main entry from every pool without mutating original", () => {
    const edit = draft();
    edit.routing.pools.push({
      id: "second",
      name: "Second",
      entryIds: ["a", "b"],
    });
    const removed = removeOrderEntry(edit, "a");
    expect(removed.routing.entries.map((row) => row.id)).toEqual(["b"]);
    expect(removed.routing.pools.map((pool) => pool.entryIds)).toEqual([["b"], ["b"]]);
    expect(removed.percentages).not.toHaveProperty("a");
    expect(edit.routing.entries).toHaveLength(2);
  });

  it("blocks emptying any pool, including through main-order removal", () => {
    const edit = setPoolMembers(draft(), "p", { entryIds: ["a"], poolIds: [] });
    expect(() => removeOrderEntry(edit, "a")).toThrow("last model in a group");
    expect(() => setPoolMembers(edit, "p", { entryIds: [], poolIds: [] })).toThrow(
      "at least one model",
    );
    expect(edit.routing.pools[0]!.entryIds).toEqual(["a"]);
  });

  it("blocks deleting role-bound pools and permits unused pools", () => {
    const edit = draft();
    expect(removeOrderPool(edit, "p").routing.pools).toEqual([]);
    edit.routing.roles["voice.reply"] = { kind: "pool", poolId: "p" };
    expect(() => removeOrderPool(edit, "p")).toThrow("A job uses this group");
  });

  it("pool priority is independent from main order", () => {
    const changed = setPoolMembers(draft(), "p", { entryIds: ["a", "b"], poolIds: [] });
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
    for (const count of [9, 99, Number.MAX_SAFE_INTEGER]) {
      edit.limits.maxRunningTasks = String(count);
      expect(prepareOrderSave(edit).limits.maxRunningTasks).toBe(count);
    }
    for (const count of ["0", "-1", "1.5", "", "Infinity", String(Number.MAX_SAFE_INTEGER + 1)]) {
      edit.limits.maxRunningTasks = count;
      expect(() => prepareOrderSave(edit)).toThrow("Concurrent tasks");
    }
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
    expect(() => prepareOrderSave(edit)).toThrow("Give every group a name");
    edit.routing.pools[0]!.name = "Work";
    edit.routing.roles["task.worker"] = { kind: "pool", poolId: "missing" };
    expect(() => prepareOrderSave(edit)).toThrow("no longer exists");
    edit.routing.roles = {};
    edit.routing.entries[0]!.harness = "grok";
    edit.routing.entries[0]!.providerAccountId = "default";
    expect(() => prepareOrderSave(edit)).not.toThrow();
    edit.routing.entries[0]!.harness = "opencode";
    expect(() => prepareOrderSave(edit)).toThrow("no account choice");
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

describe("Work calendar cap drafts", () => {
  it("retains partial values and saves valid total and provider caps", () => {
    const edit = draft();
    edit.workCaps.total.daily.tokens = "123";
    edit.workCaps.total.monthly.costUsd = "2.75";
    edit.workCaps.providers.codex = {
      daily: { tokens: "0", costUsd: "" },
      weekly: { tokens: "5000000", costUsd: "" },
      monthly: { tokens: "", costUsd: "3" },
    };
    edit.workCaps.reserve.codex = "20";
    const caps = prepareOrderSave(edit).routing.workCaps!;
    expect(caps.providers?.codex?.weekly?.tokens).toBe(5_000_000);
    expect(caps.reservePercent).toEqual({ codex: 20 });
    const state = {
      ...edit.routing,
      workCaps: caps,
      version: 1,
      updatedAt: 1,
    };
    const back = orderDraft(state, { maxRunningTasks: 2, dailyAgentMinutes: 0 });
    expect(back.workCaps.providers.codex!.weekly.tokens).toBe("5000000");
    expect(back.workCaps.reserve).toEqual({ codex: "20" });
    edit.workCaps.reserve.codex = "120";
    expect(() => prepareOrderSave(edit)).toThrow("Keep free");
    edit.workCaps.reserve.codex = "";
    expect(prepareOrderSave(edit).routing.workCaps?.reservePercent).toBeUndefined();
    expect(caps.total?.daily?.tokens).toBe(123);
    expect(caps.total?.monthly?.costUsd).toBe(2.75);
    expect(caps.providers?.codex?.daily?.tokens).toBe(0);
    expect(caps.providers?.codex?.monthly?.costUsd).toBe(3);
    edit.workCaps.total.daily.tokens = "1.5";
    expect(() => prepareOrderSave(edit)).toThrow("Token limits");
    expect(edit.workCaps.total.daily.tokens).toBe("1.5");
    edit.workCaps.total.daily.tokens = "";
    edit.workCaps.total.daily.costUsd = "Infinity";
    expect(() => prepareOrderSave(edit)).toThrow("Cost limits");
  });

  describe("nested pools", () => {
    const nested = () => {
      const edit = draft();
      edit.routing.pools.push({
        id: "outer",
        name: "Outer",
        entryIds: [],
        poolIds: ["p"],
      });
      return edit;
    };

    it("sets members and refuses an empty or cyclic pool", () => {
      const edit = nested();
      const next = setPoolMembers(edit, "outer", {
        entryIds: ["a"],
        poolIds: ["p"],
      });
      expect(next.routing.pools[1]).toEqual({
        id: "outer",
        name: "Outer",
        entryIds: ["a"],
        poolIds: ["p"],
      });
      expect(
        setPoolMembers(edit, "outer", { entryIds: ["a"], poolIds: [] }).routing.pools[1],
      ).not.toHaveProperty("poolIds");
      expect(() => setPoolMembers(edit, "outer", { entryIds: [], poolIds: [] })).toThrow(
        "at least one",
      );
      expect(() => setPoolMembers(edit, "p", { entryIds: [], poolIds: ["outer"] })).toThrow("loop");
      expect(() => setPoolMembers(edit, "p", { entryIds: [], poolIds: ["p"] })).toThrow("loop");
    });

    it("lists only pools that cannot form a loop", () => {
      const edit = nested();
      expect(includablePools(edit, "outer").map((pool) => pool.id)).toEqual(["p"]);
      expect(includablePools(edit, "p")).toEqual([]);
    });

    it("validates included pools at save", () => {
      const edit = nested();
      expect(prepareOrderSave(edit).routing.pools[1]!.poolIds).toEqual(["p"]);
      edit.routing.pools[1]!.poolIds = ["missing"];
      expect(() => prepareOrderSave(edit)).toThrow("only groups that exist");
      edit.routing.pools[1]!.poolIds = ["outer"];
      expect(() => prepareOrderSave(edit)).toThrow("only groups that exist");
      edit.routing.pools[1]!.poolIds = ["p", "p"];
      expect(() => prepareOrderSave(edit)).toThrow("only groups that exist");
      edit.routing.pools[1]!.poolIds = ["p"];
      edit.routing.pools[0]!.poolIds = ["outer"];
      expect(() => prepareOrderSave(edit)).toThrow("loop");
    });

    it("blocks removing a pool's last member only when it includes no pools", () => {
      const edit = nested();
      edit.routing.pools[1]!.entryIds = ["a"];
      const removed = removeOrderEntry(edit, "a");
      expect(removed.routing.pools[1]).toMatchObject({
        entryIds: [],
        poolIds: ["p"],
      });
      edit.routing.pools[1]!.poolIds = [];
      expect(() => removeOrderEntry(edit, "a")).toThrow("last model in a group");
    });

    it("blocks deleting a pool another pool includes", () => {
      const edit = nested();
      expect(() => removeOrderPool(edit, "p")).toThrow("Another group includes");
      expect(removeOrderPool(edit, "outer").routing.pools.map((pool) => pool.id)).toEqual(["p"]);
    });
  });

  it("keeps work, personal and shared entries together and reorders one kind in place", () => {
    const base = draft();
    base.routing.entries = ["s1", "w1", "p1", "w2", "s2"].map(entry);
    const kindOf = (item: ModelRoutingEntry) =>
      item.id.startsWith("w") ? "work" : item.id.startsWith("p") ? "personal" : "shared";
    const grouped = groupEntriesByKind(base, kindOf);
    expect(grouped.routing.entries.map((item) => item.id)).toEqual(["w1", "w2", "p1", "s1", "s2"]);
    expect(groupEntriesByKind(grouped, kindOf)).toBe(grouped);
    const moved = reorderKind(grouped, kindOf, "work", ["w2", "w1"]);
    expect(moved.routing.entries.map((item) => item.id)).toEqual(["w2", "w1", "p1", "s1", "s2"]);
  });

  it("saves non-helper order bindings as the default and keeps helper order bindings", () => {
    const edit = draft();
    edit.routing.roles = { "task.worker": { kind: "order" }, "text.git": { kind: "order" } };
    expect(prepareOrderSave(edit).routing.roles).toEqual({ "text.git": { kind: "order" } });
  });
});
