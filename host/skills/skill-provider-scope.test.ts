import { afterEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listHostSkillCandidates, listHostSkills } from "./skills";
import { readHarnessSkill, searchHarnessSkills } from "./harness-skills";
import { prepareHostSkillPrompt } from "./prompt-skills";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bycoda-skill-provider-"));
  roots.push(root);
  const home = join(root, "home");
  const cwd = join(root, "project");
  mkdirSync(home);
  mkdirSync(cwd);
  function skill(base: string, name: string, provider?: string, body = name) {
    const dir = join(base, ".agents/skills", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: test\n---\n${body}`);
    if (provider)
      writeFileSync(
        join(dir, ".bycoda-install.json"),
        JSON.stringify({ schemaVersion: 1, provider }),
      );
    return dir;
  }
  return { cwd, home, skill };
}

it("filters installed targets before name precedence and retains legacy/shared skills", async () => {
  const { cwd, home, skill } = fixture();
  skill(cwd, "review", "codex", "CODEX COPY");
  const fallback = skill(home, "review", undefined, "LEGACY COPY");
  skill(cwd, "shared", "all");
  skill(cwd, "legacy");
  expect(listHostSkills(cwd, home, [], "claude").map((entry) => entry.name)).toEqual([
    "legacy",
    "review",
    "shared",
  ]);
  expect(
    listHostSkills(cwd, home, [], "claude").find((entry) => entry.name === "review")?.path,
  ).toBe(join(fallback, "SKILL.md").replace(/\\/g, "/"));
  const codex = listHostSkillCandidates(cwd, home, "codex").skills.filter(
    (entry) => entry.name === "review",
  );
  expect(codex.map((entry) => entry.active)).toEqual([true, false]);
  expect(codex[0].installProvider).toBe("codex");
  expect(
    listHostSkillCandidates(cwd, home, "claude")
      .skills.filter((entry) => entry.name === "review")
      .map((entry) => entry.active),
  ).toEqual([true]);
  expect(
    listHostSkillCandidates(cwd, home).skills.filter((entry) => entry.name === "review"),
  ).toHaveLength(2);
});

it("keeps provider-targeted bodies out of search, exact reads and prompt expansion", async () => {
  const { cwd, home, skill } = fixture();
  skill(cwd, "targeted", "codex", "PRIVATE PROVIDER BODY");
  expect((await searchHarnessSkills(cwd, {}, home, undefined, [], "claude")).skills).toEqual([]);
  await expect(
    readHarnessSkill(cwd, { name: "targeted", source: "agents" }, home, undefined, [], "claude"),
  ).rejects.toThrow("not installed");
  await expect(
    prepareHostSkillPrompt("$targeted check", cwd, home, undefined, "claude"),
  ).rejects.toThrow('not installed for provider "claude"');
  await expect(
    prepareHostSkillPrompt("$targeted check", cwd, home, undefined, "codex"),
  ).resolves.toContain("PRIVATE PROVIDER BODY");
});

it("expands eligible same-name fallback and preserves disabled-name gates", async () => {
  const { cwd, home, skill } = fixture();
  skill(cwd, "review", "codex", "CODEX COPY");
  skill(home, "review", "all", "SHARED COPY");
  const prompt = await prepareHostSkillPrompt("$review check", cwd, home, undefined, "claude");
  expect(prompt).toContain("SHARED COPY");
  expect(prompt).not.toContain("CODEX COPY");
  mkdirSync(join(home, ".bycoda-host"));
  writeFileSync(
    join(home, ".bycoda-host/skill-policy.json"),
    JSON.stringify({ disabledNames: ["review"], disabledPaths: [] }),
  );
  expect((await searchHarnessSkills(cwd, {}, home, undefined, [], "codex")).skills).toEqual([]);
  await expect(
    prepareHostSkillPrompt("$review check", cwd, home, undefined, "codex"),
  ).rejects.toThrow("disabled");
});

it("fails closed when installation target metadata is damaged", async () => {
  const { cwd, home, skill } = fixture();
  const dir = skill(cwd, "damaged", "codex");
  for (const marker of ["broken", '{"schemaVersion":1}', '{"schemaVersion":2,"provider":"all"}']) {
    writeFileSync(join(dir, ".bycoda-install.json"), marker);
    expect(listHostSkills(cwd, home, [], "claude")).toEqual([]);
    expect(listHostSkills(cwd, home)).toEqual([]);
  }
});

it("discovers project-specific Antigravity installs without exposing them to other providers", async () => {
  const { cwd, home } = fixture();
  const dir = join(cwd, ".gemini/antigravity/skills/targeted");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "Project Antigravity skill");
  writeFileSync(
    join(dir, ".bycoda-install.json"),
    JSON.stringify({ schemaVersion: 1, provider: "antigravity" }),
  );
  expect(listHostSkills(cwd, home, [], "antigravity")).toMatchObject([
    { name: "targeted", scope: "project", source: "antigravity" },
  ]);
  expect(listHostSkills(cwd, home, [], "codex")).toEqual([]);
});
