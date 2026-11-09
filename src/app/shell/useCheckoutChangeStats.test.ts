// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetRetainedState } from "../../shared/hooks/useRetainedState";
import {
  checkoutSelectionScope,
  saveCheckoutSelection,
} from "../../features/source-control/model/checkoutSelection";
import type { Worktree } from "../../features/source-control/model/worktrees";
import { useCheckoutChangeStats } from "./useCheckoutChangeStats";

const data = vi.hoisted(() => ({
  modules: {} as Record<string, string[]>,
  discovery: vi.fn(),
  single: vi.fn(),
  multiple: vi.fn(),
  trees: [] as Worktree[],
}));
vi.mock("../../features/source-control/hooks/useGitSubmodules", () => ({
  useGitSubmodules: (...args: unknown[]) => {
    data.discovery(...args);
    return { modules: data.modules, refresh: vi.fn() };
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

let root: Root;
let host: HTMLDivElement;
function View() {
  const result = useCheckoutChangeStats({
    gitRoot: "/repo",
    repositoryPaths: undefined,
    active: true,
  });
  return createElement("output", null, JSON.stringify(result));
}
beforeEach(() => {
  resetRetainedState();
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

it("counts discovered independent repositories in All checkouts without duplicate roots", async () => {
  saveCheckoutSelection(
    checkoutSelectionScope(
      "/repo",
      data.trees.map((tree) => tree.path),
    ),
    "",
  );
  await act(async () => root.render(createElement(View)));
  expect(data.discovery).toHaveBeenCalledWith(["/repo", "/trees/worker"], true, true);
  expect(data.multiple).toHaveBeenCalledWith(["/repo", "/repo/mobile", "/trees/worker"], true);
  expect(JSON.parse(host.textContent!).changeStats).toEqual({
    files: 3,
    additions: 6,
    deletions: 3,
  });
});

it("keeps a selected child repository as the Changes tab target", async () => {
  saveCheckoutSelection(
    checkoutSelectionScope(
      "/repo",
      data.trees.map((tree) => tree.path),
    ),
    "/repo/mobile",
  );
  await act(async () => root.render(createElement(View)));
  expect(data.single).toHaveBeenCalledWith("/repo/mobile", true);
  expect(JSON.parse(host.textContent!).changeScopeLabel).toContain("mobile");
});

it("keeps All totals unknown until every repository has a reading", async () => {
  saveCheckoutSelection(
    checkoutSelectionScope(
      "/repo",
      data.trees.map((tree) => tree.path),
    ),
    "",
  );
  data.multiple.mockReturnValue([
    { files: 1, additions: 2, deletions: 1 },
    null,
    { files: 1, additions: 2, deletions: 1 },
  ]);
  await act(async () => root.render(createElement(View)));
  expect(JSON.parse(host.textContent!).changeStats).toBeNull();
});

it("does not label root-only totals as complete before child discovery finishes", async () => {
  saveCheckoutSelection(
    checkoutSelectionScope(
      "/repo",
      data.trees.map((tree) => tree.path),
    ),
    "",
  );
  data.modules = {};
  await act(async () => root.render(createElement(View)));
  expect(JSON.parse(host.textContent!).changeStats).toBeNull();
});
