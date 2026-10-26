// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { loadWorkspaceCreation } from "./workspaceCreation";
import { requireWorkspaceCapability, workspaceRequest } from "./workspaceClient";
import { listWorktrees } from "../../source-control/model/worktrees";
import { fetchGitIndex } from "../../source-control/model/gitIndexStore";
import { gitHistory } from "../../../platform/tauri/fs";

vi.mock("./workspaceClient", () => ({
  resolveWorkspaceContext: vi.fn(async () => ({
    cwd: "/project",
    projectId: "project-id",
    environmentId: "environment",
  })),
  requireWorkspaceCapability: vi.fn(async () => {}),
  workspaceRequest: vi.fn(async () => ({
    resolved: { policy: { defaultMode: "worktree", integrationBranchRef: "refs/heads/main" } },
  })),
}));
vi.mock("../../source-control/model/worktrees", () => ({ listWorktrees: vi.fn() }));
vi.mock("../../source-control/model/gitIndexStore", () => ({ fetchGitIndex: vi.fn() }));
vi.mock("../../../platform/tauri/fs", () => ({
  gitHistory: vi.fn(),
  subscribeGitChanged: vi.fn(() => () => {}),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireWorkspaceCapability).mockResolvedValue(undefined);
  vi.mocked(listWorktrees).mockResolvedValue({
    defaultRoot: "/worktrees",
    worktrees: [{ path: "/project", branch: "main", head: "main-sha", isMain: true }],
  } as never);
  vi.mocked(fetchGitIndex).mockResolvedValue({
    head: "main-sha",
    branch: "main",
    files: [{ relative: "one" }, { relative: "one" }, { relative: "two" }],
    conflicts: [{ relative: "conflict" }],
  } as never);
  vi.mocked(gitHistory).mockResolvedValue({ head: "main-sha", commits: [] });
});

it("previews the committed policy baseline and counts unique excluded paths including conflicts", async () => {
  const result = await loadWorkspaceCreation("/project");
  expect(result.preview).toEqual({
    baseRef: "refs/heads/main",
    baseCommit: "main-sha",
    excludedPaths: 3,
  });
  expect(workspaceRequest).toHaveBeenCalledWith(
    "projects.workspacePolicy.get",
    { projectId: "project-id", environmentId: "environment" },
    expect.anything(),
  );
  expect(workspaceRequest).toHaveBeenCalledTimes(1);
});

it("looks up an explicitly selected remote branch without creating a worktree", async () => {
  vi.mocked(gitHistory).mockResolvedValue({
    head: "main-sha",
    commits: [{ sha: "release-sha", refs: [{ name: "origin/release", kind: "remote" }] }],
  } as never);
  expect((await loadWorkspaceCreation("/project", "origin/release")).preview.baseCommit).toBe(
    "release-sha",
  );
  expect(workspaceRequest).toHaveBeenCalledTimes(1);
});

it("never presents an unavailable Git status as zero excluded paths", async () => {
  vi.mocked(fetchGitIndex).mockRejectedValue(new Error("Git status unavailable"));
  await expect(loadWorkspaceCreation("/project")).rejects.toThrow("Git status unavailable");
});

it("requires an update before reading or preparing workspaces on an older Host", async () => {
  vi.mocked(requireWorkspaceCapability).mockRejectedValue(new Error("Update bycoda Host"));
  await expect(loadWorkspaceCreation("/project")).rejects.toThrow("Update bycoda Host");
  expect(workspaceRequest).not.toHaveBeenCalled();
  expect(listWorktrees).not.toHaveBeenCalled();
});
