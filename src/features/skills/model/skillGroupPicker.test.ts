// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), policy: vi.fn() }));
vi.mock("./skills", () => ({
  loadSkills: mocks.load,
  slugSkillName: (name: string) => name.toLowerCase(),
}));
vi.mock("./skillPreferences", () => ({ loadSkillRestrictions: mocks.policy }));
import { createSkillGroup } from "./skillGroups";
import { skillGroupInsertion, skillGroupPickerItems } from "./skillGroupPicker";
import type { Skill } from "./skills";
it("inserts normal tokens while skipping missing, disabled and hidden skills", async () => {
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
  expect(
    skillGroupPickerItems([group], skills, { disabledNames: ["b"], disabledPaths: [] })[0]
      .description,
  ).toBe("1 skills");
  expect(await skillGroupInsertion(group.id, { harness: "codex", cwd: "" }, "$")).toBe("$a");
  expect(mocks.policy).toHaveBeenCalledWith("", { refresh: true });
  mocks.policy.mockRejectedValue(new Error("policy unavailable"));
  await expect(skillGroupInsertion(group.id, { harness: "codex", cwd: "" })).rejects.toThrow(
    "policy unavailable",
  );
});
