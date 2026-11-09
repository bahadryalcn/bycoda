import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createHostBranch, hostBranches, switchHostBranch } from "./git-branches";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("lists and switches only clean existing local branches", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "bycoda-host-branches-"));
  dirs.push(cwd);
  const git = (...args: string[]) => execFileSync("git", args, { cwd });
  git("init");
  git("checkout", "-b", "main");
  writeFileSync(join(cwd, "file.txt"), "initial");
  git("add", "file.txt");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "initial");
  git("branch", "feature");
  expect(await hostBranches(cwd)).toEqual({
    current: "main",
    branches: ["feature", "main"],
    remotes: [],
  });
  expect(await switchHostBranch(cwd, "feature")).toMatchObject({
    current: "feature",
  });
  await expect(switchHostBranch(cwd, "missing")).rejects.toThrow("existing local branch");
  writeFileSync(join(cwd, "file.txt"), "changed");
  await expect(switchHostBranch(cwd, "main")).rejects.toThrow("Commit or stash");
  expect((await hostBranches(cwd)).current).toBe("feature");
  await expect(createHostBranch(cwd, "new-feature")).rejects.toThrow("Commit or stash");
  writeFileSync(join(cwd, "file.txt"), "initial");
  expect(await createHostBranch(cwd, "new-feature")).toMatchObject({
    current: "new-feature",
  });
  git("remote", "add", "origin", cwd);
  git("update-ref", "refs/remotes/origin/review", "HEAD");
  expect((await hostBranches(cwd)).remotes).toContainEqual({
    remote: "origin",
    name: "review",
  });
  expect(await switchHostBranch(cwd, "review", "origin")).toMatchObject({
    current: "review",
  });
});

it("keeps local branch identity stable when a tag has the same name (#39)", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "bycoda-host-branches-"));
  dirs.push(cwd);
  const git = (...args: string[]) => execFileSync("git", args, { cwd });
  git("init", "-b", "main");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-m",
    "initial",
  );
  git("branch", "topic");
  git("tag", "topic");
  expect((await hostBranches(cwd)).branches).toEqual(["main", "topic"]);
  expect(await switchHostBranch(cwd, "topic")).toMatchObject({ current: "topic" });
  expect(await switchHostBranch(cwd, "main")).toMatchObject({ current: "main" });
});

it("preserves slash-containing remote and branch names (#40)", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "bycoda-host-branches-"));
  dirs.push(cwd);
  const git = (...args: string[]) => execFileSync("git", args, { cwd });
  git("init", "-b", "main");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-m",
    "initial",
  );
  git("remote", "add", "origin", cwd);
  git("remote", "add", "team/origin", cwd);
  git("update-ref", "refs/remotes/team/origin/topic/nested", "HEAD");
  git("update-ref", "refs/remotes/origin/simple", "HEAD");
  git("symbolic-ref", "refs/remotes/team/origin/HEAD", "refs/remotes/team/origin/topic/nested");
  expect((await hostBranches(cwd)).remotes).toEqual([
    { remote: "origin", name: "simple" },
    { remote: "team/origin", name: "topic/nested" },
  ]);
  expect(await switchHostBranch(cwd, "topic/nested", "team/origin")).toMatchObject({
    current: "topic/nested",
  });
  expect(git("config", "branch.topic/nested.remote").toString().trim()).toBe("team/origin");
  expect(git("config", "branch.topic/nested.merge").toString().trim()).toBe(
    "refs/heads/topic/nested",
  );
});
