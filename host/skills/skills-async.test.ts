import { afterEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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
function changeInventory(cwd: string, name: string) {
  const folder = join(cwd, ".agents/skills", name);
  mkdirSync(folder);
  writeFileSync(join(folder, "SKILL.md"), "new skill");
  const future = new Date(
    Date.now() + 86_400_000 * (1 + readdirSync(join(cwd, ".agents/skills")).length),
  );
  utimesSync(join(cwd, ".agents/skills"), future, future);
}
it("retries discovery when the inventory changes once, so parallel child starts succeed", async () => {
  const { home, cwd, registry } = fixture();
  let changed = false;
  hook.beforeRead = (path) => {
    if (path !== registry || changed) return;
    changed = true;
    changeInventory(cwd, "new-example");
  };
  const found = await listHostSkillCandidatesAsync(cwd, home);
  expect(found.skills.map((skill) => skill.name)).toContain("new-example");
});
it("refuses metadata that keeps changing while asynchronous discovery is pending", async () => {
  const { home, cwd, registry } = fixture();
  let count = 0;
  hook.beforeRead = (path) => {
    if (path === registry) changeInventory(cwd, `new-example-${count++}`);
  };
  await expect(listHostSkillCandidatesAsync(cwd, home)).rejects.toThrow("changed during discovery");
  expect(count).toBe(3);
});
