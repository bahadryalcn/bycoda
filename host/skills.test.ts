import { afterEach, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exportHostSkill,
  deleteHostSkill,
  importHostSkill,
  listHostSkills,
  parseFrontmatter,
  slugName,
} from "./skills";

const cleanups: string[] = [];
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(label: string) {
  const dir = mkdtempSync(join(tmpdir(), `bycoda-skills-${label}-`));
  cleanups.push(dir);
  return dir;
}

function skill(root: string, folder: string, body: string) {
  mkdirSync(join(root, folder), { recursive: true });
  writeFileSync(join(root, folder, "SKILL.md"), body);
}

it("excludes disabled copies before name resolution and canonicalizes host paths", () => {
  const project = scratch("disabled-project"),
    home = scratch("disabled-home");
  skill(join(project, ".agents/skills"), "review", "# project");
  skill(join(home, ".agents/skills"), "review", "# personal");
  const projectPath = join(project, ".agents/skills/review/SKILL.md");
  const personalPath = join(home, ".agents/skills/review/SKILL.md");
  const selected = (disabled: string[]) =>
    listHostSkills(project, home, disabled).find((skill) => skill.name === "review");
  expect(selected([])?.scope).toBe("project");
  expect(selected([projectPath])?.scope).toBe("user");
  expect(selected([projectPath, personalPath])).toBeUndefined();
  expect(selected([personalPath])?.scope).toBe("project");
  expect(selected([projectPath.replace(/\\/g, "/")])?.scope).toBe("user");
  if (process.platform === "win32")
    expect(selected([projectPath.toUpperCase()])?.scope).toBe("user");
});

it("deletes only the listed skill folder including supporting files and reveals a same-name fallback", () => {
  const project = scratch("delete-project");
  const home = scratch("delete-home");
  const root = join(project, ".agents/skills");
  skill(root, "tool", "# tool");
  skill(root, "keep", "# keep");
  skill(join(home, ".agents/skills"), "tool", "# fallback");
  mkdirSync(join(root, "tool/scripts"));
  writeFileSync(join(root, "tool/scripts/run.js"), "support");
  deleteHostSkill(join(root, "tool/SKILL.md"), project, home);
  expect(existsSync(join(root, "tool"))).toBe(false);
  expect(existsSync(join(root, "keep/SKILL.md"))).toBe(true);
  expect(listHostSkills(project, home).find((entry) => entry.name === "tool")?.scope).toBe("user");
});

it("deletes a project skill when a system folder above the project is a link", () => {
  // macOS keeps temporary and many user folders under /var -> /private/var.
  const real = scratch("delete-real-parent");
  const linked = `${real}-link`;
  symlinkSync(real, linked, process.platform === "win32" ? "junction" : "dir");
  cleanups.push(linked);
  const project = join(linked, "project");
  const home = join(linked, "home");
  skill(join(project, ".agents/skills"), "tool", "# tool");
  mkdirSync(home);
  deleteHostSkill(join(project, ".agents/skills/tool/SKILL.md"), project, home);
  expect(existsSync(join(project, ".agents/skills/tool"))).toBe(false);
});

it("rejects arbitrary, system and plugin skill deletion", () => {
  const home = scratch("delete-protected");
  skill(join(home, ".codex/skills/.system"), "system-tool", "# system");
  const plugin = join(home, "external-kit");
  skill(join(plugin, "skills"), "plugin-tool", "# plugin");
  mkdirSync(join(home, ".claude/plugins"), { recursive: true });
  writeFileSync(
    join(home, ".claude/plugins/installed_plugins.json"),
    JSON.stringify({ plugins: { "kit@market": [{ installPath: plugin }] } }),
  );
  writeFileSync(join(home, "SKILL.md"), "# unrelated");
  expect(() => deleteHostSkill(join(home, "SKILL.md"), null, home)).toThrow(/not one of/);
  expect(() =>
    deleteHostSkill(join(home, ".codex/skills/.system/system-tool/SKILL.md"), null, home),
  ).toThrow(/managed by their provider/);
  expect(() => deleteHostSkill(join(plugin, "skills/plugin-tool/SKILL.md"), null, home)).toThrow(
    /managed by their provider/,
  );
  expect(existsSync(join(plugin, "skills/plugin-tool/SKILL.md"))).toBe(true);
  expect(existsSync(join(home, ".codex/skills/.system/system-tool/SKILL.md"))).toBe(true);
});

it("refuses a linked skill folder without deleting its target", () => {
  const home = scratch("delete-linked-home");
  const outside = scratch("delete-linked-target");
  skill(outside, "tool", "# target");
  mkdirSync(join(home, ".agents/skills"), { recursive: true });
  symlinkSync(
    join(outside, "tool"),
    join(home, ".agents/skills/tool"),
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(() => deleteHostSkill(join(home, ".agents/skills/tool/SKILL.md"), null, home)).toThrow(
    /Linked/,
  );
  expect(existsSync(join(outside, "tool/SKILL.md"))).toBe(true);
});

it("refuses a linked skills root without deleting its target", () => {
  const home = scratch("delete-root-home");
  const outside = scratch("delete-root-target");
  skill(outside, "tool", "# target");
  mkdirSync(join(home, ".agents"));
  symlinkSync(
    outside,
    join(home, ".agents/skills"),
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(() => deleteHostSkill(join(home, ".agents/skills/tool/SKILL.md"), null, home)).toThrow(
    /Linked/,
  );
  expect(existsSync(join(outside, "tool/SKILL.md"))).toBe(true);
});

it("lists a project's skills before the personal ones, as the desktop does", () => {
  const project = scratch("project");
  const home = scratch("home");
  skill(
    join(project, ".agents/skills"),
    "deploy",
    "---\nname: deploy\ndescription: Ship it\n---\n",
  );
  skill(
    join(home, ".agents/skills"),
    "deploy",
    "---\nname: deploy\ndescription: Personal copy\n---\n",
  );
  skill(join(home, ".claude/skills"), "Review PR", "# no frontmatter");
  skill(join(home, ".claude/skills"), ".hidden", "---\nname: hidden\n---\n");

  const listed = listHostSkills(project, home);
  expect(listed.map((entry) => [entry.name, entry.scope, entry.source])).toEqual([
    ["deploy", "project", "agents"],
    ["review-pr", "user", "claude"],
  ]);
  expect(listed[0].description).toBe("Ship it");
  expect(listed[0].path.endsWith("/.agents/skills/deploy/SKILL.md")).toBe(true);
  expect(listed[0].path).not.toContain("\\");
});

it("lists only personal skills without a project", () => {
  const home = scratch("home");
  skill(join(home, ".agents/skills"), "notes", "---\nname: notes\n---\n");
  expect(listHostSkills(null, home).map((entry) => entry.scope)).toEqual(["user"]);
});

it("reads names and folded descriptions like the desktop", () => {
  expect(
    parseFrontmatter(
      "---\nname: review-pr\ndescription: >\n  Review pull requests.\n  Use when asked.\n---\n",
      "fallback",
    ),
  ).toEqual({ name: "review-pr", description: "Review pull requests. Use when asked." });
  expect(parseFrontmatter("---\nname: Not Valid\n---\n", "folder").name).toBe("folder");
  expect(slugName("My Great_Skill!")).toBe("my-great-skill");
});

const b64 = (value: string | Buffer) => Buffer.from(value).toString("base64");
const asFile = (path: string, value: string | Buffer = "x") => ({ path, data: b64(value) });
const skillMd = (home: string, folder: string) => join(home, ".agents/skills", folder, "SKILL.md");

it("exports every file of a listed skill with relative paths", () => {
  const project = scratch("project");
  const home = scratch("home");
  const root = join(home, ".agents/skills");
  skill(root, "tool", "---\nname: tool\n---\nbody");
  mkdirSync(join(root, "tool/scripts/deep"), { recursive: true });
  writeFileSync(join(root, "tool/scripts/run.sh"), "echo hi");
  writeFileSync(join(root, "tool/scripts/deep/data.bin"), Buffer.from([0, 255, 7]));
  writeFileSync(join(root, "tool/.DS_Store"), "junk");

  const bundle = exportHostSkill(skillMd(home, "tool"), project, home);
  expect(bundle.name).toBe("tool");
  expect(bundle.files.map((file) => file.path)).toEqual([
    "SKILL.md",
    "scripts/deep/data.bin",
    "scripts/run.sh",
  ]);
  expect(bundle.files[1].data).toBe(b64(Buffer.from([0, 255, 7])));
});

it("refuses to export a path that is not a listed skill", () => {
  const project = scratch("project");
  const home = scratch("home");
  writeFileSync(join(home, "secret.md"), "x");
  skill(join(project, "notes"), "idea", "# idea");
  for (const path of [
    join(home, "secret.md"),
    join(project, "notes/idea/SKILL.md"),
    join(home, "missing/SKILL.md"),
  ]) {
    expect(() => exportHostSkill(path, project, home)).toThrow(/not one of the skills/);
  }
  expect(() => exportHostSkill(undefined, project, home)).toThrow();
});

it("lists and exports personal skills only for an empty project", () => {
  const project = scratch("project");
  const home = scratch("home");
  skill(join(home, ".agents/skills"), "mine", "# mine");
  skill(join(project, ".agents/skills"), "theirs", "# theirs");
  expect(listHostSkills(null, home).map((entry) => entry.name)).toEqual(["mine"]);
  expect(exportHostSkill(skillMd(home, "mine"), null, home).name).toBe("mine");
  expect(() => exportHostSkill(skillMd(project, "theirs"), null, home)).toThrow(
    /not one of the skills/,
  );
  expect(exportHostSkill(skillMd(project, "theirs"), project, home).name).toBe("theirs");
});

it.skipIf(process.platform === "win32")("does not export links that leave the skill folder", () => {
  const project = scratch("project");
  const home = scratch("home");
  const outside = scratch("outside");
  writeFileSync(join(outside, "secret.txt"), "secret");
  skill(join(home, ".agents/skills"), "linked", "# linked");
  symlinkSync(join(outside, "secret.txt"), join(home, ".agents/skills/linked/leak.txt"));
  symlinkSync(outside, join(home, ".agents/skills/linked/dir"));
  const bundle = exportHostSkill(skillMd(home, "linked"), project, home);
  expect(bundle.files.map((file) => file.path)).toEqual(["SKILL.md"]);
});

it("enforces the file count and size limits when exporting", () => {
  const project = scratch("project");
  const home = scratch("home");
  const root = join(home, ".agents/skills");
  const exportOf = (folder: string) => () => exportHostSkill(skillMd(home, folder), project, home);

  skill(root, "many", "# many");
  for (let i = 0; i < 200; i++) writeFileSync(join(root, "many", `f${i}.txt`), "x");
  expect(exportOf("many")).toThrow(/more than 200 files/);

  skill(root, "big", "# big");
  writeFileSync(join(root, "big/blob.bin"), Buffer.alloc(2 * 1024 * 1024 + 1));
  expect(exportOf("big")).toThrow(/larger than 2 MiB/);

  skill(root, "huge", "# huge");
  for (let i = 0; i < 5; i++)
    writeFileSync(join(root, "huge", `p${i}.bin`), Buffer.alloc(2 * 1024 * 1024));
  expect(exportOf("huge")).toThrow(/8 MiB in total/);
});

it("imports into the personal agents folder and round-trips bytes", () => {
  const project = scratch("project");
  const source = scratch("source");
  const target = scratch("target");
  const root = join(source, ".agents/skills");
  skill(root, "tool", "---\nname: tool\n---\nbody");
  mkdirSync(join(root, "tool/refs"), { recursive: true });
  const blob = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  writeFileSync(join(root, "tool/refs/blob.bin"), blob);

  const bundle = exportHostSkill(skillMd(source, "tool"), project, source);
  const written = importHostSkill(bundle, target);
  expect(written).toBe(skillMd(target, "tool").replace(/\\/g, "/"));
  expect(readFileSync(join(target, ".agents/skills/tool/refs/blob.bin")).equals(blob)).toBe(true);
  expect(readFileSync(join(target, ".agents/skills/tool/SKILL.md"), "utf8")).toBe(
    "---\nname: tool\n---\nbody",
  );
  expect(listHostSkills(null, target).map((entry) => entry.path)).toEqual([written]);
});

it("rejects bad names, unsafe paths and a missing SKILL.md on import", () => {
  const home = scratch("home");
  const ok = asFile("SKILL.md");
  for (const name of ["", "Bad", "a--b", "-a", "a/b", "..", "a".repeat(65), 7]) {
    expect(() => importHostSkill({ name, files: [ok] }, home)).toThrow();
  }
  for (const path of [
    "../evil.md",
    "a/../../evil.md",
    "/abs.md",
    "C:/abs.md",
    "C:evil.md",
    "a//b.md",
    "./a.md",
    "a\\b.md",
    "nul\0.md",
    "",
    "a/",
    "CON.txt",
    "a".repeat(300),
  ]) {
    expect(
      () => importHostSkill({ name: "tool", files: [ok, asFile(path)] }, home),
      path,
    ).toThrow();
  }
  expect(() => importHostSkill({ name: "tool", files: [asFile("docs/SKILL.md")] }, home)).toThrow(
    /top level/,
  );
  expect(() =>
    importHostSkill({ name: "tool", files: [ok, asFile("a.md", "1"), asFile("A.md", "2")] }, home),
  ).toThrow(/twice/);
  expect(() =>
    importHostSkill({ name: "tool", files: [{ path: "SKILL.md", data: "***" }] }, home),
  ).toThrow(/not valid data/);
  expect(existsSync(join(home, ".agents/skills/tool"))).toBe(false);
  expect(existsSync(join(home, "evil.md"))).toBe(false);
});

it("checks the import limits on the decoded bytes", () => {
  const home = scratch("home");
  const ok = asFile("SKILL.md");
  const many = [ok, ...Array.from({ length: 200 }, (_, i) => asFile(`f${i}.txt`))];
  expect(() => importHostSkill({ name: "tool", files: many }, home)).toThrow(/more than 200 files/);
  expect(() =>
    importHostSkill(
      { name: "tool", files: [ok, asFile("blob.bin", Buffer.alloc(2 * 1024 * 1024 + 1))] },
      home,
    ),
  ).toThrow(/2 MiB/);
  const parts = Array.from({ length: 5 }, (_, i) =>
    asFile(`p${i}.bin`, Buffer.alloc(2 * 1024 * 1024)),
  );
  expect(() => importHostSkill({ name: "tool", files: [ok, ...parts] }, home)).toThrow(
    /8 MiB in total/,
  );
});

it("refuses an existing skill unless overwriting, then swaps it cleanly", () => {
  const home = scratch("home");
  importHostSkill({ name: "tool", files: [asFile("SKILL.md", "# one"), asFile("old.txt")] }, home);
  const second = [asFile("SKILL.md", "# two"), asFile("new.txt")];
  expect(() => importHostSkill({ name: "tool", files: second }, home)).toThrow(/^SKILL_EXISTS:/);
  const dest = join(home, ".agents/skills/tool");
  expect(readFileSync(join(dest, "SKILL.md"), "utf8")).toBe("# one");

  importHostSkill({ name: "tool", files: second, overwrite: true }, home);
  expect(readFileSync(join(dest, "SKILL.md"), "utf8")).toBe("# two");
  expect(existsSync(join(dest, "new.txt"))).toBe(true);
  expect(existsSync(join(dest, "old.txt"))).toBe(false);
  expect(readdirSync(join(home, ".agents/skills"))).toEqual(["tool"]);
});

it("leaves the existing skill untouched when an import fails midway", () => {
  const home = scratch("home");
  importHostSkill({ name: "tool", files: [asFile("SKILL.md", "# one")] }, home);
  const broken = [asFile("SKILL.md", "# two"), asFile("a", "file"), asFile("a/b.txt", "nested")];
  expect(() => importHostSkill({ name: "tool", files: broken, overwrite: true }, home)).toThrow();
  expect(readFileSync(join(home, ".agents/skills/tool/SKILL.md"), "utf8")).toBe("# one");
  expect(readdirSync(join(home, ".agents/skills"))).toEqual(["tool"]);
});

it("accepts an empty project for list and export but still checks a real one", async () => {
  const { WorkspaceCommands } = await import("./workspace-commands");
  const outside = scratch("outside");
  const commands = new WorkspaceCommands(
    { projects: () => [], attachmentDir: join(outside, "attachments") } as never,
    (async (_id: string, action: () => Promise<unknown>) => action()) as never,
  );
  const personal = (await commands.run("list_skills", { cwd: "" })) as { scope: string }[];
  expect(personal.every((entry) => entry.scope === "user")).toBe(true);
  await expect(
    commands.run("skill_export", { path: join(outside, "SKILL.md"), cwd: "" }),
  ).rejects.toThrow(/not one of the skills/);
  await expect(
    commands.run("skill_delete", { path: join(outside, "SKILL.md"), cwd: "" }),
  ).rejects.toThrow(/not one of the skills/);
  await expect(
    commands.run("skill_delete", {
      path: join(outside, "SKILL.md"),
      cwd: outside,
    }),
  ).rejects.toThrow(/outside this machine/);
  await expect(commands.run("list_skills", { cwd: outside })).rejects.toThrow(
    /outside this machine/,
  );
  await expect(
    commands.run("skill_export", {
      path: join(outside, "SKILL.md"),
      cwd: outside,
    }),
  ).rejects.toThrow(/outside this machine/);
});
