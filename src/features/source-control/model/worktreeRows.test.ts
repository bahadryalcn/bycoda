import { expect, it } from "vitest";
import { worktreeGroupLabel, worktreeRows } from "./worktreeRows";
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

it("filters title, detail and path without case or surrounding whitespace", () => {
  expect(worktreeRows(trees, "/repo", "  DIRTY ").map((row) => row.path)).toEqual(["/t/dirty"]);
  expect(worktreeRows(trees, "/repo", "/T/CLEAN").map((row) => row.path)).toEqual(["/t/clean"]);
  expect(worktreeRows(trees, "/repo", "gone")).toEqual([]);
  expect(worktreeRows(undefined, "/repo")).toEqual([]);
});

it("titles by branch, names the folder and marks the project folder", () => {
  const [main, , detached] = worktreeRows(trees, "/repo");
  expect(main).toMatchObject({ title: "repo", folder: "Project folder", isMain: true });
  expect(detached).toMatchObject({ title: "Detached abcdef1", folder: "detached" });
  // The full path is not part of the row; only the filter and the tooltip use it.
  expect(main).not.toHaveProperty("detail");
  expect(detached!.path).toBe("/t/detached");
});

it("marks the session's checkout and assigns the three groups in order", () => {
  const rows = worktreeRows(trees, "/t/clean/sub");
  expect(rows.map((row) => [row.path, row.group, row.current])).toEqual([
    ["/t/clean", "primary", true],
    ["/repo", "primary", false],
    ["/t/dirty", "active", false],
    ["/t/detached", "active", false],
  ]);
});

it("labels only the groups that follow the leading one", () => {
  expect(worktreeGroupLabel("primary", 2)).toBeUndefined();
  expect(worktreeGroupLabel("active", 2)).toBe("With changes");
  expect(worktreeGroupLabel("idle", 3)).toBe("Clean · 3");
});

it("sorts a worktree with sessions or unpushed commits into the active group", () => {
  const rows = worktreeRows(
    [
      tree("/repo", { isMain: true }),
      tree("/t/pushed", { unpushed: 2 }),
      tree("/t/sessions", { sessionIds: ["s1"] }),
      tree("/t/clean"),
    ],
    "/repo",
  );
  expect(rows.map((row) => [row.path, row.group])).toEqual([
    ["/repo", "primary"],
    ["/t/pushed", "active"],
    ["/t/sessions", "active"],
    ["/t/clean", "idle"],
  ]);
});
