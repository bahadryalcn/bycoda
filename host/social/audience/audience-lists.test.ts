import { describe, expect, it } from "vitest";
import { AI, OWNER, fixture } from "./audience-test-support";
import { deleteList, saveList } from "./audience-lists";
import { deleteRule, saveRule, setRuleEnabled } from "./audience-capture-rules";
import {
  SYSTEM_COMMENTERS_LIST_ID,
  SYSTEM_COMMENTERS_RULE_ID,
} from "../store/social-audience-store";

const ruleInput = (patch: Record<string, unknown> = {}) => ({
  id: "rule-1",
  name: "Commenters of post",
  enabled: false,
  source: { kind: "own_post_comments", accountId: "acc-x" },
  filter: {},
  targetListId: "team",
  ...patch,
});

describe("lists", () => {
  it("refuses a non-owner list change at suggest level", async () => {
    const f = await fixture({ levels: {} });
    await expect(saveList(f.ctx(AI), { name: "Mine", kind: "static" })).rejects.toThrow(
      "Needs owner approval",
    );
    expect((await f.store.listLists()).map((list) => list.id)).toEqual([SYSTEM_COMMENTERS_LIST_ID]);
  });

  it("needs at least one rule for a dynamic list and no filter on a static one", async () => {
    const f = await fixture();
    await expect(
      saveList(f.ctx(OWNER), { name: "Empty", kind: "dynamic", filter: {} }),
    ).rejects.toThrow("at least one filter rule");
    await expect(
      saveList(f.ctx(OWNER), { name: "Static", kind: "static", filter: { tags: ["x"] } }),
    ).rejects.toThrow("no filter");
  });

  it("never deletes or renames the system Commenters list", async () => {
    const f = await fixture();
    await expect(deleteList(f.ctx(OWNER), { id: SYSTEM_COMMENTERS_LIST_ID })).rejects.toThrow(
      "System lists cannot be deleted",
    );
    await expect(
      saveList(f.ctx(OWNER), { id: SYSTEM_COMMENTERS_LIST_ID, name: "Renamed", kind: "static" }),
    ).rejects.toThrow("System lists cannot be changed");
  });
});

describe("capture rules", () => {
  it("turns a rule into a static-list rule and rejects a dynamic target", async () => {
    const f = await fixture();
    await saveList(f.ctx(OWNER), { id: "team", name: "Team", kind: "static" });
    await saveList(f.ctx(OWNER), {
      id: "vip",
      name: "VIP",
      kind: "dynamic",
      filter: { tags: ["vip"] },
    });
    await expect(saveRule(f.ctx(OWNER), ruleInput({ targetListId: "vip" }))).rejects.toThrow(
      "static list",
    );
    const saved = await saveRule(f.ctx(OWNER), ruleInput());
    expect(saved).toMatchObject({ id: "rule-1", enabled: false, targetListId: "team" });
  });

  it("requires a real sequence for an enroll action", async () => {
    const f = await fixture();
    await saveList(f.ctx(OWNER), { id: "team", name: "Team", kind: "static" });
    await expect(
      saveRule(f.ctx(OWNER), ruleInput({ action: { kind: "enroll", sequenceId: "missing" } })),
    ).rejects.toThrow("Sequence not found.");
  });

  it("lets a non-owner switch a rule off, but not on, without autonomy", async () => {
    const f = await fixture({ levels: {} });
    await saveList(f.ctx(OWNER), { id: "team", name: "Team", kind: "static" });
    await saveRule(f.ctx(OWNER), ruleInput({ enabled: true }));
    await expect(setRuleEnabled(f.ctx(AI), { id: "rule-1", enabled: true })).rejects.toThrow(
      "Needs owner approval",
    );
    expect(await setRuleEnabled(f.ctx(AI), { id: "rule-1", enabled: false })).toMatchObject({
      enabled: false,
    });
  });

  it("keeps the system Commenters rule: only on/off, never deleted", async () => {
    const f = await fixture();
    await expect(
      saveRule(f.ctx(OWNER), {
        id: SYSTEM_COMMENTERS_RULE_ID,
        name: "Renamed",
        enabled: true,
        source: { kind: "own_post_comments", accountId: "" },
        filter: {},
        targetListId: SYSTEM_COMMENTERS_LIST_ID,
      }),
    ).rejects.toThrow("only be turned on or off");
    const on = await setRuleEnabled(f.ctx(OWNER), { id: SYSTEM_COMMENTERS_RULE_ID, enabled: true });
    expect(on).toMatchObject({ enabled: true, system: "commenters" });
    await expect(deleteRule(f.ctx(OWNER), { id: SYSTEM_COMMENTERS_RULE_ID })).rejects.toThrow(
      "cannot be deleted",
    );
  });
});
