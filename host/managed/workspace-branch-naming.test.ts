import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";
import { runGitAction, setManagedBranchRegistry } from "../git/git-actions";
import { MANAGED_DELIVERY_REVIEW_REQUIRED } from "../git/git-mutations";
import { projectRepositoryIdentity } from "../workspaces/workspace-policy";
import type { ManagedWorkspace } from "../workspaces/workspace-contracts";
import {
  isManagedWorkspaceBranch,
  managedWorkspaceNames,
  markManagedWorkspaceBranch,
  reconcileBranchRenames,
  renameManagedWorkspaceBranch,
} from "./workspace-branch-naming";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const run = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, windowsHide: true, stdio: "pipe" }).toString().trim();

async function fixture(options: { temporary?: string } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-naming-"));
  const repository = join(directory, "project");
  mkdirSync(repository);
  run(repository, "init", "-b", "main");
  run(repository, "config", "user.name", "Naming tests");
  run(repository, "config", "user.email", "naming@example.invalid");
  writeFileSync(join(repository, "source.txt"), "committed");
  run(repository, "add", ".");
  run(repository, "commit", "-m", "baseline");
  const temporary = options.temporary ?? "by/0a1b2c3d";
  const path = join(directory, "wt-0a1b2c3d4e5f");
  run(repository, "worktree", "add", "-b", temporary, path);
  const extraRepository = join(directory, "extra");
  mkdirSync(extraRepository);
  run(extraRepository, "init", "-b", "main");
  run(extraRepository, "config", "user.name", "Naming tests");
  run(extraRepository, "config", "user.email", "naming@example.invalid");
  writeFileSync(join(extraRepository, "e.txt"), "e");
  run(extraRepository, "add", ".");
  run(extraRepository, "commit", "-m", "baseline");
  const extraPath = join(directory, "extra-wt");
  run(extraRepository, "worktree", "add", "-b", temporary, extraPath);
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const project = await store.addProject(repository, "Project");
  const workspace: ManagedWorkspace = {
    id: "ws-1",
    projectId: project.id,
    repositoryId: await projectRepositoryIdentity(store, project.id),
    environmentId: "host",
    owner: { kind: "session", id: "session-1" },
    path,
    branchRef: `refs/heads/${temporary}`,
    baseRef: "refs/heads/main",
    baseCommit: run(repository, "rev-parse", "HEAD"),
    targetBranchRef: "refs/heads/main",
    state: "idle",
    directoryState: "present",
    revision: 0,
    lastActivityAt: 1,
    pinned: false,
  };
  await store.insertManagedWorkspace(workspace);
  await markManagedWorkspaceBranch(path, temporary, workspace.id);
  await markManagedWorkspaceBranch(extraPath, temporary, workspace.id);
  const request = (fragment: string, key = "k1", expectedRevision = 0) => ({
    workspaceId: workspace.id,
    expectedRevision,
    fragment,
    idempotencyKey: key,
  });
  return { store, repository, extraRepository, path, extraPath, workspace, request };
}

describe("managed workspace branch names", () => {
  it("uses by/<8hex> for sessions and by/<slug>-<8hex> for tasks", () => {
    const id = "12345678-1234-1234-1234-123456789012";
    expect(managedWorkspaceNames({ kind: "session", id: "a" }, "Fix it", id)).toEqual({
      branch: "by/12345678",
      directory: "wt-123456781234",
    });
    expect(managedWorkspaceNames({ kind: "task", id: "a" }, "../Türkçe ❄", id).branch).toBe(
      "by/t-rk-e-12345678",
    );
    expect(() => managedWorkspaceNames({ kind: "session", id: "a" }, "x", "bad/id")).toThrow(
      "identity",
    );
  });

  it("detects managed branches by the config marker, never the prefix", async () => {
    const { repository, path } = await fixture();
    run(repository, "branch", "by/hand-made");
    expect(await isManagedWorkspaceBranch(repository, "by/0a1b2c3d")).toBe(true);
    expect(await isManagedWorkspaceBranch(repository, "refs/heads/by/0a1b2c3d")).toBe(true);
    expect(await isManagedWorkspaceBranch(repository, "by/hand-made")).toBe(false);
    expect(await isManagedWorkspaceBranch(path, "main")).toBe(false);
  });

  it("runGitAction refuses a merge of a branch the registry owns even without a marker", async () => {
    const { repository } = await fixture();
    run(repository, "branch", "by/unmarked");
    setManagedBranchRegistry(async (_root, ref) => ref === "refs/heads/by/unmarked");
    try {
      await expect(
        runGitAction("git_merge", repository, { reference: "by/unmarked" }),
      ).rejects.toThrow(MANAGED_DELIVERY_REVIEW_REQUIRED);
    } finally {
      setManagedBranchRegistry(null);
    }
  });

  it("fails closed: an unreadable marker throws instead of reading as unmanaged", async () => {
    const { repository } = await fixture();
    await expect(
      isManagedWorkspaceBranch(join(repository, "does-not-exist"), "by/0a1b2c3d"),
    ).rejects.toThrow();
    const { path } = await fixture();
    // A sibling marker, or a marker that is not a workspace id, is not a primary marker.
    run(path, "config", "branch.by/0a1b2c3d.bycodaWorkspace", "sibling:ws-1");
    expect(await isManagedWorkspaceBranch(path, "by/0a1b2c3d")).toBe(false);
    expect(await isManagedWorkspaceBranch(path, "by/0a1b2c3d", "ws-1")).toBe(false);
  });
});

describe("renameManagedWorkspaceBranch", () => {
  it("renames the branch, moves the marker, bumps the revision and replays by key", async () => {
    const { store, repository, path, workspace, request } = await fixture();
    const result = await renameManagedWorkspaceBranch({ store }, request("Fix Login Bug!!"));
    expect(result).toEqual({
      branchRef: "refs/heads/by/fix-login-bug",
      renamed: true,
      revision: 1,
    });
    expect(run(path, "branch", "--show-current")).toBe("by/fix-login-bug");
    expect(await isManagedWorkspaceBranch(repository, "by/fix-login-bug")).toBe(true);
    expect(await isManagedWorkspaceBranch(repository, "by/0a1b2c3d")).toBe(false);
    const stored = await store.managedWorkspace(workspace.id);
    expect(stored).toMatchObject({ branchRef: "refs/heads/by/fix-login-bug", revision: 1 });
    expect(await renameManagedWorkspaceBranch({ store }, request("Fix Login Bug!!"))).toEqual(
      result,
    );
    expect((await store.managedWorkspace(workspace.id))?.revision).toBe(1);
  });

  it("sanitizes and truncates the fragment", async () => {
    const { store, request } = await fixture();
    const result = await renameManagedWorkspaceBranch(
      { store },
      request(`by/${"Very Long Title ".repeat(10)}`),
    );
    const name = result.branchRef.replace("refs/heads/by/", "");
    expect(name.length).toBeLessThanOrEqual(40);
    expect(name).toMatch(/^[a-z0-9-]+$/);
    expect(name.endsWith("-")).toBe(false);
  });

  it("suffixes -2 on collision and keeps the temporary name when every suffix is taken", async () => {
    const { store, repository, request } = await fixture();
    run(repository, "branch", "by/taken");
    expect(await renameManagedWorkspaceBranch({ store }, request("taken"))).toEqual({
      branchRef: "refs/heads/by/taken-2",
      renamed: true,
      revision: 1,
    });
    const full = await fixture();
    run(full.repository, "branch", "by/busy");
    for (let index = 2; index <= 9; index += 1) run(full.repository, "branch", `by/busy-${index}`);
    expect(await renameManagedWorkspaceBranch({ store: full.store }, full.request("busy"))).toEqual(
      { branchRef: "refs/heads/by/0a1b2c3d", renamed: false, revision: 0 },
    );
    expect(run(full.path, "branch", "--show-current")).toBe("by/0a1b2c3d");
  });

  it("renames sibling worktrees together and treats a sibling collision as taken", async () => {
    const { store, extraPath, extraRepository, request } = await fixture();
    expect(
      await renameManagedWorkspaceBranch(
        { store, siblings: async () => [{ repository: extraRepository, path: extraPath }] },
        request("shared"),
      ),
    ).toEqual({ branchRef: "refs/heads/by/shared", renamed: true, revision: 1 });
    expect(run(extraPath, "branch", "--show-current")).toBe("by/shared");
    // Siblings carry their own marker: guarded from removal, but mergeable by hand.
    expect(run(extraPath, "config", "branch.by/shared.bycodaWorkspace")).toBe("sibling:ws-1");
    const other = await fixture();
    run(other.extraPath, "branch", "by/shared");
    expect(
      await renameManagedWorkspaceBranch(
        {
          store: other.store,
          siblings: async () => [{ repository: other.extraRepository, path: other.extraPath }],
        },
        other.request("shared"),
      ),
    ).toEqual({ branchRef: "refs/heads/by/shared-2", renamed: true, revision: 1 });
  });

  it("refuses an active workspace, an upstream, a stale revision and pending operations", async () => {
    const active = await fixture();
    await expect(
      renameManagedWorkspaceBranch(
        { store: active.store, isActive: async () => true },
        active.request("x"),
      ),
    ).rejects.toThrow("idle");
    const upstream = await fixture();
    run(upstream.path, "config", "branch.by/0a1b2c3d.remote", "origin");
    await expect(
      renameManagedWorkspaceBranch({ store: upstream.store }, upstream.request("x")),
    ).rejects.toThrow("upstream");
    const tracking = await fixture();
    run(tracking.path, "config", "branch.by/0a1b2c3d.merge", "refs/heads/main");
    await expect(
      renameManagedWorkspaceBranch({ store: tracking.store }, tracking.request("x")),
    ).rejects.toThrow("upstream");
    expect(run(tracking.path, "branch", "--show-current")).toBe("by/0a1b2c3d");
  });

  it("treats expectedRevision as advisory: a heartbeat-bumped revision does not refuse the owner's rename", async () => {
    const { store, workspace, request, path } = await fixture();
    await store.updateManagedWorkspace({ ...workspace, revision: 1 }, 0);
    expect(await renameManagedWorkspaceBranch({ store }, request("x", "k", 0))).toMatchObject({
      renamed: true,
      revision: 2,
    });
    expect(run(path, "branch", "--show-current")).toBe("by/x");
  });

  it("journals the rename and startup finishes or reverts an interrupted one", async () => {
    const forward = await fixture();
    // Crash after Git renamed the primary and its sibling but before the registry update.
    await forward.store.saveWorkspaceBranchRename(forward.workspace.id, "by/0a1b2c3d", "by/later");
    run(forward.path, "branch", "-m", "by/0a1b2c3d", "by/later");
    await reconcileBranchRenames({
      store: forward.store,
      siblings: async () => [{ repository: forward.extraRepository, path: forward.extraPath }],
    });
    expect(run(forward.extraPath, "branch", "--show-current")).toBe("by/later");
    expect(await forward.store.managedWorkspace(forward.workspace.id)).toMatchObject({
      branchRef: "refs/heads/by/later",
      revision: 1,
    });
    expect(await forward.store.pendingWorkspaceBranchRenames()).toEqual([]);
    expect(await isManagedWorkspaceBranch(forward.repository, "by/later")).toBe(true);

    const back = await fixture();
    // Crash after only the sibling was renamed: the primary decides, the sibling goes back.
    await back.store.saveWorkspaceBranchRename(back.workspace.id, "by/0a1b2c3d", "by/later");
    run(back.extraPath, "branch", "-m", "by/0a1b2c3d", "by/later");
    await reconcileBranchRenames({
      store: back.store,
      siblings: async () => [{ repository: back.extraRepository, path: back.extraPath }],
    });
    expect(run(back.extraPath, "branch", "--show-current")).toBe("by/0a1b2c3d");
    expect((await back.store.managedWorkspace(back.workspace.id))?.branchRef).toBe(
      "refs/heads/by/0a1b2c3d",
    );
    expect(await back.store.pendingWorkspaceBranchRenames()).toEqual([]);
  });

  it("leaves a non-temporary branch alone", async () => {
    const { store, request } = await fixture({ temporary: "by/named-0a1b2c3d" });
    expect(await renameManagedWorkspaceBranch({ store }, request("other"))).toEqual({
      branchRef: "refs/heads/by/named-0a1b2c3d",
      renamed: false,
      revision: 0,
    });
  });
});
