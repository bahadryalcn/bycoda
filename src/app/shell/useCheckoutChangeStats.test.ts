// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetRetainedState } from "../../shared/hooks/useRetainedState";
import type { WorktreeFocus } from "../../features/source-control/model/worktreeFocus";
import type { Worktree } from "../../features/source-control/model/worktrees";
import { useCheckoutChangeStats } from "./useCheckoutChangeStats";

const data = vi.hoisted(() => ({
  modules: {} as Record<string, string[]>,
  discovery: vi.fn(),
  single: vi.fn(),
  multiple: vi.fn(),
  trees: [] as Worktree[],
  limits: {} as Record<string, string>,
}));
vi.mock("../../features/source-control/hooks/useGitSubmodules", () => ({
  useGitSubmodules: (...args: unknown[]) => {
    data.discovery(...args);
    return { modules: data.modules, limits: data.limits, refresh: vi.fn() };
  },
}));
vi.mock("../../features/source-control/hooks/useProjectWorktrees", () => ({
  useProjectWorktrees: () => ({ data: { worktrees: data.trees } }),
}));
vi.mock("../../features/source-control/hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: (...args: unknown[]) => data.single(...args),
  useProjectsDiffStats: (...args: unknown[]) => data.multiple(...args),
}));
vi.mock("../../features/projects/model/recents", () => ({
  sameProjectPath: (left: string, right: string) => left === right,
}));

let focus: WorktreeFocus | undefined;
let root: Root;
let host: HTMLDivElement;
function View() {
  const result = useCheckoutChangeStats({
    gitRoot: "/repo",
    repositoryPaths: undefined,
    focus,
    active: true,
  });
  return createElement("output", null, JSON.stringify(result));
}
beforeEach(() => {
  resetRetainedState();
  focus = undefined;
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  data.discovery.mockClear();
  data.single.mockReset().mockReturnValue({ files: 1, additions: 2, deletions: 1 });
  data.multiple
    .mockReset()
    .mockImplementation((paths: string[]) =>
      paths.map(() => ({ files: 1, additions: 2, deletions: 1 })),
    );
  data.modules = { "/repo": ["/repo/mobile"], "/trees/worker": [] };
  data.limits = {};
  data.trees = [
    { path: "/repo", branch: "main", isMain: true, sessionIds: [] },
    { path: "/trees/worker", branch: "feature/worker", isMain: false, sessionIds: [] },
  ] as Worktree[];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("totals every worktree by default with plain diff stats and no repository discovery", async () => {
  await act(async () => root.render(createElement(View)));
  expect(data.discovery).not.toHaveBeenCalled();
  expect(data.multiple).toHaveBeenLastCalledWith(["/repo", "/trees/worker"], true);
  expect(data.single).toHaveBeenLastCalledWith("/repo", false);
  const result = JSON.parse(host.textContent!);
  expect(result.changeStats).toEqual({ files: 2, additions: 4, deletions: 2 });
  expect(result.changeScope.title).toBe("All worktrees");
});

it("follows a focused worktree, including the project folder", async () => {
  focus = { path: "/trees/worker", branch: "feature/worker" };
  await act(async () => root.render(createElement(View)));
  expect(data.single).toHaveBeenLastCalledWith("/trees/worker", true);
  expect(data.multiple).toHaveBeenLastCalledWith([], false);
  expect(JSON.parse(host.textContent!).changeScopeLabel).toContain("worker");

  focus = { path: "/repo", branch: "main" };
  await act(async () => root.render(createElement(View)));
  expect(data.single).toHaveBeenLastCalledWith("/repo", true);
  expect(data.discovery).not.toHaveBeenCalled();
});

it("ignores the legacy stored Changes selection", async () => {
  localStorage.setItem("bycoda.sourceControl.checkout.v1:/repo", "/trees/worker");
  await act(async () => root.render(createElement(View)));
  expect(JSON.parse(host.textContent!).changeScope.title).toBe("All worktrees");
});

it("shows the overview when the focused worktree is no longer listed", async () => {
  focus = { path: "/trees/gone", branch: "gone" };
  await act(async () => root.render(createElement(View)));
  expect(JSON.parse(host.textContent!).changeScope.title).toBe("All worktrees");
});

it("keeps totals unknown until every worktree has a reading", async () => {
  data.multiple.mockReturnValue([{ files: 1, additions: 2, deletions: 1 }, null]);
  await act(async () => root.render(createElement(View)));
  expect(JSON.parse(host.textContent!).changeStats).toBeNull();
});

it("uses the project root alone when only one worktree exists", async () => {
  data.trees = [data.trees[0]!];
  await act(async () => root.render(createElement(View)));
  expect(data.single).toHaveBeenLastCalledWith("/repo", true);
  expect(JSON.parse(host.textContent!).changeScope).toBeNull();
});
