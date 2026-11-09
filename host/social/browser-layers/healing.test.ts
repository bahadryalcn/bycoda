import { describe, expect, it } from "vitest";
import { getRecipeOverride, RecipeHealing } from "./healing";
import { memorySettings } from "./test-support";

const suggestion = {
  accountId: "acc",
  platform: "x" as const,
  step: "send",
  selector: "html > body:nth-child(2) > button:nth-child(1)",
  source: "decision" as const,
};

describe("RecipeHealing", () => {
  it("stores a pending suggestion that no recipe reads until the owner approves it", async () => {
    const store = memorySettings();
    const healing = new RecipeHealing(
      store,
      () => 1000,
      () => "s1",
    );
    const created = await healing.suggest(suggestion);
    expect(created).toEqual(expect.objectContaining({ id: "s1", status: "pending" }));
    expect(await getRecipeOverride(store, "x", "send")).toBeUndefined();
  });

  it("does not duplicate an identical pending suggestion", async () => {
    let next = 0;
    const healing = new RecipeHealing(
      memorySettings(),
      () => 1,
      () => `s${++next}`,
    );
    const first = await healing.suggest(suggestion);
    const second = await healing.suggest(suggestion);
    expect(second?.id).toBe(first?.id);
    expect(await healing.list()).toHaveLength(1);
  });

  it("refuses a non-owner approval and leaves the override unset", async () => {
    const store = memorySettings();
    const healing = new RecipeHealing(
      store,
      () => 1,
      () => "s1",
    );
    await healing.suggest(suggestion);
    await expect(healing.approve("s1", { owner: false })).rejects.toThrow("Only the owner");
    expect(await getRecipeOverride(store, "x", "send")).toBeUndefined();
  });

  it("applies the selector as an override only after the owner approves, and a rejected suggestion never does", async () => {
    const store = memorySettings();
    let next = 0;
    const healing = new RecipeHealing(
      store,
      () => 1,
      () => `s${++next}`,
    );
    await healing.suggest(suggestion);
    const approved = await healing.approve("s1", { owner: true });
    expect(approved.status).toBe("approved");
    expect(await getRecipeOverride(store, "x", "send")).toBe(suggestion.selector);

    await healing.suggest({ ...suggestion, step: "reply", selector: "html > body:nth-child(3)" });
    await healing.reject("s2", { owner: true });
    expect(await getRecipeOverride(store, "x", "reply")).toBeUndefined();
  });

  it("rejects unsafe selectors and step names before storing anything", async () => {
    const healing = new RecipeHealing(
      memorySettings(),
      () => 1,
      () => "s1",
    );
    expect(
      await healing.suggest({ ...suggestion, selector: "javascript:alert(1)" }),
    ).toBeUndefined();
    expect(await healing.suggest({ ...suggestion, step: "../etc" })).toBeUndefined();
    expect(await healing.list()).toHaveLength(0);
  });

  it("ignores a corrupt override row", async () => {
    const store = memorySettings();
    store.rows.set("browser-layers.override.x.send", "{not json");
    expect(await getRecipeOverride(store, "x", "send")).toBeUndefined();
  });
});
