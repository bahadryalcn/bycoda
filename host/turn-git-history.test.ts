import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ManagedWorkspace } from "./workspace-contracts";
import { GitTurnHistory, gitText, rewindRef, turnGit, turnRef } from "./turn-git-history";

describe("managed turn Git history", () => {
  let root: string, repo: string, workspace: ManagedWorkspace, history: GitTurnHistory;
  const write = (name: string, text: string | Buffer) => writeFile(join(repo, name), text);
  beforeEach(async () => {
    await mkdir(resolve("temp/local/s2/git-tests"), { recursive: true });
    root = await mkdtemp(resolve("temp/local/s2/git-tests/case-"));
    repo = join(root, "repo");
    await mkdir(repo);
    await turnGit(repo, ["init", "-b", "main"]);
    await turnGit(repo, ["config", "user.name", "Test"]);
    await turnGit(repo, ["config", "user.email", "test@local"]);
    await turnGit(repo, ["config", "core.autocrlf", "false"]);
    await write("source.txt", "base\n");
    await write(".gitignore", "cache/\n");
    await turnGit(repo, ["add", "."]);
    await turnGit(repo, ["commit", "-m", "base"]);
    const base = await gitText(repo, ["rev-parse", "HEAD"]);
    await turnGit(repo, ["checkout", "-b", "bycoda/s/test-workspace"]);
    workspace = {
      id: "workspace",
      repositoryId: "repo",
      projectId: "project",
      environmentId: "local",
      owner: { kind: "session", id: "session" },
      path: repo,
      branchRef: "refs/heads/bycoda/s/test-workspace",
      targetBranchRef: "refs/heads/main",
      baseRef: "refs/heads/main",
      baseCommit: base,
      state: "idle",
      directoryState: "present",
      revision: 1,
      lastActivityAt: 0,
      pinned: false,
    };
    history = new GitTurnHistory({ root: join(root, "private"), workspace: async () => workspace });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const begin = (userBlockId = "user-1", runId = "run-1") =>
    history.begin({
      workspaceId: "workspace",
      sessionId: "session",
      userBlockId,
      runId,
      conversationRevision: 1,
    });

  it("idempotently verifies preexisting matching recovery refs and never replaces conflicting refs", async () => {
    const snapshot = await history.capture(workspace);
    const refs: [string, string, string] = [
      rewindRef("retry", "rescue-head"),
      rewindRef("retry", "rescue-index"),
      rewindRef("retry", "rescue-worktree"),
    ];
    await turnGit(repo, ["update-ref", refs[0], snapshot.head]);
    await history.retain(workspace, snapshot, refs);
    await history.retain(workspace, snapshot, refs);
    for (const [index, reference] of refs.entries())
      expect(await gitText(repo, ["rev-parse", reference])).toBe(
        [snapshot.head, snapshot.index, snapshot.worktree][index],
      );
    await write("source.txt", "different recovery source\n");
    const changed = await history.capture(workspace);
    await expect(history.retain(workspace, changed, refs)).rejects.toThrow("conflicts");
    expect(await gitText(repo, ["rev-parse", refs[2]])).toBe(snapshot.worktree);
  }, 120_000);

  it("retries a blocked after capture while retaining the original complete before boundary", async () => {
    const before = await begin();
    await write("source.txt", "finished turn\n");
    const capture = vi
      .spyOn(history, "capture")
      .mockRejectedValueOnce(new Error("temporary capture failure"));
    const request = {
      workspaceId: workspace.id,
      sessionId: "session",
      userBlockId: "user-1",
      runId: "run-1",
    };
    const failed = await history.end(request);
    expect(failed.after).toMatchObject({ status: "blocked", reason: "temporary capture failure" });
    capture.mockRestore();
    const retried = await history.end(request);
    expect(retried.before).toEqual(before.before);
    expect(retried.after?.status).toBe("complete");
    expect(await history.end(request)).toEqual(retried);
  }, 120_000);

  it("retains every real commit boundary and raw index/worktree including staged, unstaged and untracked bytes", async () => {
    await write("source.txt", "staged\r\n");
    await turnGit(repo, ["add", "source.txt"]);
    await write("source.txt", "unstaged\r\n");
    await write("new.txt", "untracked\0binary");
    const indexPath = await gitText(repo, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "index",
    ]);
    const rawIndex = await readFile(indexPath);
    const first = await begin();
    expect(first.before.status).toBe("complete");
    if (first.before.status !== "complete") throw new Error(first.before.reason);
    const before = first.before.snapshot;
    for (const phase of ["before-head", "before-index", "before-worktree"] as const)
      expect(await gitText(repo, ["cat-file", "-t", turnRef("workspace", "user-1", phase)])).toBe(
        "commit",
      );
    await turnGit(repo, ["add", "."]);
    await turnGit(repo, ["commit", "-m", "agent one"]);
    await write("source.txt", "agent second\n");
    await turnGit(repo, ["add", "."]);
    await turnGit(repo, ["commit", "-m", "agent two"]);
    await write("later.txt", "later untracked\n");
    await history.end({
      workspaceId: "workspace",
      sessionId: "session",
      userBlockId: "user-1",
      runId: "run-1",
    });
    await begin("user-2", "run-2");
    const rescue = await history.capture(workspace);
    await history.retain(workspace, rescue, [
      rewindRef("operation", "rescue-head"),
      rewindRef("operation", "rescue-index"),
      rewindRef("operation", "rescue-worktree"),
    ]);
    await history.restore(workspace, before, rescue);
    expect(await gitText(repo, ["rev-parse", "HEAD"])).toBe(before.head);
    expect(await readFile(indexPath)).toEqual(rawIndex);
    expect(await readFile(join(repo, "source.txt"), "utf8")).toBe("unstaged\r\n");
    expect(await gitText(repo, ["show", ":source.txt"])).toBe("staged");
    expect(await readFile(join(repo, "new.txt"), "utf8")).toBe("untracked\0binary");
    await expect(readFile(join(repo, "later.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    await history.restore(workspace, rescue, before);
    expect(await gitText(repo, ["rev-parse", "HEAD"])).toBe(rescue.head);
    expect(await readFile(join(repo, "later.txt"), "utf8")).toBe("later untracked\n");
    expect(await gitText(repo, ["rev-parse", rewindRef("operation", "rescue-head")])).toBe(
      rescue.head,
    );
    expect(
      (await history.list("workspace", "session")).map((record) => record.userBlockId),
    ).toEqual(["user-1", "user-2"]);
    expect(await gitText(repo, ["rev-parse", turnRef("workspace", "user-1", "before-head")])).toBe(
      before.head,
    );
  }, 120_000);

  it("protects ignored caches and sibling worktrees, including dirty sibling index", async () => {
    const sibling = join(root, "sibling");
    await turnGit(repo, ["worktree", "add", "-b", "sibling", sibling, "main"]);
    await writeFile(join(sibling, "source.txt"), "sibling staged");
    await turnGit(sibling, ["add", "."]);
    const siblingStatus = await turnGit(sibling, ["status", "--porcelain=v1", "-z"]);
    const first = await begin();
    if (first.before.status !== "complete") throw new Error(first.before.reason);
    await write("source.txt", "changed");
    await write("created.txt", "agent new");
    await mkdir(join(repo, "cache"));
    await write("cache/sentinel", "secret cache");
    const source = await history.capture(workspace);
    await history.restore(workspace, first.before.snapshot, source);
    expect(await readFile(join(repo, "cache/sentinel"), "utf8")).toBe("secret cache");
    expect(await readFile(join(sibling, "source.txt"), "utf8")).toBe("sibling staged");
    expect(await turnGit(sibling, ["status", "--porcelain=v1", "-z"])).toEqual(siblingStatus);
  }, 120_000);

  it("never deletes new unknown or changed captured paths", async () => {
    const first = await begin();
    if (first.before.status !== "complete") throw new Error(first.before.reason);
    await write("created.txt", "captured");
    const source = await history.capture(workspace);
    await write("created.txt", "external edit");
    await expect(history.restore(workspace, first.before.snapshot, source)).rejects.toThrow(
      "External content drift",
    );
    expect(await readFile(join(repo, "created.txt"), "utf8")).toBe("external edit");
    await write("created.txt", "captured");
    await write("unknown.txt", "outside capture");
    await expect(history.restore(workspace, first.before.snapshot, source)).rejects.toThrow(
      "External new path",
    );
  }, 120_000);

  it("refuses integration branches, sparse/split index and nested repositories with explicit capture status", async () => {
    workspace.targetBranchRef = workspace.branchRef;
    await expect(begin()).rejects.toThrow("integration branch");
    workspace.targetBranchRef = "refs/heads/main";
    await turnGit(repo, ["config", "core.sparseCheckout", "true"]);
    const sparse = await begin();
    expect(sparse.before).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("sparse"),
    });
    await turnGit(repo, ["config", "core.sparseCheckout", "false"]);
    expect((await begin()).before.status).toBe("complete");
    await turnGit(repo, ["update-index", "--split-index"]);
    const split = await begin("split");
    expect(split.before).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("split"),
    });
    await turnGit(repo, ["update-index", "--no-split-index"]);
    await mkdir(join(repo, "nested"));
    await turnGit(join(repo, "nested"), ["init"]);
    await write("nested/file.txt", "nested");
    const nested = await begin("nested");
    expect(nested.before.status).toBe("blocked");
  }, 120_000);

  it("captures assume-unchanged content and preserves the flag exactly", async () => {
    await turnGit(repo, ["update-index", "--assume-unchanged", "source.txt"]);
    await write("source.txt", "hidden modification");
    const before = await history.capture(workspace);
    await turnGit(repo, ["update-index", "--no-assume-unchanged", "source.txt"]);
    await write("source.txt", "after");
    const after = await history.capture(workspace);
    await history.restore(workspace, before, after);
    expect(await gitText(repo, ["ls-files", "-v", "source.txt"])).toMatch(/^h /);
    expect(await readFile(join(repo, "source.txt"), "utf8")).toBe("hidden modification");
  }, 120_000);

  it("validates ref components and refuses reused turn identities", async () => {
    expect(() => turnRef("../other", "turn", "before-head")).toThrow();
    expect(() => rewindRef("with/slash", "rescue-head")).toThrow();
    const first = await begin();
    expect(await begin()).toEqual(first);
    await expect(begin("user-1", "other-run")).rejects.toThrow("identity changed");
  }, 120_000);

  it("rewinds and undoes file/directory replacements without deleting ignored obstructions", async () => {
    const before = await history.capture(workspace);
    await rm(join(repo, "source.txt"));
    await mkdir(join(repo, "source.txt"));
    await write("source.txt/child.txt", "agent child");
    await turnGit(repo, ["add", "-A"]);
    await turnGit(repo, ["commit", "-m", "replace file with directory"]);
    const after = await history.capture(workspace);
    await mkdir(join(repo, "source.txt/cache"));
    await write("source.txt/cache/sentinel", "ignored unknown");
    await expect(history.restore(workspace, before, after)).rejects.toThrow(
      "Uncaptured directory obstruction",
    );
    expect(await gitText(repo, ["rev-parse", "HEAD"])).toBe(after.head);
    expect(await readFile(join(repo, "source.txt/cache/sentinel"), "utf8")).toBe("ignored unknown");
    await rm(join(repo, "source.txt/cache/sentinel"));
    await history.restore(workspace, before, after);
    expect(await readFile(join(repo, "source.txt"), "utf8")).toBe("base\n");
    await history.restore(workspace, after, before);
    expect(await readFile(join(repo, "source.txt/child.txt"), "utf8")).toBe("agent child");
  }, 300_000);

  it("reconciles an interrupted atomic file staging write using its durable ownership and blob content", async () => {
    const before = await history.capture(workspace);
    await write("source.txt", "after state");
    const after = await history.capture(workspace);
    await history.restore(workspace, before, after, "interrupted");
    await history.restore(workspace, after, before, "return-to-source");
    const ownership = JSON.parse(
      await readFile(join(root, "private/restores/interrupted.json"), "utf8"),
    );
    const temporary = ownership.temporaryPaths.find(
      (entry: { targetPath: string }) => entry.targetPath === "source.txt",
    ).path;
    await write(temporary, "external content");
    await expect(history.restore(workspace, before, after, "interrupted")).rejects.toThrow(
      "External restore staging content drift",
    );
    expect(await readFile(join(repo, temporary), "utf8")).toBe("external content");
    await write(temporary, "ba"); // prefix left by a terminated write; real source file is still intact
    await history.restore(workspace, before, after, "interrupted");
    expect(await readFile(join(repo, "source.txt"), "utf8")).toBe("base\n");
    await expect(readFile(join(repo, temporary))).rejects.toMatchObject({ code: "ENOENT" });
  }, 300_000);
});
