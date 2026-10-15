import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { hostGitSubmodules } from "./git-submodules";

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
  expect(await hostGitSubmodules(parent)).toEqual(["core pack", "core pack/nested module"]);
  expect(await hostGitSubmodules(child)).toEqual(["nested module"]);
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
  expect(await hostGitSubmodules(parent)).toEqual([]);
  expect(await hostGitSubmodules(source)).toEqual([]);
});
