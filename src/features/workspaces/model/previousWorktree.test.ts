import { describe, expect, it, vi } from "vitest";
import type { Worktree } from "../../source-control/model/worktrees";
import type { Session } from "../../sessions/model/session";

const listed = vi.hoisted(() => ({ summaries: [] as unknown[] }));
vi.mock("../../connections/public/connections", () => ({
  cachedRemoteSessionSummaries: () => listed.summaries,
}));

import { previousWorktreeCandidates, previousWorktreeFor } from "./previousWorktree";

const tree = (path: string, extra: Partial<Worktree> = {}): Worktree => ({
  path,
  branch: "by/abcd1234",
  head: "a",
  isMain: false,
  locked: false,
  prunable: false,
  missing: false,
  dirty: false,
  unpushed: 0,
  sessionIds: [],
  ...extra,
});
const session = (id: string, worktreeCwd?: string, cwd = "/p") => ({ id, cwd, worktreeCwd });

describe("previousWorktreeFor", () => {
  const trees = [
    tree("/p", { isMain: true }),
    tree("/w/a"),
    tree("/w/b"),
    tree("/w/gone", { missing: true }),
  ];

  it("returns the newest other worktree that still exists", () => {
    const sessions = [session("1", "/w/a"), session("2", "/w/b")];
    expect(previousWorktreeFor(sessions, "/p", "/w/a", trees)?.path).toBe("/w/b");
    expect(previousWorktreeFor(sessions, "/p", undefined, trees)?.path).toBe("/w/a");
  });

  it("skips missing worktrees, other projects, the main checkout and plain sessions", () => {
    const sessions = [
      session("1", "/w/gone"),
      session("2", "/w/a", "/other"),
      session("3", "/p"),
      session("4", undefined),
      session("5", "/w/b"),
    ];
    expect(previousWorktreeFor(sessions, "/p", "/p", trees)?.path).toBe("/w/b");
    expect(previousWorktreeFor([session("1", "/p")], "/p", undefined, trees)).toBeNull();
  });

  it("matches remote session paths against Host worktree paths", () => {
    const sessions = [session("1", "remote://env/w/a", "remote://env/p")];
    expect(previousWorktreeFor(sessions, "remote://env/p", undefined, trees)?.path).toBe("/w/a");
  });

  it("is null when nothing qualifies", () => {
    expect(previousWorktreeFor([], "/p", undefined, trees)).toBeNull();
  });
});

describe("previousWorktreeCandidates", () => {
  const turn = (startedAt: number) =>
    [
      { id: `b${startedAt}`, role: "user", text: "x", startedAt, durationMs: 0 },
    ] as Session["blocks"];
  const local = (id: string, blocks: Session["blocks"], worktreeCwd?: string) =>
    ({ id, cwd: "/p", worktreeCwd, blocks }) as Session;

  it("orders by the last turn, newest first, and leaves the asking session out", () => {
    const sessions = [
      local("old", turn(10), "/w/old"),
      local("new", turn(30), "/w/new"),
      local("self", turn(99)),
      local("mid", turn(20), "/w/mid"),
    ];
    expect(previousWorktreeCandidates(sessions, "self", "/p").map((entry) => entry.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });

  it("puts a later-created session first when neither has a turn", () => {
    const sessions = [local("first", [], "/w/a"), local("second", [], "/w/b")];
    expect(previousWorktreeCandidates(sessions, undefined, "/p").map((entry) => entry.id)).toEqual([
      "second",
      "first",
    ]);
  });

  it("adds the sessions a remote project's Host listed, ranked by their activity", () => {
    listed.summaries = [
      { id: "h1", worktreeCwd: "/srv/w/one", lastActivityAt: 25, updatedAt: 1 },
      { id: "h2", updatedAt: 50 },
    ];
    const project = "remote://env/srv/app";
    const sessions = [local("a", turn(10)), local("b", turn(40))];
    const ordered = previousWorktreeCandidates(sessions, undefined, project);
    expect(ordered.map((entry) => entry.id)).toEqual(["b", "h1", "a"]);
    expect(ordered[1]).toMatchObject({ cwd: project, worktreeCwd: "remote://env/srv/w/one" });
    listed.summaries = [];
  });
});
