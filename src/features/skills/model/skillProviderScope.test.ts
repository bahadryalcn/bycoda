import { expect, it } from "vitest";
import { withInstalledSkillScope } from "./skillProviderScope";

it("adds ephemeral path/name restrictions without changing owner settings", () => {
  const policy = { disabledNames: ["owner-disabled"], disabledPaths: ["/owner/disabled"] };
  const scoped = withInstalledSkillScope(policy, "claude", [
    { name: "codex-only", path: "/skills/codex-only/SKILL.md", installProvider: "codex" },
    { name: "shared", path: "/skills/shared/SKILL.md", installProvider: "all" },
    { name: "legacy", path: "/skills/legacy/SKILL.md" },
  ]);
  expect(scoped.disabledNames).toEqual(["owner-disabled", "codex-only"]);
  expect(scoped.disabledPaths).toEqual(["/owner/disabled", "/skills/codex-only/SKILL.md"]);
  expect(policy).toEqual({ disabledNames: ["owner-disabled"], disabledPaths: ["/owner/disabled"] });
});

it("disables only wrong-provider path when eligible same-name copy exists", () => {
  const scoped = withInstalledSkillScope({ disabledNames: [], disabledPaths: [] }, "claude", [
    { name: "review", path: "/project/.agents/skills/review/SKILL.md", installProvider: "codex" },
    { name: "review", path: "/home/.claude/skills/review/SKILL.md", installProvider: "claude" },
  ]);
  expect(scoped.disabledNames).toEqual([]);
  expect(scoped.disabledPaths).toEqual(["/project/.agents/skills/review/SKILL.md"]);
});
