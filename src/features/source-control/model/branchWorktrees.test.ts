import { expect, it } from "vitest";
import { branchWorktrees, partitionByWorktree, worktreeOfBranch } from "./branchWorktrees";
import type { Worktree } from "./worktrees";

const tree = (path: string, branch: string | null, extra: Partial<Worktree> = {}): Worktree => ({
  path,
  branch,
  head: "abc",
  isMain: false,
  locked: false,
  prunable: false,
  missing: false,
  dirty: false,
  unpushed: 0,
  sessionIds: [],
  ...extra,
});

it("joins branches with live worktrees, skipping the picker's own and gone ones", () => {
  const map = branchWorktrees(
    [
      tree("/repo", "main", { isMain: true }),
      tree("/wt/a", "feat/a"),
      tree("/wt/gone", "feat/gone", { missing: true }),
      tree("/wt/stale", "feat/stale", { prunable: true }),
      tree("/wt/detached", null),
    ],
    "/repo",
  );
  expect([...map.keys()]).toEqual(["feat/a"]);
  expect(worktreeOfBranch(map, { name: "feat/a", remote: null })?.path).toBe("/wt/a");
  expect(worktreeOfBranch(map, { name: "feat/a", remote: "origin" })).toBeUndefined();
});

it("groups worktree branches after free ones and keeps order", () => {
  const map = branchWorktrees([tree("/wt/a", "b")], "/repo");
  const rows = [
    { name: "a", remote: null },
    { name: "b", remote: null },
    { name: "c", remote: null },
  ];
  const { free, inWorktree } = partitionByWorktree(rows, map);
  expect(free.map((r) => r.name)).toEqual(["a", "c"]);
  expect(inWorktree.map((r) => r.name)).toEqual(["b"]);
});
