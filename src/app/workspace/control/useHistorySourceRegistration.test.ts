import { expect, it } from "vitest";
import type { Session } from "../../../features/sessions/model/session";
import { historySourceProjection } from "./useHistorySourceRegistration";
const source = { id: "idle", cwd: "/project", busy: false, blocks: [] } as unknown as Session;
it("registers a completed idle open session without granting app or provider access", () => {
  expect(historySourceProjection([source], () => false)).toEqual([
    { sessionId: "idle", cwd: "/project" },
  ]);
  expect(historySourceProjection([], () => false)).toEqual([]);
});
it("tracks actual working checkout and removes locked/remote/orchestration sources", () => {
  const worktree = { ...source, worktreeCwd: "/project-worktree" };
  expect(historySourceProjection([worktree], () => false)).toEqual([
    { sessionId: "idle", cwd: "/project-worktree" },
  ]);
  expect(historySourceProjection([worktree], (cwd) => cwd === "/project-worktree")).toEqual([]);
  expect(historySourceProjection([source], (cwd) => cwd === "/project")).toEqual([]);
  expect(
    historySourceProjection(
      [
        { ...source, cwd: "remote://host/project" },
        { ...source, orchestrationLeadId: "lead" },
      ],
      () => false,
    ),
  ).toEqual([]);
});
