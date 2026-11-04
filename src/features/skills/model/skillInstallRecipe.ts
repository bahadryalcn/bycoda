import type { RecommendedSkill } from "./recommendedSkills";

export const SKILLS_CLI_PACKAGE = "skills@1.7.6";
export const SKILLS_CLI_REFERENCE = "https://github.com/vercel-labs/skills/tree/v1.7.6";
export const SKILLS_CLI_REQUIREMENTS =
  "Requires Node.js 22.20 or newer, npm and Git on the selected computer.";
type Source = Pick<RecommendedSkill, "repository" | "skillPath" | "name" | "ref">;

/** One public installer recipe shared by the visible command and Host execution. */
export function officialSkillInstallArgs(skill: Source, revision: string = skill.ref): string[] {
  if (
    !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(skill.repository) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name) ||
    !/^[A-Za-z0-9_./-]+$/.test(skill.skillPath) ||
    skill.skillPath.split("/").some((part) => !part || part === "." || part === "..") ||
    !/^(?:main|[a-f0-9]{40})$/.test(revision)
  ) {
    throw new Error("Invalid public skill installation source.");
  }
  return [
    "add",
    `${skill.repository}/tree/${revision}/${skill.skillPath}`,
    "--skill",
    skill.name,
    "--agent",
    "codex",
    "--yes",
    "--copy",
    "--json",
  ];
}

export function officialSkillNpmArgs(skill: Source, revision: string = skill.ref): string[] {
  return [
    "exec",
    "--yes",
    "--ignore-scripts",
    "--registry=https://registry.npmjs.org",
    `--package=${SKILLS_CLI_PACKAGE}`,
    "--",
    "skills",
    ...officialSkillInstallArgs(skill, revision),
  ];
}

export function officialSkillInstallCommand(skill: Source): string {
  return ["npm", ...officialSkillNpmArgs(skill)].join(" ");
}
