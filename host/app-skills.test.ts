import { afterEach, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP_SKILLS, installAppSkills } from "./app-skills";
import { appSkillsRoot, deleteHostSkill, listHostSkills } from "./skills";
import { readHarnessSkill, searchHarnessSkills } from "./harness-skills";
import { prepareHostSkillPrompt } from "./prompt-skills";
import { saveSkillPolicy } from "./skill-policy";

const homes: string[] = [];
afterEach(() => {
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("installs the bundled guide where every provider can discover but not delete it", () => {
  const home = mkdtempSync(join(tmpdir(), "bycoda-app-skills-"));
  homes.push(home);
  const dir = join(appSkillsRoot(home), "bycoda");
  installAppSkills(home);
  writeFileSync(join(dir, "SKILL.md"), "stale");
  writeFileSync(join(dir, "references", "retired.md"), "old");
  installAppSkills(home);

  expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toBe(APP_SKILLS.bycoda["SKILL.md"]);
  expect(existsSync(join(dir, "references", "retired.md"))).toBe(false);
  for (const [name, files] of Object.entries(APP_SKILLS))
    for (const [path, text] of Object.entries(files))
      expect(readFileSync(join(appSkillsRoot(home), name, path), "utf8")).toBe(text);

  const skill = listHostSkills(null, home).find((item) => item.name === "bycoda");
  expect(skill).toMatchObject({ scope: "user", source: "bycoda" });
  expect(skill?.description).toContain("bycoda");
  expect(() => deleteHostSkill(skill?.path, null, home)).toThrow(/cannot be deleted/);
  for (const query of ["other sessions", "dev server", "diğer oturumlar", "crew"])
    expect(searchHarnessSkills(home, { query }, home).skills[0]?.name).toBe("bycoda");
});

it("makes the bundled router discoverable, readable and explicitly invocable", async () => {
  const home = mkdtempSync(join(tmpdir(), "bycoda-skill-router-"));
  homes.push(home);
  installAppSkills(home);

  const name = "bycoda-skill-router";
  const skill = searchHarnessSkills(home, { query: name }, home).skills[0];
  expect(skill).toMatchObject({ name, source: "bycoda", active: true, enabled: true });
  for (const query of ["uygun skill seç", "choose skills automatically"])
    expect(searchHarnessSkills(home, { query }, home).skills[0]?.name).toBe(name);

  const read = await readHarnessSkill(home, { name, source: skill.source, maxChars: 16000 }, home);
  expect(read.text).toBe(APP_SKILLS[name]["SKILL.md"]);
  expect(read.nextOffset).toBeNull();
  const prompt = await prepareHostSkillPrompt(`$${name} choose skills for this task`, home, home);
  expect(prompt).toContain(read.text.trim());
  expect(prompt).toContain(`Skill file: ${read.path}`);
});

it("honors disabling the router across the bundled and project copies", async () => {
  const home = mkdtempSync(join(tmpdir(), "bycoda-skill-router-policy-"));
  homes.push(home);
  installAppSkills(home);
  const name = "bycoda-skill-router";
  const shadow = join(home, "project", ".agents", "skills", name);
  mkdirSync(shadow, { recursive: true });
  writeFileSync(join(shadow, "SKILL.md"), APP_SKILLS[name]["SKILL.md"]);
  const project = join(home, "project");
  saveSkillPolicy({ disabledNames: [name], disabledPaths: [] }, home);

  const results = searchHarnessSkills(project, { query: name }, home).skills;
  expect(results.some((skill) => skill.name === name)).toBe(false);
  expect(results.some((skill) => skill.name === "bycoda")).toBe(true);
  for (const source of ["bycoda", "agents"])
    await expect(readHarnessSkill(project, { name, source }, home)).rejects.toThrow("disabled");
  await expect(prepareHostSkillPrompt(`$${name} do the task`, project, home)).rejects.toThrow(
    "disabled",
  );
});
