import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, rmdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileAsync } from "../../src/shared/lib/processExecution.node";
import { projectManagementPath, runConversationGitAction } from "./conversation-project-management";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-voice-git-"));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileAsync("git", args, {
      cwd: root,
      windowsHide: true,
      timeout: 10_000,
    });
  await git("init", "-b", "main");
  await writeFile(join(root, "owned.txt"), "original");
  await writeFile(join(root, "other.txt"), "original");
  await git("add", ".");
  await git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "fixture",
  );
  return { root, git };
}
it("stashes only explicit approved files, preserving unrelated checkout edits", async () => {
  const f = await fixture();
  await writeFile(join(f.root, "owned.txt"), "owned change");
  await writeFile(join(f.root, "other.txt"), "other change");
  await runConversationGitAction(f.root, "git.stash", {
    paths: ["owned.txt"],
    message: "voice fixture",
  });
  expect(await readFile(join(f.root, "owned.txt"), "utf8")).toBe("original");
  expect(await readFile(join(f.root, "other.txt"), "utf8")).toBe("other change");
  expect((await f.git("stash", "list")).stdout).toContain("voice fixture");
});
it("rejects traversal and broad directory stash, and refuses pull over dirty work", async () => {
  const f = await fixture();
  await expect(
    runConversationGitAction(f.root, "git.stash", { paths: ["../outside"] }),
  ).rejects.toThrow("outside");
  await expect(runConversationGitAction(f.root, "git.stash", { paths: ["."] })).rejects.toThrow();
  await writeFile(join(f.root, "other.txt"), "dirty");
  await expect(runConversationGitAction(f.root, "git.pull", {})).rejects.toThrow(
    "clean working tree",
  );
  await expect(projectManagementPath(f.root, "../other-project")).rejects.toThrow("outside");
  expect(await projectManagementPath(f.root)).toBe(f.root);
});
it("rejects a deleted directory prefix while allowing an exact deleted tracked file", async () => {
  const f = await fixture();
  const directory = join(f.root, "deleted");
  const file = join(directory, "owned.txt");
  await mkdir(directory);
  await writeFile(file, "nested original");
  await f.git("add", "deleted/owned.txt");
  await f.git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "nested fixture",
  );
  await rm(file);
  await rmdir(directory);
  await expect(
    runConversationGitAction(f.root, "git.stash", { paths: ["deleted"] }),
  ).rejects.toThrow("explicit regular files");
  expect((await f.git("stash", "list")).stdout).toBe("");
  await runConversationGitAction(f.root, "git.stash", {
    paths: ["deleted/owned.txt"],
  });
  expect(await readFile(file, "utf8")).toBe("nested original");
});
