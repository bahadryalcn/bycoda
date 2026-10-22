import { afterEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readHarnessSkill, searchHarnessSkills } from "./harness-skills";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bycoda-harness-skills-"));
  roots.push(root);
  const cwd = join(root, "project");
  const home = join(root, "home");
  mkdirSync(cwd);
  mkdirSync(home);
  const skill = (name: string, body: string, base = cwd) => {
    const dir = join(base, ".agents/skills", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), body);
  };
  return { cwd, home, skill };
}

it("finds alternatives by description, ranks exact names and paginates without loading bodies", () => {
  const { cwd, home, skill } = fixture();
  skill("good-css", "---\ndescription: CSS layout techniques\n---\nprivate body");
  skill("layout", "---\ndescription: Layout design\n---\nbody");
  skill("responsive", "---\ndescription: Responsive layout\n---\nbody", home);
  const result = searchHarnessSkills(cwd, { query: "layout", limit: 2 }, home);
  expect(result.skills.map((entry) => entry.name)).toEqual(["layout", "good-css"]);
  expect(JSON.stringify(result)).not.toContain("private body");
  expect(result.total).toBe(3);
  expect(result.nextOffset).toBe(2);
  const next = searchHarnessSkills(cwd, { query: "layout", offset: 2, limit: 2 }, home);
  expect(next.skills.map((entry) => entry.name)).toEqual(["responsive"]);
  expect(next.nextOffset).toBeNull();
  expect(searchHarnessSkills(cwd, { query: "missing" }, home).skills).toEqual([]);
});

it("reads fresh project-preferred content by discovered name with explicit truncation", async () => {
  const { cwd, home, skill } = fixture();
  skill("review", "personal", home);
  skill("review", "x".repeat(250) + "final");
  const first = await readHarnessSkill(cwd, { name: "review", maxChars: 200 }, home);
  expect(first.text).toBe("x".repeat(200));
  expect(first.nextOffset).toBe(200);
  const next = await readHarnessSkill(cwd, { name: "review", offset: 200 }, home);
  expect(next.text).toBe("x".repeat(50) + "final");
  expect(next.nextOffset).toBeNull();
  skill("review", "updated");
  expect((await readHarnessSkill(cwd, { name: "review" }, home)).text).toBe("updated");
  await expect(readHarnessSkill(cwd, { name: "../../outside" }, home)).rejects.toThrow(
    "not installed",
  );
  skill("huge", "x".repeat(2 * 1024 * 1024 + 1));
  await expect(readHarnessSkill(cwd, { name: "huge" }, home)).rejects.toThrow("2 MiB");
});

it("discovers project plugin skills inside nested workspaces and excludes siblings and disabled plugins", () => {
  const { cwd, home } = fixture();
  const plugin = join(home, "plugin");
  mkdirSync(join(plugin, "skills", "review"), { recursive: true });
  writeFileSync(join(plugin, "skills", "review", "SKILL.md"), "Plugin review");
  mkdirSync(join(home, ".claude/plugins"), { recursive: true });
  writeFileSync(
    join(home, ".claude/plugins/installed_plugins.json"),
    JSON.stringify({
      plugins: { "kit@market": [{ installPath: plugin, scope: "project", projectPath: cwd }] },
    }),
  );
  const nested = join(cwd, "packages", "web");
  mkdirSync(nested, { recursive: true });
  expect(searchHarnessSkills(nested, {}, home).skills.map((entry) => entry.name)).toContain(
    "kit:review",
  );
  expect(searchHarnessSkills(cwd + "-sibling", {}, home).skills).toEqual([]);
  mkdirSync(join(cwd, ".claude"), { recursive: true });
  writeFileSync(
    join(cwd, ".claude/settings.json"),
    JSON.stringify({ enabledPlugins: { "kit@market": false } }),
  );
  expect(searchHarnessSkills(cwd, {}, home).skills).toEqual([]);
});

it("ranks by task coverage and exposes same-name alternatives for comparison", async () => {
  const { cwd, home, skill } = fixture();
  skill(
    "good-css",
    "---\ndescription: Use whenever you write CSS, styles, layout, components\n---\nbody",
    home,
  );
  skill(
    "table-overflow",
    "---\ndescription: Fix responsive table overflow on narrow viewports\n---\nbody",
  );
  skill("review", "project review", cwd);
  skill("review", "personal review", home);
  const ranked = searchHarnessSkills(cwd, { query: "responsive table overflow" }, home);
  expect(ranked.skills[0]).toMatchObject({
    name: "table-overflow",
    matchedTerms: 3,
    queryTerms: 3,
  });
  const reviews = searchHarnessSkills(cwd, { query: "review" }, home).skills;
  expect(reviews.map(({ scope, active }) => [scope, active])).toEqual([
    ["project", true],
    ["user", false],
  ]);
  expect((await readHarnessSkill(cwd, { name: "review" }, home)).text).toBe("project review");
  const other = await readHarnessSkill(cwd, { name: "review", scope: "user" }, home);
  expect(other).toMatchObject({ text: "personal review", active: false });
});
