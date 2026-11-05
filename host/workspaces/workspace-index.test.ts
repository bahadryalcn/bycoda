import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
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
