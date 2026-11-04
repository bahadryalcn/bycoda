import { expect, it } from "vitest";
import { RECOMMENDED_SKILLS } from "./recommendedSkills";
import {
  officialSkillInstallArgs,
  officialSkillNpmArgs,
  officialSkillInstallCommand,
  SKILLS_CLI_PACKAGE,
} from "./skillInstallRecipe";

it("catalog contains public publisher references and reproducible install recipes", () => {
  expect(RECOMMENDED_SKILLS.some((skill) => skill.name === "gbmb-game-factory")).toBe(false);
  for (const skill of RECOMMENDED_SKILLS) {
    const args = officialSkillNpmArgs(skill);
    expect(args).toContain(`--package=${SKILLS_CLI_PACKAGE}`);
    expect(args).toContain("--ignore-scripts");
    expect(args).toContain("--registry=https://registry.npmjs.org");
    expect(args).not.toContain("--global");
    expect(args).toContain(skill.sourceUrl);
    expect(officialSkillInstallCommand(skill)).toBe(`npm ${args.join(" ")}`);
    expect(JSON.stringify(skill)).not.toMatch(/[A-Z]:[\\/]|installedPath|gbmb-game-factory/);
  }
});

it("pins exact source revision passed to the upstream installer", () => {
  expect(officialSkillInstallArgs(RECOMMENDED_SKILLS[0]!, "a".repeat(40))[1]).toContain(
    `/tree/${"a".repeat(40)}/`,
  );
  expect(() => officialSkillInstallArgs(RECOMMENDED_SKILLS[0]!, "main; run-other")).toThrow();
  expect(() =>
    officialSkillInstallArgs({ ...RECOMMENDED_SKILLS[0]!, repository: "file:///private" }),
  ).toThrow();
  expect(() =>
    officialSkillInstallArgs({ ...RECOMMENDED_SKILLS[0]!, skillPath: "../private" }),
  ).toThrow();
});
