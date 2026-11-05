import { afterEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listHostSkillCandidates, listHostSkillCandidatesAsync } from "./skills";

const hook = vi.hoisted(() => ({ beforeRead: undefined as undefined | ((path: unknown) => void) }));
vi.mock("node:fs/promises", async (load) => {
  const actual = await load<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: async (path: unknown, ...args: unknown[]) => {
      hook.beforeRead?.(path);
      return (actual.readFile as unknown as (...args: unknown[]) => unknown)(path, ...args);
    },
  };
});
const roots: string[] = [];
afterEach(() => {
  hook.beforeRead = undefined;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bycoda-async-skills-"));
  roots.push(root);
  const home = join(root, "home"),
    cwd = join(root, "project");
  for (const base of [home, cwd]) {
    const folder = join(base, ".agents/skills/audit-example");
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "SKILL.md"),
      "---\nname: audit-example\ndescription: isolated fixture\n---\nFixture body",
    );
  }
  const registry = join(home, ".claude/plugins/installed_plugins.json");
  mkdirSync(join(home, ".claude/plugins"), { recursive: true });
  writeFileSync(registry, '{"plugins":{}}');
  return { home, cwd, registry };
}
it("preserves ordered active/shadowed copies while yielding to other Host work", async () => {
  const { home, cwd } = fixture();
  const pending = listHostSkillCandidatesAsync(cwd, home);
  let settled = false;
  void pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(await pending).toEqual(listHostSkillCandidates(cwd, home));
});
it("refuses metadata that changed while asynchronous discovery was pending", async () => {
  const { home, cwd, registry } = fixture();
  hook.beforeRead = (path) => {
    if (path !== registry) return;
    const folder = join(cwd, ".agents/skills/new-example");
    mkdirSync(folder);
    writeFileSync(join(folder, "SKILL.md"), "new skill");
    const future = new Date("2030-01-01T00:00:00Z");
    utimesSync(join(cwd, ".agents/skills"), future, future);
  };
  await expect(listHostSkillCandidatesAsync(cwd, home)).rejects.toThrow("changed during discovery");
});
