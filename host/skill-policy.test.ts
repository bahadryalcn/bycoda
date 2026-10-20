import { afterEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  migrateSkillPolicy,
  readSkillPolicy,
  saveSkillPolicy,
  setSkillEnabled,
} from "./skill-policy";
import { searchHarnessSkills, readHarnessSkill } from "./harness-skills";
import { prepareHostSkillPrompt } from "./prompt-skills";
import { reportSessionCommands } from "../src/integrations/harness/core/reportedCommands";

const roots: string[] = [];
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  reportSessionCommands("skill-policy-test", []);
});
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "bycoda-skill-policy-"));
  roots.push(home);
  const cwd = join(home, "project");
  mkdirSync(cwd);
  for (const base of [home, cwd]) {
    const dir = join(base, ".agents", "skills", "good-css");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "SKILL.md"),
      "---\nname: good-css\ndescription: CSS guidance\n---\nprivate instructions",
    );
  }
  return { home, cwd };
}

it("migrates legacy preferences once, preserves other restrictions and re-enables without changing providers", () => {
  const { home, cwd } = fixture();
  const path = join(cwd, ".agents/skills/good-css/SKILL.md");
  expect(migrateSkillPolicy([path], home).disabledNames).toEqual(["good-css"]);
  setSkillEnabled("other", false, home);
  setSkillEnabled("good-css", true, home);
  expect(migrateSkillPolicy([path], home)).toEqual({ disabledNames: ["other"], disabledPaths: [] });
});

it("enforces changes immediately across search, exact reads, alternative copies and prompt expansion", async () => {
  const { home, cwd } = fixture();
  expect(searchHarnessSkills(cwd, {}, home).skills).toHaveLength(2);
  setSkillEnabled("good-css", false, home);
  expect(searchHarnessSkills(cwd, {}, home).skills).toEqual([]);
  for (const scope of ["project", "user"])
    await expect(readHarnessSkill(cwd, { name: "good-css", scope }, home)).rejects.toThrow(
      "disabled",
    );
  await expect(prepareHostSkillPrompt("/good-css fix", cwd, home)).rejects.toThrow("disabled");
  setSkillEnabled("good-css", true, home);
  expect((await readHarnessSkill(cwd, { name: "good-css" }, home)).text).toContain(
    "private instructions",
  );
});

it("keeps provider-disabled skills blocked when bycoda allows them", async () => {
  const { home, cwd } = fixture();
  reportSessionCommands("skill-policy-test", [{ kind: "skill", name: "good-css", enabled: false }]);
  expect(searchHarnessSkills(cwd, {}, home, "skill-policy-test").skills).toEqual([]);
  await expect(
    readHarnessSkill(cwd, { name: "good-css" }, home, "skill-policy-test"),
  ).rejects.toThrow("disabled");
});

it("preserves an alternative explicitly enabled by the provider without reading its disabled copy", async () => {
  const { home, cwd } = fixture();
  const projectPath = join(cwd, ".agents/skills/good-css/SKILL.md");
  const userPath = join(home, ".agents/skills/good-css/SKILL.md");
  reportSessionCommands("skill-policy-test", [
    { kind: "skill", name: "good-css", path: projectPath, enabled: false },
    { kind: "skill", name: "good-css", path: userPath, enabled: true },
  ]);
  const found = searchHarnessSkills(cwd, {}, home, "skill-policy-test");
  expect(found.skills).toHaveLength(1);
  expect(found.skills[0].scope).toBe("user");
  expect((await readHarnessSkill(cwd, { name: "good-css" }, home, "skill-policy-test")).scope).toBe(
    "user",
  );
  await expect(
    readHarnessSkill(cwd, { name: "good-css", scope: "project" }, home, "skill-policy-test"),
  ).rejects.toThrow("disabled");
  expect(await prepareHostSkillPrompt("/good-css fix", cwd, home, "skill-policy-test")).toContain(
    userPath.replace(/\\/g, "/"),
  );
});

it("fails closed on corrupt persistent state and rejects tool-pattern injection", () => {
  const { home } = fixture();
  saveSkillPolicy({ disabledNames: [], disabledPaths: [] }, home);
  expect(() => setSkillEnabled("*", false, home)).toThrow();
  writeFileSync(join(home, ".bycoda-host", "skill-policy.json"), "broken");
  expect(() => readSkillPolicy(home)).toThrow("Could not read");
});

it("does not overwrite or remove another process's preference lock", () => {
  const { home } = fixture();
  saveSkillPolicy({ disabledNames: ["keep"], disabledPaths: [] }, home);
  const lock = join(home, ".bycoda-host", "skill-policy.lock");
  writeFileSync(lock, "owned by another process");
  expect(() => setSkillEnabled("other", false, home)).toThrow("in progress");
  expect(readSkillPolicy(home).disabledNames).toEqual(["keep"]);
  expect(() => setSkillEnabled("keep", true, home)).toThrow("in progress");
});

it("requires an owner invocation for manual-only skills and preserves automatic-only skills", async () => {
  const { home, cwd } = fixture();
  for (const [name, flag] of [
    ["manual", "disable-model-invocation: true"],
    ["automatic", "user-invocable: false"],
  ]) {
    const dir = join(cwd, ".agents/skills", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\n${flag}\n---\n${name} instructions`);
  }
  expect(searchHarnessSkills(cwd, { query: "manual" }, home).skills).toEqual([]);
  await expect(readHarnessSkill(cwd, { name: "manual" }, home)).rejects.toThrow("disabled");
  expect(
    (await readHarnessSkill(cwd, { name: "manual" }, home, undefined, ["manual"])).text,
  ).toContain("manual instructions");
  expect((await readHarnessSkill(cwd, { name: "automatic" }, home)).text).toContain(
    "automatic instructions",
  );
  await expect(prepareHostSkillPrompt("/automatic run", cwd, home)).rejects.toThrow(
    "does not allow user invocation",
  );
  expect(await prepareHostSkillPrompt("/manual run", cwd, home)).toContain("manual instructions");
});
