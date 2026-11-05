import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileAsync as exec } from "../../../src/shared/lib/processExecution.node";
import { hostBranches, createHostBranch, switchHostBranch } from "../../git/git-branches";
import {
  hostWorktrees,
  resolveHostWorktreeAsync,
  createHostWorktree,
} from "../../git/git-worktrees";
import { withHostGitMutation } from "../../git/git-mutations";
import { hostGitAction, hostGitIndex, hostFileDiff } from "../../workspaces/workspace";
import { createHostGitService, type HostGitServicePorts } from "./service";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-git-domain-"));
  roots.push(root);
  const git = (...args: string[]) => exec("git", args, { cwd: root, windowsHide: true });
  await git("init", "-b", "main");
  await writeFile(join(root, "file.txt"), "fixture\n");
  const release = vi.fn(async () => {});
  const ports: HostGitServicePorts = {
    project: async () => ({ id: "project", cwd: root }),
    resolveWorktree: resolveHostWorktreeAsync,
    withIdleProject: async (_id, work) => work(),
    serializeMutation: (cwd, work, scope) => withHostGitMutation(cwd, work, undefined, scope),
    startActivity: vi.fn(async () => release),
    invalidateRoots: vi.fn(),
    diff: async (cwd) =>
      (await exec("git", ["diff", "--", "."], { cwd, windowsHide: true })).stdout,
    branches: hostBranches,
    switch: switchHostBranch,
    createBranch: createHostBranch,
    worktrees: hostWorktrees,
    worktreeCreate: createHostWorktree,
    index: hostGitIndex,
    fileDiff: hostFileDiff,
    action: hostGitAction,
  };
  const context = { authorized: vi.fn(async () => true) };
  return { root, git, ports, context, release, service: createHostGitService(ports) };
}
it("uses real repository owners for reads and index mutations, preserving strict/legacy params", async () => {
  const f = await fixture();
  expect(await f.service.branches({ projectId: "project" }, f.context)).toMatchObject({
    current: "main",
  });
  await expect(
    f.service.branches({ projectId: "project", extra: true }, f.context),
  ).rejects.toThrow();
  await f.service.branches({ projectId: "project", extra: true }, f.context, { legacy: true });
  await f.service.action({ projectId: "project", action: "stage", path: "file.txt" }, f.context);
  expect((await f.git("diff", "--cached", "--name-only")).stdout.trim()).toBe("file.txt");
  expect(f.release).toHaveBeenCalledTimes(1);
});
it("rejects foreign checkout and traversal before any owner mutation", async () => {
  const f = await fixture(),
    other = await fixture();
  const action = vi.spyOn(f.ports, "action");
  await expect(
    f.service.action({ projectId: "project", cwd: other.root, action: "stageAll" }, f.context),
  ).rejects.toThrow();
  await expect(
    f.service.action({ projectId: "project", action: "stage", path: "../outside" }, f.context),
  ).rejects.toThrow();
  expect(action).toHaveBeenCalledTimes(1); // Owner's safeGitPath rejects the relative escape.
  expect((await f.git("ls-files")).stdout).toBe("");
});
it("rechecks a revoked device after the real repository mutex without staging", async () => {
  const f = await fixture(),
    entered = gate(),
    release = gate();
  const blocker = withHostGitMutation(f.root, async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const queued = gate();
  const serialize = f.ports.serializeMutation;
  f.ports.serializeMutation = (cwd, work, scope) => {
    queued.resolve();
    return serialize(cwd, work, scope);
  };
  const action = vi.spyOn(f.ports, "action");
  const pending = f.service.action({ projectId: "project", action: "stageAll" }, f.context);
  await queued.promise;
  f.context.authorized.mockResolvedValue(false);
  release.resolve();
  await blocker;
  await expect(pending).rejects.toThrow("revoked");
  expect(action).not.toHaveBeenCalled();
  expect(f.release).toHaveBeenCalledTimes(1);
  expect((await f.git("ls-files")).stdout).toBe("");
});
it("rechecks idle-project wait and refuses delayed query disclosure", async () => {
  const f = await fixture();
  f.ports.withIdleProject = async (_id, work) => {
    f.context.authorized.mockResolvedValue(false);
    return work();
  };
  const action = vi.spyOn(f.ports, "action");
  await expect(
    f.service.action({ projectId: "project", action: "stageAll" }, f.context),
  ).rejects.toThrow("revoked");
  expect(action).not.toHaveBeenCalled();
  f.context.authorized.mockResolvedValue(true);
  f.ports.branches = async () => {
    f.context.authorized.mockResolvedValue(false);
    return { current: "main", branches: [], remotes: [] };
  };
  await expect(f.service.branches({ projectId: "project" }, f.context)).rejects.toThrow("revoked");
});
it("never replays an owner failure and releases workspace activity", async () => {
  const f = await fixture();
  f.ports.action = vi.fn(async () => {
    throw new Error("uncertain effect");
  });
  await expect(
    f.service.action({ projectId: "project", action: "commit", message: "fixture" }, f.context),
  ).rejects.toThrow("uncertain effect");
  expect(f.ports.action).toHaveBeenCalledTimes(1);
  expect(f.release).toHaveBeenCalledTimes(1);
});
