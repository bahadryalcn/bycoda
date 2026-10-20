import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { gitMutationScope, isHostGitMutation, withHostGitMutation } from "./git-mutations";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function repo() {
  const root = mkdtempSync(join(tmpdir(), "bycoda-git-queue-"));
  roots.push(root);
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "sub"));
  return root;
}

it("serializes complete operations across aliases and subdirectories, retaining request order", async () => {
  const root = repo();
  const alias = join(root, "alias");
  symlinkSync(join(root, "sub"), alias, process.platform === "win32" ? "junction" : "dir");
  const events: string[] = [];
  let release!: () => void;
  const first = withHostGitMutation(alias, async () => {
    events.push("first");
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    // A nested command retains the lease, even with another command waiting.
    await withHostGitMutation(root, async () => {
      events.push("nested");
    });
  });
  const second = withHostGitMutation(root, async () => {
    events.push("second");
  });
  const independent = withHostGitMutation(repo(), async () => {
    events.push("independent");
  });
  await independent;
  expect(events).toEqual(["first", "independent"]);
  release();
  await Promise.all([first, second]);
  expect(events).toEqual(["first", "independent", "nested", "second"]);
});

it("releases a failed operation and follows linked worktree gitdir pointers", async () => {
  const root = repo();
  const linked = join(root, "linked");
  mkdirSync(linked);
  const worktreeGit = join(root, ".git/worktrees/linked");
  mkdirSync(worktreeGit, { recursive: true });
  writeFileSync(join(worktreeGit, "commondir"), "../..\n");
  writeFileSync(join(linked, ".git"), "gitdir: ../.git/worktrees/linked\n");
  const events: string[] = [];
  const first = withHostGitMutation(linked, async () => {
    events.push("failed");
    throw new Error("failure");
  });
  const second = withHostGitMutation(root, async () => {
    events.push("next");
    return 42;
  });
  await expect(first).rejects.toThrow("failure");
  await expect(second).resolves.toBe(42);
  expect(events).toEqual(["failed", "next"]);
});

it("queues mutations while leaving polling and diff reads independent", () => {
  expect(gitMutationScope("git_fetch")).toBe("fetch");
  for (const command of ["git_commit", "git_stage_files", "git_stage_contents", "git_unstage_all"])
    expect(gitMutationScope(command)).toBe("local");
  for (const command of [
    "git_reset",
    "git_checkout",
    "git_rebase",
    "git_pull",
    "git_sync",
    "git_remote_remove",
    "git_worktree_create",
  ])
    expect(gitMutationScope(command)).toBe("exclusive");
  for (const command of [
    "git_commit",
    "git_pull",
    "git_sync",
    "git_stage_files",
    "git_discard_files",
    "git_resolve_conflict",
    "git_stash",
    "git_worktree_create",
  ])
    expect(isHostGitMutation(command)).toBe(true);
  for (const command of [
    "git_operation_status",
    "git_conflict_stages",
    "git_stash_list",
    "git_diff_index",
    "git_file_diff",
    "git_history",
    "list_dir",
  ])
    expect(isHostGitMutation(command)).toBe(false);
});

it("allows fetch beside local index work but fences exclusive operations and subsequent work", async () => {
  const root = repo();
  const events: string[] = [];
  let releaseFetch!: () => void;
  let fetchStarted!: () => void;
  const ready = new Promise<void>((resolve) => {
    fetchStarted = resolve;
  });
  const fetch = withHostGitMutation(
    root,
    async () => {
      events.push("fetch");
      fetchStarted();
      await new Promise<void>((resolve) => {
        releaseFetch = resolve;
      });
    },
    1000,
    "fetch",
  );
  await ready;
  await withHostGitMutation(
    root,
    async () => {
      events.push("commit");
    },
    1000,
    "local",
  );
  let releaseExclusive!: () => void;
  let exclusiveStarted!: () => void;
  const exclusiveReady = new Promise<void>((resolve) => {
    exclusiveStarted = resolve;
  });
  const exclusive = withHostGitMutation(root, async () => {
    events.push("checkout");
    exclusiveStarted();
    await new Promise<void>((resolve) => {
      releaseExclusive = resolve;
    });
  });
  const nextLocal = withHostGitMutation(
    root,
    async () => {
      events.push("stage");
    },
    1000,
    "local",
  );
  const nextFetch = withHostGitMutation(
    root,
    async () => {
      events.push("fetch2");
    },
    1000,
    "fetch",
  );
  expect(events).toEqual(["fetch", "commit"]);
  releaseFetch();
  await fetch;
  await exclusiveReady;
  expect(events).toEqual(["fetch", "commit", "checkout"]);
  releaseExclusive();
  await Promise.all([exclusive, nextLocal, nextFetch]);
  expect(events.slice(3).sort()).toEqual(["fetch2", "stage"]);
});

it("expires a waiting operation without executing it later or blocking subsequent work", async () => {
  const root = repo();
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const first = withHostGitMutation(root, async () => {
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  await ready;
  let ran = false;
  await expect(
    withHostGitMutation(
      root,
      async () => {
        ran = true;
      },
      20,
    ),
  ).rejects.toThrow(/not executed/);
  release();
  await first;
  await withHostGitMutation(root, async () => {});
  expect(ran).toBe(false);
});
