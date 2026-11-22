import { expect, it } from "vitest";
import { worktreeRows } from "./worktreeRows";
import type { Worktree } from "./worktrees";

const tree = (path: string, extra: Partial<Worktree> = {}): Worktree => ({
  path,
  branch: path.split("/").pop()!,
  head: "abcdef1234",
  isMain: false,
  locked: false,
  prunable: false,
  missing: false,
  dirty: false,
  unpushed: 0,
  sessionIds: [],
  ...extra,
});

const trees = [
  tree("/t/clean"),
  tree("/t/dirty", { dirty: true }),
  tree("/repo", { isMain: true }),
  tree("/t/gone", { missing: true }),
  tree("/t/pruned", { prunable: true }),
  tree("/t/detached", { branch: null, dirty: true }),
];

it("hides missing and prunable worktrees and orders main, active, clean", () => {
  expect(worktreeRows(trees, "/repo").map((row) => row.path)).toEqual([
    "/repo",
    "/t/dirty",
    "/t/detached",
    "/t/clean",
  ]);
});

it("keeps the checkout containing cwd first and is stable for the same cwd", () => {
  expect(worktreeRows(trees, "/t/clean/sub").map((row) => row.path)[0]).toBe("/t/clean");
  expect(worktreeRows(trees, "/repo")).toEqual(
    worktreeRows([...trees].reverse().reverse(), "/repo"),
  );
});

it("titles by branch with a path detail and marks the project folder", () => {
  const [main, , detached] = worktreeRows(trees, "/repo");
  expect(main).toMatchObject({ title: "repo", isMain: true });
  expect(main!.detail.startsWith("Project folder · ")).toBe(true);
  expect(detached!.title).toBe("Detached abcdef1");
  expect(detached!.detail.startsWith("Project folder")).toBe(false);
});

it("filters title, detail and path without case or surrounding whitespace", () => {
  expect(worktreeRows(trees, "/repo", "  DIRTY ").map((row) => row.path)).toEqual(["/t/dirty"]);
  expect(worktreeRows(trees, "/repo", "/T/CLEAN").map((row) => row.path)).toEqual(["/t/clean"]);
  expect(worktreeRows(trees, "/repo", "gone")).toEqual([]);
  expect(worktreeRows(undefined, "/repo")).toEqual([]);
});
