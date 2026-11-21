import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { hostGitSubmodules, sharedHostGitSubmodules } from "./git-submodules";
import { execFilesOffThread } from "./git-repository-discovery";

const paths = async (cwd: string, includeRepositories = false) =>
  (await hostGitSubmodules(cwd, includeRepositories)).paths;

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-submodules-")));
  roots.push(root);
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      windowsHide: true,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    }).trim();
  const repo = (name: string) => {
    const cwd = join(root, name);
    mkdirSync(cwd);
    git(cwd, "init", "-q");
    git(cwd, "config", "user.name", "Test");
    git(cwd, "config", "user.email", "test@example.test");
    git(cwd, "config", "commit.gpgsign", "false");
    writeFileSync(join(cwd, "file.txt"), "original\n");
    git(cwd, "add", "file.txt");
    git(cwd, "commit", "-qm", "initial");
    return cwd;
  };
  const add = (cwd: string, source: string, path: string) =>
    git(cwd, "-c", "protocol.file.allow=always", "submodule", "add", "--", source, path);
  return { root, git, repo, add };
}

it("discovers nested initialized repositories with spaces without changing their contents or index", async () => {
  const f = fixture();
  const nested = f.repo("nested-source");
  const module = f.repo("module-source");
  f.add(module, nested, "nested module");
  f.git(module, "commit", "-qm", "nested");
  const parent = f.repo("parent");
  f.add(parent, module, "core pack");
  f.git(parent, "-c", "protocol.file.allow=always", "submodule", "update", "--init", "--recursive");
  const child = join(parent, "core pack");
  writeFileSync(join(child, "file.txt"), "staged change\n");
  f.git(child, "add", "file.txt");
  writeFileSync(join(child, "file.txt"), "unstaged change\n");
  const before = [
    f.git(parent, "status", "--porcelain"),
    f.git(child, "status", "--porcelain"),
    f.git(child, "diff", "--cached"),
  ];
  expect(await paths(parent)).toEqual(["core pack", "core pack/nested module"]);
  expect(await paths(child)).toEqual(["nested module"]);
  expect([
    f.git(parent, "status", "--porcelain"),
    f.git(child, "status", "--porcelain"),
    f.git(child, "diff", "--cached"),
  ]).toEqual(before);
  expect(readFileSync(join(child, "file.txt"), "utf8")).toBe("unstaged change\n");
});

it("skips an uninitialized submodule instead of treating it as its parent repository", async () => {
  const f = fixture();
  const source = f.repo("source");
  const parent = f.repo("parent");
  f.add(parent, source, "core-pack");
  f.git(parent, "submodule", "deinit", "-f", "--", "core-pack");
  expect(await paths(parent)).toEqual([]);
  expect(await paths(source)).toEqual([]);
});

it("treats a plain folder as having no submodules and still discovers its repositories", async () => {
  const f = fixture();
  const plain = join(f.root, "plain");
  mkdirSync(plain);
  expect(await paths(plain)).toEqual([]);
  f.repo("plain/app");
  expect(await hostGitSubmodules(plain, true)).toEqual({ paths: ["app"], limit: null });
});

it("opts into ignored independent repositories and worktree gitfiles without following directory links", async () => {
  const f = fixture();
  const parent = f.repo("parent");
  const mobile = f.repo("parent/mobile");
  f.repo("parent/Türkçe proje");
  const outside = f.repo("outside");
  mkdirSync(join(parent, "node_modules"));
  f.repo("parent/node_modules/dependency");
  writeFileSync(join(parent, ".gitignore"), "mobile/\nnode_modules/\n");
  writeFileSync(join(mobile, "file.txt"), "independent draft\n");
  f.git(mobile, "add", "file.txt");
  writeFileSync(join(mobile, "file.txt"), "independent unsaved change\n");
  const linkedWorktree = join(parent, "review-copy");
  f.git(outside, "worktree", "add", "-qb", "review", linkedWorktree);
  symlinkSync(outside, join(parent, "external"), process.platform === "win32" ? "junction" : "dir");
  const before = [f.git(parent, "status", "--porcelain"), f.git(mobile, "diff", "--cached")];
  expect(await paths(parent)).toEqual([]);
  expect(await paths(parent, true)).toEqual(["Türkçe proje", "mobile", "review-copy"]);
  expect([f.git(parent, "status", "--porcelain"), f.git(mobile, "diff", "--cached")]).toEqual(
    before,
  );
  expect(readFileSync(join(mobile, "file.txt"), "utf8")).toBe("independent unsaved change\n");
});

it("keeps repositories found before the physical folder depth limit and reports the scan as limited", async () => {
  const f = fixture();
  const parent = f.repo("parent");
  f.repo("parent/mobile");
  mkdirSync(join(parent, ...Array.from({ length: 66 }, () => "d")), { recursive: true });
  expect(await hostGitSubmodules(parent, true)).toEqual({ paths: ["mobile"], limit: "depth" });
});

it("skips generated data and dependency stores while retaining ignored source repositories", async () => {
  const f = fixture();
  const parent = f.repo("parent");
  const generated = [".artifacts", ".local-data", ".pnpm-store", ".venv", "venv", "__pycache__"];
  for (const name of generated) {
    mkdirSync(join(parent, name, ...Array.from({ length: 66 }, () => "d")), { recursive: true });
  }
  f.repo("parent/mobile");
  const source = f.repo("source");
  f.add(parent, source, ".artifacts/pinned");
  writeFileSync(join(parent, ".gitignore"), `${generated.join("/\n")}/\nmobile/\n`);
  const before = f.git(parent, "status", "--porcelain");
  expect(await hostGitSubmodules(parent, true)).toEqual({
    paths: [".artifacts/pinned", "mobile"],
    limit: null,
  });
  expect(f.git(parent, "status", "--porcelain")).toBe(before);
});

it("deduplicates conflicted gitlink stages and preserves recursive discovery without index mutation", async () => {
  const f = fixture();
  const source = f.repo("source");
  const parent = f.repo("parent");
  f.add(parent, source, "core pack");
  const child = join(parent, "core pack");
  f.add(child, source, "nested");
  const sha = f.git(child, "rev-parse", "HEAD");
  execFileSync("git", ["update-index", "--index-info"], {
    cwd: parent,
    windowsHide: true,
    input: `0 ${"0".repeat(40)}\tcore pack\n${[1, 2, 3].map((stage) => `160000 ${sha} ${stage}\tcore pack\n`).join("")}`,
  });
  const before = f.git(parent, "ls-files", "--stage");
  expect(before).toContain(`160000 ${sha} 1\tcore pack`);
  expect(before).not.toContain(`160000 ${sha} 0\tcore pack`);
  expect(await paths(parent)).toEqual(["core pack", "core pack/nested"]);
  expect(f.git(parent, "ls-files", "--stage")).toBe(before);
  f.git(child, "submodule", "deinit", "-f", "--", "nested");
  expect(await paths(parent)).toEqual(["core pack"]);
});

it("shares one discovery per checkout for a short while and never reuses a failure", async () => {
  const f = fixture();
  const parent = f.repo("parent");
  f.repo("parent/first");
  const [one, two] = await Promise.all([
    sharedHostGitSubmodules(parent, true),
    sharedHostGitSubmodules(parent, true),
  ]);
  expect(one).toBe(two);
  expect(one.paths).toEqual(["first"]);
  f.repo("parent/second");
  expect((await sharedHostGitSubmodules(parent, true)).paths).toEqual(["first"]);
  expect((await sharedHostGitSubmodules(parent, true, true)).paths).toEqual(["first", "second"]);
  expect((await sharedHostGitSubmodules(parent, true)).paths).toEqual(["first", "second"]);
  const missing = join(f.root, "missing");
  await expect(sharedHostGitSubmodules(missing, true)).rejects.toThrow();
  mkdirSync(missing);
  expect((await sharedHostGitSubmodules(missing, true)).paths).toEqual([]);
});

it("runs commands off the main thread in order, reports failures and shares one deadline", async () => {
  const node = process.execPath;
  const results = await execFilesOffThread(
    [
      { file: node, args: ["-e", "process.stdout.write('one')"] },
      { file: node, args: ["-e", "process.stderr.write('Scan failed'); process.exitCode = 3"] },
      { file: node, args: ["-e", "setTimeout(() => {}, 10_000)"] },
      { file: node, args: ["-e", "process.stdout.write('late')"] },
    ],
    3_000,
  );
  expect(results[0]).toEqual({ stdout: "one" });
  expect(results[1]).toMatchObject({
    failure: { phase: "exit", exitCode: 3, stderr: "Scan failed" },
  });
  expect(results[2]).toMatchObject({ failure: { phase: "timeout", signal: "SIGTERM" } });
  expect(results[3]).toMatchObject({ failure: { phase: "timeout", signal: null, stderr: "" } });
}, 20_000);
