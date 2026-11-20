import { afterEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listHostSkills, listHostSkillsAsync } from "./skills";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scratch(label: string) {
  const dir = mkdtempSync(join(tmpdir(), `bycoda-skills-list-${label}-`));
  roots.push(dir);
  return dir;
}

function skill(root: string, folder: string, extra = "") {
  mkdirSync(join(root, folder), { recursive: true });
  writeFileSync(join(root, folder, "SKILL.md"), `---\nname: ${folder}\n---\n# ${folder}`);
  if (extra) writeFileSync(join(root, folder, ".bycoda-install.json"), extra);
}

const many = (root: string, count: number) => {
  for (let index = 0; index < count; index++) skill(root, `bulk-${String(index).padStart(4, "0")}`);
};

it("returns exactly the cap without claiming truncation when nothing was hidden", async () => {
  const project = scratch("exact-project");
  const home = scratch("exact-home");
  many(join(project, ".agents/skills"), 300);
  // A same-name copy further down the order is shadowed, not hidden by the cap.
  skill(join(home, ".agents/skills"), "bulk-0000");
  const listing = await listHostSkillsAsync(project, home);
  expect(listing.skills).toHaveLength(300);
  expect(listing.truncated).toBe(false);
});

it("reports truncation when a further distinct name was cut off, keeping earlier roots", async () => {
  const project = scratch("cut-project");
  const home = scratch("cut-home");
  many(join(project, ".agents/skills"), 300);
  skill(join(home, ".agents/skills"), "zz-personal-late");
  const listing = await listHostSkillsAsync(project, home);
  expect(listing.truncated).toBe(true);
  expect(listing.skills).toHaveLength(300);
  expect(listing.skills.every((entry) => entry.scope === "project")).toBe(true);
  expect(listing.skills.some((entry) => entry.name === "zz-personal-late")).toBe(false);
});

it("keeps the synchronous listing's precedence, provider and disabled-path rules", async () => {
  const project = scratch("rules-project");
  const home = scratch("rules-home");
  skill(join(project, ".agents/skills"), "review");
  skill(join(home, ".agents/skills"), "review");
  skill(join(home, ".agents/skills"), "only-codex", '{"schemaVersion":1,"provider":"codex"}');
  skill(join(home, ".agents/skills"), "everywhere", '{"schemaVersion":1,"provider":"all"}');
  const projectReview = join(project, ".agents/skills/review/SKILL.md");
  for (const [disabled, provider] of [
    [[], undefined],
    [[projectReview], undefined],
    [[], "claude"],
    [[], "codex"],
  ] as const) {
    const sync = listHostSkills(project, home, [...disabled], provider);
    const { skills, truncated } = await listHostSkillsAsync(project, home, [...disabled], provider);
    expect(skills).toEqual(sync);
    expect(truncated).toBe(false);
  }
  const fallback = await listHostSkillsAsync(project, home, [projectReview]);
  expect(fallback.skills.find((entry) => entry.name === "review")?.scope).toBe("user");
});
