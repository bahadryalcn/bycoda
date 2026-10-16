import { afterEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listHostClaudeCommands } from "./claude-commands";
import { prepareHostSkillPrompt } from "./prompt-skills";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bycoda-composer-"));
  roots.push(root);
  const project = join(root, "project");
  const home = join(root, "home");
  mkdirSync(project);
  mkdirSync(home);
  return { project, home };
}
function write(path: string, body: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
}
it("discovers nested commands with project precedence and bounded metadata", async () => {
  const { project, home } = fixture();
  write(
    join(project, ".claude/commands/review.md"),
    "---\ndescription: Project review\nargument-hint: '[file]'\n---\nBody",
  );
  write(join(home, ".claude/commands/review.md"), "Personal review");
  write(join(home, ".claude/commands/gsd/plan.md"), "# Title\nPlan work");
  write(join(project, ".claude/commands/.hidden.md"), "Hidden");
  expect(await listHostClaudeCommands(project, home)).toEqual([
    {
      name: "gsd:plan",
      description: "Plan work",
      argumentHint: "",
      scope: "user",
    },
    {
      name: "review",
      description: "Project review",
      argumentHint: "[file]",
      scope: "project",
    },
  ]);
});
it("loads selected host skill bodies afresh with host paths and ignores quoted skill tokens", async () => {
  const { project, home } = fixture();
  const path = join(project, ".agents/skills/review/SKILL.md");
  write(path, "First instructions");
  const first = await prepareHostSkillPrompt("$review inspect", project, home);
  expect(first).toContain(`Skill file: ${path.replace(/\\/g, "/")}`);
  expect(first).toContain("First instructions");
  write(path, "Updated instructions");
  expect(await prepareHostSkillPrompt("/review inspect", project, home)).toContain(
    "Updated instructions",
  );
  expect(await prepareHostSkillPrompt("> $review inspect", project, home)).toBe(
    "> $review inspect",
  );
  expect(await prepareHostSkillPrompt("ordinary message", project, home)).toBe("ordinary message");
});
