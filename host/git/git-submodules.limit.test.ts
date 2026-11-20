import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { hostGitSubmodules } from "./git-submodules";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    windowsHide: true,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }).trim();

function repo(root: string, name: string) {
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
}

it("keeps the gitlinks found before the repository cap and reports the scan as limited", async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-submodule-cap-")));
  roots.push(root);
  const parent = repo(root, "parent");
  for (const name of ["a", "b", "c"]) {
    git(
      parent,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "--",
      repo(root, `${name}-source`),
      name,
    );
  }
  const limited = await hostGitSubmodules(parent, false, 2);
  expect(limited.limit).toBe("repositories");
  expect(limited.paths).toHaveLength(2);
  expect(await hostGitSubmodules(parent, false, 3)).toEqual({
    paths: ["a", "b", "c"],
    limit: null,
  });
});
