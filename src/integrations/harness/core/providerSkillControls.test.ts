import { expect, it } from "vitest";
import { buildClaudeSpawnArgs } from "../providers/claude/claudeProtocol";
import {
  buildOpenCodePermissionRules,
  toOpenCodeV2PermissionRules,
} from "../providers/opencode/opencodeProtocol";
import { buildPiSpawnArgs } from "../providers/pi/piProtocol";
import { PI_FLAVOR, OMP_FLAVOR } from "../providers/pi/piFlavor";

it("hides Claude skills and denies Skill calls without changing enabled skills or unrelated settings", () => {
  const args = buildClaudeSpawnArgs({
    disabledSkills: ["good-css", "kit:review"],
    settings: { disableAllHooks: true },
  });
  expect(
    args.slice(args.indexOf("--disallowedTools") + 1, args.indexOf("--disallowedTools") + 3),
  ).toEqual(["Skill(good-css)", "Skill(kit:review)"]);
  const settings = JSON.parse(args[args.indexOf("--settings") + 1]);
  expect(settings).toMatchObject({
    disableAllHooks: true,
    skillOverrides: { "good-css": "off", "kit:review": "off" },
  });
  expect(buildClaudeSpawnArgs({})).not.toContain("--disallowedTools");
});

it.each(["supervised", "auto-accept-edits", "auto", "full-access"] as const)(
  "denies disabled OpenCode skills in %s and both protocol generations",
  (mode) => {
    const rules = buildOpenCodePermissionRules(mode, ["good-css"]);
    expect(rules[rules.length - 1]).toEqual({
      permission: "skill",
      pattern: "good-css",
      action: "deny",
    });
    expect(toOpenCodeV2PermissionRules(rules)).toContainEqual({
      action: "skill",
      resource: "good-css",
      effect: "deny",
    });
  },
);

it.each([PI_FLAVOR, OMP_FLAVOR])(
  "uses only enabled native skill paths for $label, preserving extensions",
  (flavor) => {
    const args = buildPiSpawnArgs(flavor, {
      skillPaths: ["/package/review/SKILL.md"],
      resume: "session",
    });
    expect(args).toContain("--no-skills");
    expect(args).toContain("--skill");
    expect(args).toContain("/package/review/SKILL.md");
    expect(args).toContain(flavor.resumeFlag);
    expect(args).not.toContain("--no-extensions");
    expect(buildPiSpawnArgs(flavor, { skillPaths: [] })).toContain("--no-skills");
  },
);
