import { afterEach, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP_SKILLS, installAppSkills } from "./app-skills";
import { appSkillsRoot, deleteHostSkill, listHostSkills } from "./skills";
import { searchHarnessSkills } from "./harness-skills";

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
  for (const path of Object.keys(APP_SKILLS.bycoda))
    expect(readFileSync(join(dir, path), "utf8")).toContain("#");

  const skill = listHostSkills(null, home).find((item) => item.name === "bycoda");
  expect(skill).toMatchObject({ scope: "user", source: "bycoda" });
  expect(skill?.description).toContain("bycoda");
  expect(() => deleteHostSkill(skill?.path, null, home)).toThrow(/cannot be deleted/);
  for (const query of ["other sessions", "dev server", "diğer oturumlar", "crew"])
    expect(searchHarnessSkills(home, { query }, home).skills[0]?.name).toBe("bycoda");
});
