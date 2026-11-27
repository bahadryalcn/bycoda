import { expect, it } from "vitest";
import {
  AGENT_ROWS_SHOWN,
  collapseAgentRows,
  isAgentWorktree,
  worktreeGroupLabel,
  worktreeRows,
} from "./worktreeRows";
import { changeSectionRoots, totalChangedFiles } from "./worktreeScope";
import { normalizeWorktrees, type Worktree } from "./worktrees";

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

it("hides missing and prunable worktrees and leads with the ones that have changes", () => {
  expect(worktreeRows(trees, "/repo").map((row) => row.path)).toEqual([
    "/t/dirty",
    "/t/detached",
    "/repo",
    "/t/clean",
  ]);
});

it("keeps the session's checkout first in its group and is stable for the same cwd", () => {
  expect(worktreeRows(trees, "/t/clean/sub").map((row) => row.path)).toEqual([
    "/t/dirty",
    "/t/detached",
    "/t/clean",
    "/repo",
  ]);
  expect(worktreeRows(trees, "/repo")).toEqual(worktreeRows([...trees], "/repo"));
});

it("filters title, detail and path without case or surrounding whitespace", () => {
  expect(worktreeRows(trees, "/repo", "  DIRTY ").map((row) => row.path)).toEqual(["/t/dirty"]);
  expect(worktreeRows(trees, "/repo", "/T/CLEAN").map((row) => row.path)).toEqual(["/t/clean"]);
  expect(worktreeRows(trees, "/repo", "gone")).toEqual([]);
  expect(worktreeRows(undefined, "/repo")).toEqual([]);
});

it("titles by branch and shows no text marker or project-folder label", () => {
  const rows = worktreeRows(trees, "/repo");
  const main = rows.find((row) => row.isMain)!;
  expect(main).toMatchObject({ title: "repo", folder: "repo", group: "primary" });
  expect(main.detail).toBeUndefined();
  expect(rows.find((row) => row.path === "/t/detached")).toMatchObject({
    title: "Detached abcdef1",
    detail: "detached",
  });
  expect(main).not.toHaveProperty("marker");
});

it("groups changes first, then project folder, other worktrees, agent worktrees", () => {
  const rows = worktreeRows(
    [
      tree("/repo", { isMain: true }),
      tree("/t/agent-a", { branch: "by/agent-a" }),
      tree("/t/agent-dirty", { branch: "by/agent-dirty", dirty: true }),
      tree("/t/ahead", { unpushed: 3 }),
      tree("/t/unknown", { dirty: null, unpushed: null }),
    ],
    "/repo",
  );
  expect(rows.map((row) => [row.path, row.group, row.agent])).toEqual([
    ["/t/agent-dirty", "changes", true],
    ["/repo", "primary", false],
    ["/t/ahead", "other", false],
    ["/t/unknown", "other", false],
    ["/t/agent-a", "agent", true],
  ]);
});

it("never reads an unknown state as changes or as clean", () => {
  const [unknown] = worktreeRows([tree("/t/x", { dirty: null, unpushed: null })], "/repo");
  expect(unknown!.group).toBe("other");
  expect(
    changeSectionRoots([tree("/repo", { isMain: true }), tree("/t/x", { dirty: null })], "/repo"),
  ).toEqual(["/repo"]);
});

it("recognises agent worktrees by branch prefix or managed folder, never the project folder", () => {
  expect(isAgentWorktree(tree("/t/x", { branch: "by/live-games" }))).toBe(true);
  expect(isAgentWorktree(tree("/t/x", { branch: "by/fix-1a2b3c4d" }))).toBe(true);
  expect(isAgentWorktree(tree("/t/wt-1a2b3c4d5e6f", { branch: "feature/y" }))).toBe(true);
  expect(isAgentWorktree(tree("C:/Users/me/.t3/worktrees/p/x", { branch: "feature/y" }))).toBe(
    true,
  );
  expect(isAgentWorktree(tree("/repo", { branch: "by/main", isMain: true }))).toBe(false);
  expect(isAgentWorktree(tree("/t/feature", { branch: "feat/messaging-chat" }))).toBe(false);
  // The agent row carries no hash-like folder.
  expect(
    worktreeRows([tree("/t/wt-1a2b3c4d5e6f", { branch: "by/z" })], "/repo")[0]!.detail,
  ).toBeUndefined();
});

it("labels the changes and agent groups plainly and leaves the others unlabelled", () => {
  expect(worktreeGroupLabel("changes", 2)).toBe("Uncommitted changes");
  expect(worktreeGroupLabel("agent", 26)).toBe("Agent worktrees · 26");
  expect(worktreeGroupLabel("primary", 2)).toBeUndefined();
  expect(worktreeGroupLabel("other", 2)).toBeUndefined();
});

it("sorts agent worktrees by activity and collapses long groups after five rows", () => {
  const agents = Array.from({ length: 8 }, (_, index) =>
    tree(`/t/a${index}`, { branch: `by/a${index}`, unpushed: index }),
  );
  const rows = worktreeRows([tree("/repo", { isMain: true }), ...agents], "/repo");
  expect(rows.filter((row) => row.group === "agent")[0]!.path).toBe("/t/a7");
  const collapsed = collapseAgentRows(rows, false);
  expect(collapsed.hidden).toBe(8 - AGENT_ROWS_SHOWN);
  expect(collapsed.rows.filter((row) => row.group === "agent")).toHaveLength(AGENT_ROWS_SHOWN);
  expect(collapseAgentRows(rows, true)).toEqual({ rows, hidden: 0 });
});

it("lists worktrees with uncommitted changes, then unpushed ones, as Changes sections, the session's one when none", () => {
  const all = [
    tree("/repo", { isMain: true }),
    tree("/t/ahead", { unpushed: 4 }),
    tree("/t/dirty", { dirty: true }),
    tree("/t/mine", { dirty: true }),
  ];
  expect(changeSectionRoots(all, "/t/mine/src")).toEqual(["/t/mine", "/t/dirty", "/t/ahead"]);
  expect(
    changeSectionRoots(
      all.filter((item) => !item.dirty && !item.unpushed),
      "/repo",
    ),
  ).toEqual(["/repo"]);
  expect(changeSectionRoots(undefined, "/repo")).toEqual([]);
});

it("totals the badge as the sum of the section counts", () => {
  expect(totalChangedFiles([321, 3, undefined])).toBe(324);
  expect(totalChangedFiles([])).toBe(0);
});

it("a Host list without state fields stays unknown, never clean", () => {
  const listed = normalizeWorktrees({
    defaultRoot: "/r-worktrees",
    worktrees: [{ path: "/r", branch: "main", head: "a", isMain: true, missing: false }],
  } as never);
  expect(listed.worktrees[0]).toMatchObject({ dirty: null, unpushed: null, sessionIds: [] });
  const known = normalizeWorktrees({
    defaultRoot: "/r-worktrees",
    worktrees: [
      {
        path: "/r",
        branch: "main",
        head: "a",
        isMain: true,
        missing: false,
        dirty: true,
        unpushed: 2,
      },
    ],
  } as never);
  expect(known.worktrees[0]).toMatchObject({ dirty: true, unpushed: 2 });
  expect(worktreeRows(listed.worktrees, "/r")[0]!.group).toBe("primary");
});
