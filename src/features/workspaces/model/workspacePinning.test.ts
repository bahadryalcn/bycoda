import { beforeEach, expect, it, vi } from "vitest";
import type { ManagedWorkspace } from "./contracts";
import { remoteRequest } from "../../connections/model/connections";
import { requireWorkspaceCapability, resolveWorkspaceContext } from "./workspaceClient";
import { setWorkspacePinned } from "./workspacePinning";

vi.mock("../../connections/model/connections", () => ({ remoteRequest: vi.fn() }));
vi.mock("./workspaceClient", () => ({
  requireWorkspaceCapability: vi.fn(),
  resolveWorkspaceContext: vi.fn(),
  workspaceOperationKey: () => "fixture-key",
}));
const workspace: ManagedWorkspace = {
  id: "workspace",
  repositoryId: "repo",
  projectId: "project",
  environmentId: "env",
  owner: { kind: "session", id: "session" },
  path: "/worktrees/owned",
  branchRef: "refs/heads/bycoda/s/owned",
  baseRef: "refs/heads/main",
  baseCommit: "a".repeat(40),
  targetBranchRef: "refs/heads/main",
  state: "idle",
  directoryState: "present",
  revision: 7,
  lastActivityAt: 1,
  pinned: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireWorkspaceCapability).mockResolvedValue(undefined);
  vi.mocked(resolveWorkspaceContext).mockResolvedValue({
    cwd: "/project",
    projectId: "project",
    environmentId: "env",
    machineId: "machine",
  });
  vi.mocked(remoteRequest).mockResolvedValue({ ...workspace, revision: 8, pinned: true });
});
it("pins exactly the reviewed workspace revision through the authenticated owner transport", async () => {
  const result = await setWorkspacePinned(workspace, true, { cwd: "/project" }, "owner-pin-1");
  expect(requireWorkspaceCapability).toHaveBeenCalledWith("workspaces.pinning.v1", {
    cwd: "/project",
  });
  expect(remoteRequest).toHaveBeenCalledExactlyOnceWith(
    "machine",
    "workspaces.pin",
    { workspaceId: "workspace", expectedRevision: 7, idempotencyKey: "owner-pin-1", pinned: true },
    false,
    true,
  );
  expect(result).toMatchObject({ revision: 8, pinned: true });
});
it("does not dispatch when the execution Host lacks pinning", async () => {
  vi.mocked(requireWorkspaceCapability).mockRejectedValue(new Error("Update required"));
  await expect(setWorkspacePinned(workspace, true, { cwd: "/project" })).rejects.toThrow(
    "Update required",
  );
  expect(remoteRequest).not.toHaveBeenCalled();
});
it("refuses a workspace routed through a different execution project", async () => {
  vi.mocked(resolveWorkspaceContext).mockResolvedValue({
    cwd: "/other",
    projectId: "other-project",
    environmentId: "env",
    machineId: "machine",
  });
  await expect(setWorkspacePinned(workspace, true, { cwd: "/other" })).rejects.toThrow(
    "different execution project",
  );
  expect(remoteRequest).not.toHaveBeenCalled();
});
