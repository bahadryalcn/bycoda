// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { GitGraphWorkspace } from "./GitGraphWorkspace";

// Regression for #1277: the Git graph header names its branch through the shared
// MiddleTruncate pattern, so long names that differ at the end stay distinguishable.
const branch = "by/fix-the-long-shared-prefix-branch-name-that-differs-at-the-end";

vi.mock("../../../platform/tauri/fs", () => ({
  gitDiffIndex: vi.fn(async () => ({
    files: [],
    conflicts: [],
    branch,
    head: "abc1234def",
    ahead: 0,
    behind: 0,
  })),
  gitFetch: vi.fn(),
  gitPull: vi.fn(),
  gitPush: vi.fn(),
  gitStash: vi.fn(),
  gitStageAll: vi.fn(),
  gitUnstageAll: vi.fn(),
  notifyGitChanged: vi.fn(),
  subscribeGitChanged: vi.fn(() => () => {}),
}));
vi.mock("../../connections/public/remoteCapabilities", () => ({
  GIT_ACTIONS: "git.actions",
  GIT_CONFLICTS: "git.conflicts",
  useRemoteSupports: () => true,
}));
vi.mock("../../connections/public/remoteHealth", () => ({
  useRemoteLoadFailure: () => undefined,
  reportRemoteLoad: vi.fn(),
}));
vi.mock("./GitGraphBranches", () => ({ GitGraphBranches: () => null }));
vi.mock("./GitGraphCommitInspector", () => ({ GitGraphCommitInspector: () => null }));
vi.mock("./GitGraphConflictEditor", () => ({ GitGraphConflictEditor: () => null }));
vi.mock("./GitChangesPanel", () => ({ GitChangesPanel: () => null }));
vi.mock("./WorkingTreeDiff", () => ({ WorkingTreeDiff: () => null }));
vi.mock("./GitStashSection", () => ({ GitStashSection: () => null }));

it("shows the graph header branch through MiddleTruncate with the full name once", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(GitGraphWorkspace, {
          cwd: "/repo",
          onCommit: () => {},
          onBranch: () => {},
          onDirty: () => {},
          graph: null,
        }),
      ),
    );
    const truncated = container.querySelector("[data-middle-truncate]");
    expect(truncated).not.toBeNull();
    expect(truncated!.textContent).toContain(branch);
    expect(container.innerHTML.split(branch).length - 1).toBe(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
