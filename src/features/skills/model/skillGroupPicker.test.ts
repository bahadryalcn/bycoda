// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), policy: vi.fn() }));
vi.mock("./skills", () => ({
  loadSkills: mocks.load,
  slugSkillName: (name: string) => name.toLowerCase(),
}));
vi.mock("./skillPreferences", () => ({ loadSkillRestrictions: mocks.policy }));
import { createSkillGroup } from "./skillGroups";
import {
  expandSkillGroupTokens,
  skillGroupInsertion,
  skillGroupPickerItems,
} from "./skillGroupPicker";
import type { Skill } from "./skills";
it("inserts one group token while skipping missing, disabled and hidden skills", async () => {
  localStorage.clear();
  const group = createSkillGroup({ name: "Build", skillNames: ["a", "b", "c", "missing"] });
  const skills: Skill[] = ["a", "b", "c"].map((name) => ({
    kind: "file",
    name,
    invocation: name,
    description: "",
    scope: "user",
    source: "agents",
    path: `/skills/${name}/SKILL.md`,
    ...(name === "c" ? { userInvocable: false as const } : {}),
  }));
  mocks.load.mockResolvedValue(skills);
  mocks.policy.mockResolvedValue({ disabledNames: ["b"], disabledPaths: [] });
  const item = skillGroupPickerItems([group], skills, {
    disabledNames: ["b"],
    disabledPaths: [],
  })[0];
  expect(item.description).toBe("a");
  expect(item.memberCount).toBe(1);
  expect(item.members).toEqual(["a"]);
  expect(await skillGroupInsertion(group.id, { harness: "codex", cwd: "" }, "$")).toBe(
    "$group-build",
  );
  expect(mocks.policy).toHaveBeenCalledWith("", { refresh: true });
  mocks.policy.mockRejectedValue(new Error("policy unavailable"));
  await expect(skillGroupInsertion(group.id, { harness: "codex", cwd: "" })).rejects.toThrow(
    "policy unavailable",
  );
});

it("expands group tokens to member invocations at send, keeping the introducer", () => {
  localStorage.clear();
  const group = createSkillGroup({ name: "UI", skillNames: ["a", "b"] });
  const skills: Skill[] = ["a", "b"].map((name) => ({
    kind: "file",
    name,
    invocation: name,
    description: "",
    scope: "user",
    source: "agents",
    path: `/skills/${name}/SKILL.md`,
  }));
  const items = skillGroupPickerItems([group], skills, { disabledNames: [], disabledPaths: [] });
  expect(expandSkillGroupTokens("/group-ui fix it", items)).toBe("/a /b fix it");
  expect(expandSkillGroupTokens("use $group-ui\n/other", items)).toBe("use $a $b\n/other");
  expect(expandSkillGroupTokens("path/group-ui stays", items)).toBe("path/group-ui stays");
});
