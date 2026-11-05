import { mkdtemp, writeFile, rm, lstat, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { execFileAsync } from "../../src/shared/lib/processExecution.node";
import { conversationGitReviewHash, readGitReviewContent } from "./conversation-git-review";
import { hostGitStarts } from "../git/git-start-gate";

it("binds Git approval to staged, working and untracked contents with unchanged line counts", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bycoda-git-review-"));
  const starts = vi.spyOn(hostGitStarts, "enter").mockResolvedValue();
  const git = (args: string[]) =>
    execFileAsync("git", args, { cwd, timeout: 30_000, windowsHide: true });
  try {
    await git(["init"]);
    await writeFile(join(cwd, "tracked.txt"), "original\n");
    await git(["add", "tracked.txt"]);
    const initial = await conversationGitReviewHash(cwd);
    await writeFile(join(cwd, "tracked.txt"), "modified\n");
    const changedWorking = await conversationGitReviewHash(cwd);
    expect(changedWorking).not.toBe(initial);
    await git(["add", "tracked.txt"]);
    const changedIndex = await conversationGitReviewHash(cwd);
    expect(changedIndex).not.toBe(changedWorking);
    await writeFile(join(cwd, "untracked.txt"), "first\n");
    const firstUntracked = await conversationGitReviewHash(cwd);
    await writeFile(join(cwd, "untracked.txt"), "other\n");
    expect(await conversationGitReviewHash(cwd)).not.toBe(firstUntracked);
    await writeFile(join(cwd, "oversized.bin"), Buffer.alloc(16 * 1024 * 1024 + 1));
    await expect(conversationGitReviewHash(cwd)).rejects.toThrow("content budget");
    expect(starts).toHaveBeenCalledTimes(30);
  } finally {
    starts.mockRestore();
    await rm(cwd, { recursive: true, force: true });
  }
});

it("rejects untracked growth and replacement after the size and identity snapshot", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bycoda-git-review-race-"));
  const path = join(cwd, "file.txt");
  try {
    await writeFile(path, "old");
    const small = await lstat(path);
    await writeFile(path, Buffer.alloc(1024 * 1024));
    await expect(readGitReviewContent(cwd, path, small, 16)).rejects.toThrow(
      "changed while reading",
    );
    await writeFile(path, "old");
    const original = await lstat(path);
    await rename(path, join(cwd, "previous.txt"));
    await writeFile(path, "new");
    await expect(readGitReviewContent(cwd, path, original, 16)).rejects.toThrow(
      "changed while reading",
    );
    expect((await readGitReviewContent(cwd, path, await lstat(path), 16)).toString()).toBe("new");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
