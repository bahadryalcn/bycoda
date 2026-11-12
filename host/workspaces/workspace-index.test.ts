import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { indexHostFiles, invalidateHostFilePaths, searchHostFiles } from "./workspace";

const roots: string[] = [];
function repository() {
  const root = mkdtempSync(join(tmpdir(), "bycoda-file-index-"));
  roots.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, windowsHide: true });
  git("init", "-q");
  writeFileSync(join(root, "kept.txt"), "kept\n");
  writeFileSync(join(root, "deleted.txt"), "tracked\n");
  git("add", "--", "kept.txt", "deleted.txt");
  unlinkSync(join(root, "deleted.txt"));
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    invalidateHostFilePaths(root);
    if (!resolve(root).startsWith(resolve(join(tmpdir(), "bycoda-file-index-"))))
      throw new Error("Unsafe fixture cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});

it("excludes deleted tracked paths while retaining existing and untracked files", async () => {
  const root = repository();
  writeFileSync(join(root, ".gitignore"), "ignored.txt\n");
  writeFileSync(join(root, "ignored.txt"), "ignored\n");
  writeFileSync(join(root, "new.txt"), "new\n");
  expect((await indexHostFiles(root)).sort()).toEqual([".gitignore", "kept.txt", "new.txt"]);
  expect(await searchHostFiles(root, "deleted")).toEqual([]);
});

it("indexes a recreated tracked file after the cached list is invalidated", async () => {
  const root = repository();
  expect(await indexHostFiles(root)).not.toContain("deleted.txt");
  writeFileSync(join(root, "deleted.txt"), "restored\n");
  invalidateHostFilePaths(root);
  expect(await indexHostFiles(root)).toContain("deleted.txt");
  expect(await searchHostFiles(root, "deleted")).toMatchObject([{ path: "deleted.txt" }]);
});

it("indexes nested repositories and linked workspace checkouts with their own ignores", async () => {
  const root = repository();
  const source = repository();
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, windowsHide: true });
  git(source, "add", "-A");
  git(
    source,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "fixture",
  );
  mkdirSync(join(root, "packages"));
  mkdirSync(join(root, "packages/plain"));
  writeFileSync(join(root, "packages/plain/package.ts"), "workspace package");
  const nested = join(root, "packages/nested");
  mkdirSync(nested);
  git(nested, "init", "-q");
  writeFileSync(join(nested, "nested.ts"), "nested");
  writeFileSync(join(nested, ".gitignore"), "secret.txt\nnode_modules/\n");
  writeFileSync(join(nested, "secret.txt"), "private");
  mkdirSync(join(nested, "node_modules"));
  writeFileSync(join(nested, "node_modules/dependency.js"), "dependency");
  git(source, "worktree", "add", "-qb", "linked", join(root, "packages/linked"));
  const files = await indexHostFiles(root);
  expect(files).toContain("packages/plain/package.ts");
  expect(files).toContain("packages/nested/nested.ts");
  expect(files).toContain("packages/linked/kept.txt");
  expect(files).not.toContain("packages/nested/");
  expect(
    files.some(
      (path) =>
        path.includes("secret.txt") || path.includes("node_modules/") || path.endsWith("/.git"),
    ),
  ).toBe(false);
});

it("indexes initialized Git submodules instead of their directory entries", async () => {
  const root = repository();
  const source = repository();
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, windowsHide: true });
  git(source, "add", "-A");
  git(
    source,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "fixture",
  );
  git(
    root,
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    "-q",
    source,
    "modules/library",
  );
  writeFileSync(join(root, "modules/library/untracked.ts"), "new");
  const files = await indexHostFiles(root);
  expect(files).toContain("modules/library/kept.txt");
  expect(files).toContain("modules/library/untracked.ts");
  expect(files).not.toContain("modules/library");
});

it("honors nested repository ignores when the selected workspace is not a repository", async () => {
  const root = mkdtempSync(join(tmpdir(), "bycoda-file-index-"));
  roots.push(root);
  const nested = join(root, "package");
  mkdirSync(nested);
  execFileSync("git", ["init", "-q"], { cwd: nested, windowsHide: true });
  writeFileSync(join(nested, ".gitignore"), "secret.txt\n");
  writeFileSync(join(nested, "secret.txt"), "private");
  writeFileSync(join(nested, "visible.ts"), "visible");
  expect((await indexHostFiles(root)).sort()).toEqual(["package/.gitignore", "package/visible.ts"]);
});
