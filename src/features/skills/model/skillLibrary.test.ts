import { describe, expect, it } from "vitest";
import type { DiscoveredSkill } from "../../../platform/tauri/fs";
import {
  copyOn,
  filterSkillEntries,
  installedNames,
  mergeSkillLibrary,
  skillPresence,
  type MachineSkillList,
} from "./skillLibrary";

const skill = (
  name: string,
  path: string,
  extra: Partial<DiscoveredSkill> = {},
): DiscoveredSkill => ({
  name,
  description: `${name} help`,
  path,
  scope: "user",
  source: "agents",
  ...extra,
});
const tailm = { environmentId: "env-tailm", name: "tailm", cwd: "" };
const lists: MachineSkillList[] = [
  {
    machine: null,
    skills: [skill("brandkit", "C:/a/brandkit/SKILL.md"), skill("Guide", "C:/a/guide/SKILL.md")],
  },
  {
    machine: tailm,
    skills: [
      skill("guide", "/home/u/.agents/skills/guide/SKILL.md"),
      skill("arc", "/home/u/.agents/skills/arc/SKILL.md"),
      skill("guide", "/home/u/.claude/skills/guide/SKILL.md", {
        source: "claude",
      }),
    ],
  },
];

describe("skill library", () => {
  it("merges the same skill across machines and prefers this computer's copy", () => {
    const entries = mergeSkillLibrary(lists);
    expect(entries.map((entry) => entry.name)).toEqual(["brandkit", "Guide", "arc", "guide"]);
    const guide = entries[1];
    expect(guide.copies.map((copy) => copy.machine?.name ?? "local")).toEqual(["local", "tailm"]);
    expect(guide.primary.machine).toBeNull();
    expect(entries[2].primary.machine).toBe(tailm);
  });

  it("reports presence per machine by name and unknown while a list is unavailable", () => {
    expect(skillPresence("BRANDKIT", lists)).toEqual(["present", "missing"]);
    expect(skillPresence("arc", [lists[0], { machine: tailm, skills: null }])).toEqual([
      "missing",
      "unknown",
    ]);
  });

  it("finds the matching copy on a machine, preferring the same source", () => {
    const claude = skill("guide", "x", { source: "claude" });
    expect(copyOn(lists[1], claude)?.path).toBe("/home/u/.claude/skills/guide/SKILL.md");
    expect(copyOn(lists[1], skill("guide", "x", { source: "codex" }))?.path).toBe(
      "/home/u/.agents/skills/guide/SKILL.md",
    );
    expect(copyOn(lists[0], skill("arc", "x"))).toBeNull();
  });

  it("indexes installed names by machine and skips lists that did not load", () => {
    const names = installedNames([lists[0], { machine: tailm, skills: null }]);
    expect([...names.keys()]).toEqual(["local"]);
    expect(names.get("local")?.has("guide")).toBe(true);
  });

  it("filters by text, preference and missing machines", () => {
    const entries = mergeSkillLibrary(lists);
    const offPaths = new Set(["C:/a/brandkit/SKILL.md"]);
    const isOff = ({ skill }: { skill: DiscoveredSkill }) => offPaths.has(skill.path);
    const names = (filter: Parameters<typeof filterSkillEntries>[2], query = "") =>
      filterSkillEntries(entries, query, filter, isOff, lists).map((entry) => entry.key);
    expect(names("off")).toEqual([entries[0].key]);
    expect(names("enabled")).not.toContain(entries[0].key);
    expect(names("missing")).toEqual([entries[0].key, entries[2].key]);
    expect(names("all", ".claude")).toEqual([entries[3].key]);
  });
});
