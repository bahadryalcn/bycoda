// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadWorkspaceCreation, useWorkspaceCreation } from "./workspaceCreation";
import {
  requireWorkspaceCapability,
  resolveWorkspaceContext,
  workspaceRequest,
  WorkspaceCapabilityError,
} from "./workspaceClient";
import { listWorktrees } from "../../source-control/model/worktrees";
import { fetchGitIndex } from "../../source-control/model/gitIndexStore";
import { gitHistory } from "../../../platform/tauri/fs";
import { notifyRemoteRecovered } from "../../connections/model/remoteHealth";
import { remotePath } from "../../connections/model/remoteProjects";
import { invalidateMachineSnapshot } from "../../automations/model/machineSnapshot";
import type { WorkspaceMode } from "../../sessions/model/session";

const capabilityListeners = vi.hoisted(() => new Set<() => void>());
vi.mock("../../connections/model/connections", () => ({
  subscribeRemoteCapabilities: (listener: () => void) => {
    capabilityListeners.add(listener);
    return () => capabilityListeners.delete(listener);
  },
}));
vi.mock("../../automations/model/machineSnapshot", () => ({
  invalidateMachineSnapshot: vi.fn(),
}));

vi.mock("./workspaceClient", () => ({
  resolveWorkspaceContext: vi.fn(async () => ({
    cwd: "/project",
    projectId: "project-id",
    environmentId: "environment",
  })),
  WorkspaceCapabilityError: class extends Error {},
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
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

let root: Root | undefined;
let state: ReturnType<typeof useWorkspaceCreation>;
function Probe({ choice, cwd, active }: { choice?: WorkspaceMode; cwd: string; active: boolean }) {
  state = useWorkspaceCreation(cwd, active, choice);
  return null;
}
async function renderCreation(choice?: WorkspaceMode, cwd = "/project", active = true) {
  root ??= createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe, { choice, cwd, active })));
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  expect(capabilityListeners.size).toBe(0);
  vi.unstubAllGlobals();
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

it("skips all managed reads for an explicit current checkout on an older Host", async () => {
  vi.mocked(requireWorkspaceCapability).mockRejectedValue(new Error("Update bycoda Host"));
  await renderCreation("current");
  expect(state).toMatchObject({
    mode: "current",
    pending: false,
    error: undefined,
    preview: undefined,
  });
  expect(resolveWorkspaceContext).not.toHaveBeenCalled();
  expect(requireWorkspaceCapability).not.toHaveBeenCalled();
  expect(workspaceRequest).not.toHaveBeenCalled();
  await act(async () => {
    notifyRemoteRecovered();
    capabilityListeners.forEach((listener) => listener());
  });
  expect(requireWorkspaceCapability).not.toHaveBeenCalled();
});

it("retains a stable update-required classification independently of the error text", async () => {
  const error = new WorkspaceCapabilityError();
  error.message = "Host needs an update";
  vi.mocked(requireWorkspaceCapability).mockRejectedValue(error);
  await renderCreation();
  expect(state).toMatchObject({ updateRequired: true, error: "Host needs an update" });
  await renderCreation("current");
  expect(state.updateRequired).toBe(false);
});

it.each([undefined, "worktree"] as const)(
  "keeps %s mode blocked until the Host supports managed workspaces",
  async (choice) => {
    vi.mocked(requireWorkspaceCapability).mockRejectedValue(new Error("Update bycoda Host"));
    await renderCreation(choice);
    expect(state).toMatchObject({ mode: "worktree", pending: false, error: "Update bycoda Host" });
    expect(workspaceRequest).not.toHaveBeenCalled();
  },
);

it("clears a managed error when the owner chooses current and checks again when they choose worktree", async () => {
  vi.mocked(requireWorkspaceCapability).mockRejectedValue(new Error("Update bycoda Host"));
  await renderCreation();
  expect(state.error).toBe("Update bycoda Host");
  await renderCreation("current");
  expect(state).toMatchObject({ mode: "current", pending: false, error: undefined });
  expect(requireWorkspaceCapability).toHaveBeenCalledTimes(1);
  await renderCreation("worktree");
  expect(state.error).toBe("Update bycoda Host");
  expect(requireWorkspaceCapability).toHaveBeenCalledTimes(2);
});

it("reloads a remote project after its Host recovers without reacting to another remote machine", async () => {
  const cwd = remotePath("environment", "/project");
  vi.mocked(requireWorkspaceCapability).mockRejectedValue(new Error("Update bycoda Host"));
  await renderCreation(undefined, cwd);
  expect(state.error).toBe("Update bycoda Host");
  vi.mocked(requireWorkspaceCapability).mockResolvedValue(undefined);
  await act(async () => notifyRemoteRecovered("another-environment"));
  expect(requireWorkspaceCapability).toHaveBeenCalledTimes(1);
  expect(state.error).toBe("Update bycoda Host");
  await act(async () => notifyRemoteRecovered("environment"));
  expect(state).toMatchObject({
    pending: false,
    error: undefined,
    preview: { baseCommit: "main-sha" },
  });
  expect(requireWorkspaceCapability).toHaveBeenCalledTimes(2);
});

it("reloads local creation after a Host upgrade and invalidates cached capabilities on descriptor changes", async () => {
  vi.mocked(requireWorkspaceCapability).mockRejectedValue(new Error("Update bycoda Host"));
  await renderCreation();
  vi.mocked(requireWorkspaceCapability).mockResolvedValue(undefined);
  await act(async () => notifyRemoteRecovered("local-environment"));
  expect(state.error).toBeUndefined();
  expect(state.preview?.baseCommit).toBe("main-sha");
  vi.mocked(requireWorkspaceCapability).mockRejectedValue(new Error("Update bycoda Host"));
  await act(async () => capabilityListeners.forEach((listener) => listener()));
  expect(invalidateMachineSnapshot).toHaveBeenCalledTimes(1);
  expect(state.error).toBe("Update bycoda Host");
  vi.mocked(requireWorkspaceCapability).mockResolvedValue(undefined);
  await act(async () => capabilityListeners.forEach((listener) => listener()));
  expect(invalidateMachineSnapshot).toHaveBeenCalledTimes(2);
  expect(state.error).toBeUndefined();
});

it("ignores an older load that fails after the owner selects current checkout", async () => {
  let reject!: (reason: Error) => void;
  vi.mocked(requireWorkspaceCapability).mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await renderCreation();
  expect(state.pending).toBe(true);
  await renderCreation("current");
  await act(async () => reject(new Error("Old Host error")));
  expect(state).toMatchObject({
    mode: "current",
    pending: false,
    error: undefined,
    preview: undefined,
  });
  expect(workspaceRequest).not.toHaveBeenCalled();
});

it("ignores a stale failed request after a newer recovery load succeeds", async () => {
  let reject!: (reason: Error) => void;
  vi.mocked(requireWorkspaceCapability).mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await renderCreation();
  await act(async () => notifyRemoteRecovered());
  expect(state.preview?.baseCommit).toBe("main-sha");
  await act(async () => reject(new Error("Old Host error")));
  expect(state.error).toBeUndefined();
  expect(state.preview?.baseCommit).toBe("main-sha");
});

it("settles when the capability read itself announces a new descriptor", async () => {
  vi.mocked(requireWorkspaceCapability).mockImplementationOnce(async () => {
    capabilityListeners.forEach((listener) => listener());
  });
  await renderCreation();
  expect(state).toMatchObject({
    pending: false,
    error: undefined,
    preview: { baseCommit: "main-sha" },
  });
  expect(requireWorkspaceCapability).toHaveBeenCalledTimes(2);
  expect(invalidateMachineSnapshot).toHaveBeenCalledTimes(1);
});
