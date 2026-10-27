import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { cleanupTaskWorktree, isTaskWorktreeRemoving } from "./task-worktree-cleanup";
import { createHostWorktree, hostWorktrees } from "./git-worktrees";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}, 120_000);
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
async function setup(linkedAncestor = false) {
  const root = mkdtempSync(join(tmpdir(), "task-cleanup-"));
  roots.push(root);
  let ancestor = root;
  if (linkedAncestor) {
    const actual = join(root, "actual");
    ancestor = join(root, "alias");
    mkdirSync(actual);
    symlinkSync(actual, ancestor, process.platform === "win32" ? "junction" : "dir");
  }
  const cwd = join(ancestor, "project");
  mkdirSync(cwd);
  git(cwd, "init", "-q");
  git(cwd, "checkout", "-q", "-b", "main");
  git(cwd, "config", "user.name", "Test");
  git(cwd, "config", "user.email", "test@example.test");
  writeFileSync(join(cwd, ".gitignore"), "/temp/\n");
  git(cwd, "add", ".gitignore");
  git(cwd, "commit", "-q", "-m", "initial");
  const tree = await createHostWorktree(cwd, "mc/test", "HEAD", false);
  return {
    root,
    cwd,
    tree,
    aliasPath: join(ancestor, relative(realpathSync(ancestor), tree.path)),
  };
}
it("cleans a legacy aliased workspace while fencing process starts under either spelling", async () => {
  const { cwd, tree, aliasPath } = await setup(true);
  await cleanupTaskWorktree(cwd, "task", aliasPath, "mc/test", { head: tree.head }, () => {
    expect(isTaskWorktreeRemoving(aliasPath)).toBe(true);
    expect(isTaskWorktreeRemoving(tree.path)).toBe(true);
    return false;
  });
  expect(existsSync(tree.path)).toBe(false);
  expect(isTaskWorktreeRemoving(aliasPath)).toBe(false);
  expect(isTaskWorktreeRemoving(tree.path)).toBe(false);
  expect(git(cwd, "rev-parse", "mc/test")).toBe(tree.head);
}, 120_000);
it("removes a delivered checkout while preserving ignored outputs in the archive", async () => {
  const { cwd, tree } = await setup();
  mkdirSync(join(tree.path, "temp/local/result"), { recursive: true });
  writeFileSync(join(tree.path, "temp/local/result/README.md"), "completed output");
  const archives = await cleanupTaskWorktree(cwd, "task", tree.path, "mc/test", {
    deliveredCommit: tree.head,
  });
  expect(existsSync(tree.path)).toBe(false);
  expect((await hostWorktrees(cwd)).worktrees).toHaveLength(1);
  expect(readFileSync(join(archives[0], "local/result/README.md"), "utf8")).toBe(
    "completed output",
  );
}, 120_000);
it("archives Windows-style unregistered residual directories without losing their files", async () => {
  const { cwd, tree } = await setup();
  git(cwd, "worktree", "remove", tree.path);
  mkdirSync(tree.path);
  writeFileSync(join(tree.path, "package.json"), "retained file");
  const archives = await cleanupTaskWorktree(cwd, "task", tree.path, "mc/test", {
    deliveredCommit: tree.head,
  });
  expect(existsSync(tree.path)).toBe(false);
  expect(readFileSync(join(archives[0], "package.json"), "utf8")).toBe("retained file");
}, 120_000);
it("retains post-delivery changes and refuses the main or unrelated checkout", async () => {
  const { cwd, tree, root } = await setup();
  writeFileSync(join(tree.path, "owner-draft.txt"), "owner draft");
  await expect(
    cleanupTaskWorktree(cwd, "task", tree.path, "mc/test", { head: tree.head }),
  ).rejects.toThrow("changes made after delivery");
  await expect(cleanupTaskWorktree(cwd, "task", cwd, "mc/test", {})).rejects.toThrow(
    "outside its managed workspace",
  );
  await expect(
    cleanupTaskWorktree(cwd, "task", join(root, "audit"), "mc/test", {}),
  ).rejects.toThrow("outside its managed workspace");
  expect(readFileSync(join(tree.path, "owner-draft.txt"), "utf8")).toBe("owner draft");
}, 120_000);
it("preserves locked checkouts and removes them after unlock", async () => {
  const { cwd, tree } = await setup();
  git(cwd, "worktree", "lock", tree.path);
  await expect(
    cleanupTaskWorktree(cwd, "task", tree.path, "mc/test", { head: tree.head }),
  ).rejects.toThrow("locked");
  expect(existsSync(tree.path)).toBe(true);
  git(cwd, "worktree", "unlock", tree.path);
  await cleanupTaskWorktree(cwd, "task", tree.path, "mc/test", { head: tree.head });
  expect(existsSync(tree.path)).toBe(false);
}, 120_000);
