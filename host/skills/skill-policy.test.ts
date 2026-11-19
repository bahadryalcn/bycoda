import { afterEach, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import {
  migrateSkillPolicy,
  readSkillPolicy,
  readSkillPolicyAsync,
  saveSkillPolicy,
  setSkillEnabled,
} from "./skill-policy";
import { searchHarnessSkills, readHarnessSkill } from "./harness-skills";
import { prepareHostSkillPrompt } from "./prompt-skills";
import { reportSessionCommands } from "../../src/integrations/harness/core/reportedCommands";

const roots: string[] = [];
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  reportSessionCommands("skill-policy-test", []);
});
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "bycoda-skill-policy-"));
  roots.push(home);
  const cwd = join(home, "project");
  mkdirSync(cwd);
  for (const base of [home, cwd]) {
    const dir = join(base, ".agents", "skills", "good-css");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "SKILL.md"),
      "---\nname: good-css\ndescription: CSS guidance\n---\nprivate instructions",
    );
  }
  return { home, cwd };
}

it("migrates legacy preferences once, preserves other restrictions and re-enables without changing providers", async () => {
  const { home, cwd } = fixture();
  const path = join(cwd, ".agents/skills/good-css/SKILL.md");
  expect((await migrateSkillPolicy([path], home)).disabledNames).toEqual(["good-css"]);
  await setSkillEnabled("other", false, home);
  await setSkillEnabled("good-css", true, home);
  expect(await migrateSkillPolicy([path], home)).toEqual({
    disabledNames: ["other"],
    disabledPaths: [],
  });
});

it("enforces changes immediately across search, exact reads, alternative copies and prompt expansion", async () => {
  const { home, cwd } = fixture();
  expect((await searchHarnessSkills(cwd, {}, home)).skills).toHaveLength(2);
  await setSkillEnabled("good-css", false, home);
  expect((await searchHarnessSkills(cwd, {}, home)).skills).toEqual([]);
  for (const scope of ["project", "user"])
    await expect(readHarnessSkill(cwd, { name: "good-css", scope }, home)).rejects.toThrow(
      "disabled",
    );
  await expect(prepareHostSkillPrompt("/good-css fix", cwd, home)).rejects.toThrow("disabled");
  await setSkillEnabled("good-css", true, home);
  expect((await readHarnessSkill(cwd, { name: "good-css" }, home)).text).toContain(
    "private instructions",
  );
});

it("keeps provider-disabled skills blocked when bycoda allows them", async () => {
  const { home, cwd } = fixture();
  reportSessionCommands("skill-policy-test", [{ kind: "skill", name: "good-css", enabled: false }]);
  expect((await searchHarnessSkills(cwd, {}, home, "skill-policy-test")).skills).toEqual([]);
  await expect(
    readHarnessSkill(cwd, { name: "good-css" }, home, "skill-policy-test"),
  ).rejects.toThrow("disabled");
});

it("preserves an alternative explicitly enabled by the provider without reading its disabled copy", async () => {
  const { home, cwd } = fixture();
  const projectPath = join(cwd, ".agents/skills/good-css/SKILL.md");
  const userPath = join(home, ".agents/skills/good-css/SKILL.md");
  reportSessionCommands("skill-policy-test", [
    { kind: "skill", name: "good-css", path: projectPath, enabled: false },
    { kind: "skill", name: "good-css", path: userPath, enabled: true },
  ]);
  const found = await searchHarnessSkills(cwd, {}, home, "skill-policy-test");
  expect(found.skills).toHaveLength(1);
  expect(found.skills[0].scope).toBe("user");
  expect((await readHarnessSkill(cwd, { name: "good-css" }, home, "skill-policy-test")).scope).toBe(
    "user",
  );
  await expect(
    readHarnessSkill(cwd, { name: "good-css", scope: "project" }, home, "skill-policy-test"),
  ).rejects.toThrow("disabled");
  expect(await prepareHostSkillPrompt("/good-css fix", cwd, home, "skill-policy-test")).toContain(
    userPath.replace(/\\/g, "/"),
  );
});

it("fails closed on corrupt persistent state and rejects tool-pattern injection", async () => {
  const { home } = fixture();
  saveSkillPolicy({ disabledNames: [], disabledPaths: [] }, home);
  await expect(setSkillEnabled("*", false, home)).rejects.toThrow("Invalid skill preference");
  writeFileSync(join(home, ".bycoda-host", "skill-policy.json"), "broken");
  expect(() => readSkillPolicy(home)).toThrow("Could not read");
  await expect(readSkillPolicyAsync(home)).rejects.toThrow("Could not read");
  await expect(setSkillEnabled("synthetic", true, home)).rejects.toThrow("Could not read");
  expect(() => readSkillPolicy(home)).toThrow("Could not read");
  expect(readFileSync(join(home, ".bycoda-host", "skill-policy.json"), "utf8")).toBe("broken");
});

it.skipIf(process.platform === "win32")(
  "does not treat a dangling policy symlink as absent",
  async () => {
    const { home } = fixture();
    const directory = join(home, ".bycoda-host");
    mkdirSync(directory, { recursive: true });
    symlinkSync(join(directory, "missing"), join(directory, "skill-policy.json"));
    expect(() => readSkillPolicy(home)).toThrow("Could not read");
    await expect(migrateSkillPolicy([], home)).rejects.toThrow("Could not read");
  },
);

it("reports a failed policy replacement without deleting the existing target", async () => {
  const { home } = fixture();
  const target = join(home, ".bycoda-host", "skill-policy.json");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "evidence"), "keep");
  expect(() =>
    saveSkillPolicy({ disabledNames: ["synthetic"], disabledPaths: [] }, home),
  ).toThrow();
  expect(readFileSync(join(target, "evidence"), "utf8")).toBe("keep");
});

it("does not overwrite or remove another process's preference lock", async () => {
  const { home } = fixture();
  saveSkillPolicy({ disabledNames: ["keep"], disabledPaths: [] }, home);
  const lock = join(home, ".bycoda-host", "skill-policy.lock");
  writeFileSync(lock, "owned by another process");
  await expect(setSkillEnabled("other", false, home)).rejects.toThrow("in progress");
  expect(readSkillPolicy(home).disabledNames).toEqual(["keep"]);
  await expect(setSkillEnabled("keep", true, home)).rejects.toThrow("in progress");
  expect(readFileSync(lock, "utf8")).toBe("owned by another process");
});

it("preserves a live SQLite lock and recovers its initialized marker after the holder exits", async () => {
  const { home } = fixture();
  saveSkillPolicy({ disabledNames: ["keep"], disabledPaths: [] }, home);
  const dir = join(home, ".bycoda-host");
  const database = new DatabaseSync(join(dir, "skill-policy-lock.sqlite3"));
  database.exec("BEGIN IMMEDIATE");
  writeFileSync(join(dir, "skill-policy.lock"), "bycoda-sqlite-policy-lock-v1\n");
  try {
    await expect(setSkillEnabled("synthetic", false, home)).rejects.toThrow("in progress");
    expect(readSkillPolicy(home).disabledNames).toEqual(["keep"]);
  } finally {
    database.close();
  }
  expect((await setSkillEnabled("synthetic", false, home)).disabledNames).toEqual([
    "keep",
    "synthetic",
  ]);
});

it("recovers after an isolated process exits abruptly while holding the updated lock", async () => {
  const { home } = fixture();
  saveSkillPolicy({ disabledNames: ["keep"], disabledPaths: [] }, home);
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { DatabaseSync } from 'node:sqlite';
    import { writeFileSync, linkSync, unlinkSync } from 'node:fs';
    import { join } from 'node:path';
    const dir = process.argv[1];
    const db = new DatabaseSync(join(dir, 'skill-policy-lock.sqlite3'));
    db.exec('BEGIN IMMEDIATE');
    const temp = join(dir, 'fixture-lock.tmp');
    writeFileSync(temp, 'bycoda-sqlite-policy-lock-v1\\n');
    linkSync(temp, join(dir, 'skill-policy.lock'));
    unlinkSync(temp);
    process.exit(0);
  `,
      join(home, ".bycoda-host"),
    ],
    { windowsHide: true, stdio: "pipe" },
  );
  expect((await setSkillEnabled("synthetic", false, home)).disabledNames).toEqual([
    "keep",
    "synthetic",
  ]);
});

it("keeps the event loop free while a preference write is in flight", async () => {
  const { home } = fixture();
  const order: string[] = [];
  const pending = setSkillEnabled("good-css", false, home).then(() => {
    order.push("saved");
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  order.push("tick");
  await pending;
  expect(order).toEqual(["tick", "saved"]);
});

it("applies concurrent same-process preference changes one after another without a lock conflict", async () => {
  const { home } = fixture();
  const names = ["alpha", "beta", "gamma", "delta"];
  await Promise.all(names.map((name) => setSkillEnabled(name, false, home)));
  expect((await readSkillPolicyAsync(home)).disabledNames.sort()).toEqual([...names].sort());
  expect(existsSync(join(home, ".bycoda-host", "skill-policy.lock"))).toBe(false);
});

it("releases the preference lock after a failed change and keeps the unreadable state", async () => {
  const { home } = fixture();
  saveSkillPolicy({ disabledNames: [], disabledPaths: [] }, home);
  const file = join(home, ".bycoda-host", "skill-policy.json");
  writeFileSync(file, "broken");
  await expect(setSkillEnabled("first", false, home)).rejects.toThrow("Could not read");
  expect(existsSync(join(home, ".bycoda-host", "skill-policy.lock"))).toBe(false);
  expect(readFileSync(file, "utf8")).toBe("broken");
  saveSkillPolicy({ disabledNames: [], disabledPaths: [] }, home);
  expect((await setSkillEnabled("first", false, home)).disabledNames).toEqual(["first"]);
});
