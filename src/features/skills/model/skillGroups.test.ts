// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import {
  addSkillsToGroup,
  createSkillGroup,
  deleteSkillGroup,
  listSkillGroups,
  moveSkillBetweenGroups,
  parseSkillGroups,
  removeSkillFromGroup,
  renameSkillGroup,
  replaceAllSkillGroups,
  resolveSkillGroup,
  SKILL_GROUPS_KEY,
  subscribeSkillGroups,
} from "./skillGroups";
beforeEach(() => {
  localStorage.clear();
});
it("persists operations, missing names and notifications", () => {
  const changed = vi.fn();
  const off = subscribeSkillGroups(changed);
  const first = createSkillGroup({ name: "Build", skillNames: ["a", "a", "missing"] });
  const second = createSkillGroup({ name: "Review", skillNames: [] });
  addSkillsToGroup(first.id, ["b", "a"]);
  renameSkillGroup(first.id, "Ship");
  moveSkillBetweenGroups(first.id, second.id, "b");
  removeSkillFromGroup(first.id, "a");
  expect(listSkillGroups()[0]).toMatchObject({ name: "Ship", skillNames: ["missing"] });
  expect(resolveSkillGroup(listSkillGroups()[0], [{ name: "a" }])).toEqual({
    skills: [],
    missingNames: ["missing"],
  });
  expect(parseSkillGroups(localStorage.getItem(SKILL_GROUPS_KEY))).toEqual(listSkillGroups());
  deleteSkillGroup(first.id);
  expect(listSkillGroups()).toHaveLength(1);
  replaceAllSkillGroups([{ name: "AI", skillNames: ["a"], source: "ai" }]);
  expect(listSkillGroups()[0].source).toBe("ai");
  expect(changed).toHaveBeenCalledTimes(8);
  off();
});
it("preserves corrupt data instead of silently replacing it", () => {
  for (const raw of ["garbage", "{}", '[{"name":"x"}]']) {
    localStorage.setItem(SKILL_GROUPS_KEY, raw);
    expect(listSkillGroups()).toEqual([]);
    expect(() => createSkillGroup({ name: "x", skillNames: [] })).toThrow();
    expect(() => replaceAllSkillGroups([])).toThrow();
    expect(localStorage.getItem(SKILL_GROUPS_KEY)).toBe(raw);
  }
});
it("retains source on invalid move and reports persistence failures", () => {
  const group = createSkillGroup({ name: "A", skillNames: ["a"] });
  expect(() => moveSkillBetweenGroups(group.id, "missing", "a")).toThrow();
  expect(listSkillGroups()[0].skillNames).toEqual(["a"]);
  const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  expect(() => renameSkillGroup(group.id, "B")).toThrow("quota");
  spy.mockRestore();
  expect(listSkillGroups()[0].name).toBe("A");
});
it("keeps, sets and clears an owner-chosen command", () => {
  const group = createSkillGroup({ name: "UI", skillNames: [], invocation: "ui-kit" });
  renameSkillGroup(group.id, "Interface");
  expect(listSkillGroups()[0]).toMatchObject({ name: "Interface", invocation: "ui-kit" });
  renameSkillGroup(group.id, "Interface", "design");
  expect(listSkillGroups()[0].invocation).toBe("design");
  renameSkillGroup(group.id, "Interface", "");
  expect(listSkillGroups()[0]).not.toHaveProperty("invocation");
  expect(() => renameSkillGroup(group.id, "Interface", "Not Valid")).toThrow();
});

it("applies a bulk membership change in one write, keeping member order", async () => {
  const { setSkillGroupMembers } = await import("./skillGroups");
  const group = createSkillGroup({ name: "Design", skillNames: ["a", "gone", "b"] });
  setSkillGroupMembers(group.id, ["c", "d"], ["a"]);
  expect(listSkillGroups()[0].skillNames).toEqual(["gone", "b", "c", "d"]);
  setSkillGroupMembers(group.id, ["b"], []);
  expect(listSkillGroups()[0].skillNames).toEqual(["gone", "b", "c", "d"]);
  expect(() => setSkillGroupMembers("missing", ["a"], [])).toThrow();
});
