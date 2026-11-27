import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  remoteRequest: vi.fn(),
  remoteMachineFor: vi.fn(),
  hostProjectFor: vi.fn(),
  requireRemoteSupport: vi.fn(),
  notifyMachineGitChanged: vi.fn(),
  notifyGitChanged: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../connections/public/connections", () => ({
  remoteMachineFor: mocks.remoteMachineFor,
  remoteRequest: mocks.remoteRequest,
}));
vi.mock("../../automations/public/hostMachines", () => ({ hostProjectFor: mocks.hostProjectFor }));
vi.mock("../../connections/public/remoteCapabilities", () => ({
  requireRemoteSupport: mocks.requireRemoteSupport,
}));
vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  notifyMachineGitChanged: mocks.notifyMachineGitChanged,
  notifyGitChanged: mocks.notifyGitChanged,
}));
import { checkWorktreeRemoval, removeWorktree, reviewWorktreeRemoval } from "./worktrees";
import {
  createProjectWorktree as createWorktree,
  removeRemoteWorktree,
  reviewRemoteWorktreeRemoval,
} from "./remoteWorktrees";

const PROJECT = "remote://env-b/home/me/app";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.remoteMachineFor.mockResolvedValue({ id: "machine-b", environmentId: "env-b" });
  mocks.hostProjectFor.mockResolvedValue({ id: "project-b", cwd: "/home/me/app" });
  mocks.remoteRequest.mockResolvedValue({
    path: "/home/me/app-worktrees/feature",
    branch: "feature",
    head: "abc",
    isMain: false,
    missing: false,
  });
});

describe("remote worktree creation", () => {
  it("creates on the machine that owns the project, never through this computer", async () => {
    const tree = await createWorktree(PROJECT, "feature", "main", false);
    expect(mocks.remoteMachineFor).toHaveBeenCalledWith("env-b");
    expect(mocks.hostProjectFor).toHaveBeenCalledWith(
      expect.objectContaining({ id: "machine-b" }),
      PROJECT,
    );
    expect(mocks.remoteRequest).toHaveBeenCalledWith(
      "machine-b",
      "git.worktreeCreate",
      { projectId: "project-b", branch: "feature", base: "main", existing: false },
      false,
      true,
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.notifyMachineGitChanged).toHaveBeenCalledWith("env-b");
    expect(tree).toMatchObject({
      path: "remote://env-b/home/me/app-worktrees/feature",
      branch: "feature",
      isMain: false,
    });
  });

  it("fails visibly when the owning machine is not connected", async () => {
    mocks.remoteMachineFor.mockResolvedValue(undefined);
    await expect(createWorktree(PROJECT, "feature", "main", false)).rejects.toThrow(
      "isn’t connected",
    );
    expect(mocks.remoteRequest).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("keeps a local project on the native command", async () => {
    mocks.invoke.mockResolvedValue({ path: "/repo-wt/feature" });
    await createWorktree("/repo", "feature", "HEAD", true);
    expect(mocks.invoke).toHaveBeenCalledWith("git_worktree_create", {
      cwd: "/repo",
      branch: "feature",
      base: "HEAD",
      existing: true,
    });
    expect(mocks.remoteRequest).not.toHaveBeenCalled();
  });
});

describe("remote worktree removal", () => {
  it("uses the owning Host and passes the reviewed token and explicit force", async () => {
    const path = "/home/me/app-worktrees/feature";
    const tree = `remote://env-b${path}`;
    mocks.remoteRequest.mockResolvedValueOnce({ token: "review-token" });
    const review = await reviewRemoteWorktreeRemoval(PROJECT, tree);
    await removeRemoteWorktree(PROJECT, tree, review, true, true);
    expect(mocks.remoteRequest).toHaveBeenNthCalledWith(
      1,
      "machine-b",
      "git.worktreeRemovalReview",
      { projectId: "project-b", path },
      true,
      true,
      "env-b",
    );
    expect(mocks.remoteRequest).toHaveBeenNthCalledWith(
      2,
      "machine-b",
      "git.worktreeRemove",
      { projectId: "project-b", path, token: "review-token", force: true, keepSessions: true },
      false,
      true,
      "env-b",
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.notifyMachineGitChanged).toHaveBeenCalledWith("env-b");
    expect(mocks.requireRemoteSupport).toHaveBeenCalledWith(PROJECT, "git.worktreeRemoval.v1");
  });

  it("stops before calling a Host without removal support", async () => {
    mocks.requireRemoteSupport.mockRejectedValueOnce(new Error("Host update needed"));
    await expect(reviewRemoteWorktreeRemoval(PROJECT, "remote://env-b/repo/wt")).rejects.toThrow(
      "Host update needed",
    );
    expect(mocks.remoteRequest).not.toHaveBeenCalled();
  });

  it("refuses a target owned by another Host", async () => {
    await expect(reviewRemoteWorktreeRemoval(PROJECT, "remote://env-c/repo/wt")).rejects.toThrow();
    expect(mocks.remoteRequest).not.toHaveBeenCalled();
  });

  it("refuses review, preflight and removal instead of touching a local folder", async () => {
    const tree = "remote://env-b/home/me/app-worktrees/feature";
    await expect(reviewWorktreeRemoval(PROJECT, tree)).rejects.toThrow("Deleting worktrees");
    await expect(checkWorktreeRemoval(PROJECT, tree, false)).rejects.toThrow("Deleting worktrees");
    await expect(removeWorktree(PROJECT, tree)).rejects.toThrow("Deleting worktrees");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
