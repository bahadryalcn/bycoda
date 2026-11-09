import { expect, it } from "vitest";
import type { ManagedWorkspace, WorkspacePolicy } from "./contracts";
import {
  matchesRosterFilter,
  workspaceCleanupDueAt,
  workspaceNeedsAttention,
  workspaceRosterFacts,
} from "./workspacePresentation";

const policy: WorkspacePolicy = {
  defaultMode: "worktree",
  integrationBranchRef: "refs/heads/main",
  root: null,
  pinned: false,
  retention: { active: "never", idle: 1000, finished: 1000, merged: 1000, abandoned: 1000 },
  disk: { budgetBytes: 1, warningRatio: 0.8, minimumFreeBytes: 1 },
};
const workspace = (patch: Partial<ManagedWorkspace>): ManagedWorkspace =>
  ({
    id: "workspace",
    path: "/repo-worktrees/a",
    state: "idle",
    directoryState: "present",
    lastActivityAt: 5000,
    pinned: false,
    ...patch,
  }) as ManagedWorkspace;

it("returns no cleanup time while a workspace is active", () => {
  expect(workspaceCleanupDueAt(workspace({ state: "active" }), policy)).toBeUndefined();
});

it("returns no cleanup time for pinned workspaces, from either the workspace or the policy", () => {
  expect(workspaceCleanupDueAt(workspace({ pinned: true }), policy)).toBeUndefined();
  expect(workspaceCleanupDueAt(workspace({}), { ...policy, pinned: true })).toBeUndefined();
});

it("returns no cleanup time when the period is Never or the directory is removed", () => {
  const never = { ...policy, retention: { ...policy.retention, idle: "never" as const } };
  expect(workspaceCleanupDueAt(workspace({}), never)).toBeUndefined();
  expect(workspaceCleanupDueAt(workspace({ directoryState: "removed" }), policy)).toBeUndefined();
});

it("counts idle workspaces from their last activity", () => {
  expect(workspaceCleanupDueAt(workspace({ state: "idle" }), policy)).toBe(6000);
});

it("counts merged workspaces from the merge and extends them with later activity", () => {
  expect(
    workspaceCleanupDueAt(
      workspace({ state: "merged", mergedAt: 2000, lastActivityAt: 1000 }),
      policy,
    ),
  ).toBe(3000);
  expect(
    workspaceCleanupDueAt(
      workspace({ state: "merged", mergedAt: 2000, lastActivityAt: 4000 }),
      policy,
    ),
  ).toBe(5000);
});

it("counts finished and abandoned workspaces from their own transition time", () => {
  expect(
    workspaceCleanupDueAt(
      workspace({ state: "finished", finishedAt: 3000, lastActivityAt: 1000 }),
      policy,
    ),
  ).toBe(4000);
  expect(
    workspaceCleanupDueAt(
      workspace({ state: "abandoned", closedAt: 2500, lastActivityAt: 1000 }),
      policy,
    ),
  ).toBe(3500);
});

it("returns no cleanup time when the transition timestamp is unknown", () => {
  expect(workspaceCleanupDueAt(workspace({ state: "merged", lastActivityAt: 1000 }), policy)).toBe(
    undefined,
  );
});

it("flags blocked cleanup, a missing folder, or a retained workspace due for cleanup", () => {
  expect(
    workspaceNeedsAttention(workspace({ directoryState: "blocked" }), { missing: false }),
  ).toBe(true);
  expect(workspaceNeedsAttention(workspace({}), { missing: true })).toBe(true);
  expect(workspaceNeedsAttention(workspace({}), { missing: false, cleanupDueAt: 6000 })).toBe(true);
  expect(workspaceNeedsAttention(workspace({}), { missing: false })).toBe(false);
  expect(
    workspaceNeedsAttention(workspace({ state: "active" }), { missing: false, cleanupDueAt: 6000 }),
  ).toBe(false);
});

it("matches a missing folder by path key and times cleanup from the saved policy", () => {
  const idle = workspace({ path: "C:\\Repo-Worktrees\\A" });
  expect(workspaceRosterFacts(idle, ["c:/repo-worktrees/a"], policy)).toEqual({
    missing: true,
    cleanupDueAt: 6000,
  });
  expect(workspaceRosterFacts(idle, [], undefined)).toEqual({
    missing: false,
    cleanupDueAt: undefined,
  });
});

it("filters the roster by Active and Needs attention and keeps All open", () => {
  const active = workspace({ state: "active" });
  const blocked = workspace({ directoryState: "blocked" });
  const none = { missing: false };
  expect(matchesRosterFilter("all", active, none)).toBe(true);
  expect(matchesRosterFilter("active", active, none)).toBe(true);
  expect(matchesRosterFilter("active", blocked, none)).toBe(false);
  expect(matchesRosterFilter("attention", active, none)).toBe(false);
  expect(matchesRosterFilter("attention", blocked, none)).toBe(true);
});
