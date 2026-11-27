// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetRetainedState, useRetainedState } from "../../shared/hooks/useRetainedState";
import { checkoutStateKey } from "../../features/source-control/model/checkoutSelection";
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
/** Stands in for the worktree panel, which keeps the same retained keys; renders before the hook. */
function Panel({
  stateKey,
  lastUsed,
  graph,
}: {
  stateKey: string;
  lastUsed: string;
  graph: string;
}) {
  useRetainedState(`${stateKey}:last-used`, lastUsed);
  useRetainedState(`${stateKey}:sections`, graph);
  return null;
}
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

it("follows the first worktree with changes, like Graph's Auto, not the sum of all worktrees", async () => {
  data.modules = { "/trees/worker": ["/trees/worker/mobile"] };
  data.trees = data.trees.map((tree) => (tree.path === "/repo" ? { ...tree, dirty: true } : tree));
  Object.assign(FILES, { "/repo": 7, "/trees/worker": 3, "/trees/worker/mobile": 321 });
  await act(async () => root.render(createElement(View)));
  // The session's worktree leads the dirty sections; the other dirty worktree is not added.
  expect(data.multiple).toHaveBeenLastCalledWith(["/repo"], true);
  const result = JSON.parse(host.textContent!);
  expect(result.changeStats).toEqual({ files: 7, additions: 2, deletions: 1 });
  expect(result.changeScope.title).toBe("main");
  delete FILES["/repo"];
  delete FILES["/trees/worker"];
  delete FILES["/trees/worker/mobile"];
});

it.each([
  ["the row last used", "/trees/worker/mobile", "", ["/trees/worker", "/trees/worker/mobile"]],
  ["the Graph choice", "/trees/worker/mobile", "/repo", ["/repo"]],
  // A choice whose worktree is no longer a section (clean) is ignored.
  ["no stale choice", "/trees/clean", "/trees/clean", ["/repo"]],
])("follows %s of the panel", async (_name, lastUsed, graph, expected) => {
  data.modules = { "/trees/worker": ["/trees/worker/mobile"] };
  data.trees = data.trees.map((tree) => (tree.path === "/repo" ? { ...tree, dirty: true } : tree));
  const stateKey = checkoutStateKey(
    "/repo",
    data.trees.map((tree) => tree.path),
  );
  await act(async () =>
    root.render(
      createElement(
        "div",
        null,
        createElement(Panel, { stateKey, lastUsed, graph }),
        createElement(View),
      ),
    ),
  );
  // The badge counts the whole worktree of the followed row, with its separate repositories.
  expect(data.multiple).toHaveBeenLastCalledWith(expected, true);
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
  localStorage.setItem("bycoda.sourceControl.checkout.v1:/repo", "/trees/clean");
  await act(async () => root.render(createElement(View)));
  expect(JSON.parse(host.textContent!).changeScope.title).toBe("feature/worker");
});

it("follows the panel when the focused worktree is no longer listed", async () => {
  focus = { path: "/trees/gone", branch: "gone" };
  await act(async () => root.render(createElement(View)));
  expect(JSON.parse(host.textContent!).changeScope.title).toBe("feature/worker");
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
