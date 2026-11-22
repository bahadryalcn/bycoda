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

const FILES: Record<string, number> = {};
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
  data.multiple
    .mockReset()
    .mockImplementation((paths: string[]) =>
      paths.map((path) => ({ files: FILES[path] ?? 1, additions: 2, deletions: 1 })),
    );
  data.modules = { "/repo": ["/repo/mobile"], "/trees/worker": [] };
  data.limits = {};
  data.trees = [
    { path: "/repo", branch: "main", isMain: true, dirty: false, sessionIds: [] },
    { path: "/trees/worker", branch: "feature/worker", isMain: false, dirty: true, sessionIds: [] },
    { path: "/trees/clean", branch: "feature/clean", isMain: false, dirty: false, sessionIds: [] },
    {
      path: "/trees/unknown",
      branch: "feature/unknown",
      isMain: false,
      dirty: null,
      sessionIds: [],
    },
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

it("badges the sum of the sections: every worktree with changes and its separate repositories", async () => {
  data.modules = { "/trees/worker": ["/trees/worker/mobile"] };
  Object.assign(FILES, { "/trees/worker": 3, "/trees/worker/mobile": 321 });
  await act(async () => root.render(createElement(View)));
  // Only the worktree with known uncommitted changes is read, plus what is nested inside it.
  expect(data.discovery).toHaveBeenLastCalledWith(["/trees/worker"], true, true);
  expect(data.multiple).toHaveBeenLastCalledWith(["/trees/worker", "/trees/worker/mobile"], true);
  const result = JSON.parse(host.textContent!);
  // 3 + 321: equal to the section chips, with no cap.
  expect(result.changeStats).toEqual({ files: 324, additions: 4, deletions: 2 });
  expect(result.changeScope.title).toBe("All worktrees");
  delete FILES["/trees/worker"];
  delete FILES["/trees/worker/mobile"];
});

it("does not cap the total: four digits stay exact", async () => {
  FILES["/trees/worker"] = 1234;
  await act(async () => root.render(createElement(View)));
  expect(JSON.parse(host.textContent!).changeStats.files).toBe(1234);
  delete FILES["/trees/worker"];
});

it("never reads clean, ahead-only or unknown worktrees for the total", async () => {
  await act(async () => root.render(createElement(View)));
  for (const call of data.multiple.mock.calls) {
    expect(call[0]).not.toContain("/trees/clean");
    expect(call[0]).not.toContain("/trees/unknown");
  }
});

it("falls back to the session worktree when none has changes", async () => {
  data.trees = data.trees.map((tree) => ({ ...tree, dirty: false }));
  await act(async () => root.render(createElement(View)));
  expect(data.multiple).toHaveBeenLastCalledWith(["/repo", "/repo/mobile"], true);
});

it("follows a focused worktree, including the project folder", async () => {
  focus = { path: "/trees/clean", branch: "feature/clean" };
  await act(async () => root.render(createElement(View)));
  expect(data.discovery).toHaveBeenLastCalledWith(["/trees/clean"], true, true);
  expect(JSON.parse(host.textContent!).changeScopeLabel).toContain("clean");

  focus = { path: "/repo", branch: "main" };
  await act(async () => root.render(createElement(View)));
  expect(data.discovery).toHaveBeenLastCalledWith(["/repo"], true, true);
  expect(data.multiple).toHaveBeenLastCalledWith(["/repo", "/repo/mobile"], true);
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

it("keeps totals unknown until every section has a reading", async () => {
  data.modules = { "/trees/worker": ["/trees/worker/mobile"] };
  data.multiple.mockReturnValue([{ files: 1, additions: 2, deletions: 1 }, null]);
  await act(async () => root.render(createElement(View)));
  expect(JSON.parse(host.textContent!).changeStats).toBeNull();
});

it("uses the project root alone when only one worktree exists", async () => {
  data.trees = [data.trees[0]!];
  await act(async () => root.render(createElement(View)));
  expect(data.multiple).toHaveBeenLastCalledWith(["/repo", "/repo/mobile"], true);
  expect(JSON.parse(host.textContent!).changeScope).toBeNull();
});
