import { afterEach, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { turnGit } from "../git/turn-git-history";
import { createExecutionActivityReservations } from "../workspace-cleanup";
import { createManagedNativeActivity } from "./managed-native-activity";
import type { ManagedWorkspace } from "../workspaces/workspace-contracts";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const owner = { ownerId: "device-one", authorizationId: "trusted" };
const other = { ownerId: "device-two", authorizationId: "trusted" };
async function fixture(linkedAncestor = false, exactGitRewind = true) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "native-activity-"));
  cleanups.push(() => rm(temporaryRoot, { recursive: true, force: true }));
  let root = temporaryRoot;
  if (linkedAncestor) {
    const actual = join(temporaryRoot, "actual");
    root = join(temporaryRoot, "alias");
    await mkdir(actual);
    await symlink(actual, root, process.platform === "win32" ? "junction" : "dir");
  }
  const main = join(root, "main");
  await mkdir(main);
  await turnGit(main, ["init", "-b", "main"]);
  await turnGit(main, ["config", "user.name", "Native activity test"]);
  await turnGit(main, ["config", "user.email", "native@example.test"]);
  await writeFile(join(main, "source.txt"), "base\n");
  await turnGit(main, ["add", "."]);
  await turnGit(main, ["commit", "-m", "base"]);
  const path = join(root, "worktree");
  await turnGit(main, ["worktree", "add", "-b", "by/native", path]);
  const workspace: ManagedWorkspace = {
    id: "workspace",
    repositoryId: await realpath(join(main, ".git")),
    projectId: "project",
    environmentId: "environment",
    owner: { kind: "session", id: "session" },
    path: linkedAncestor ? path : await realpath(path),
    branchRef: "refs/heads/by/native",
    baseRef: "refs/heads/main",
    baseCommit: "base",
    targetBranchRef: "refs/heads/main",
    state: "idle",
    directoryState: "present",
    revision: 1,
    lastActivityAt: 1,
    pinned: false,
  };
  const workspaces = [workspace];
  const get = async (id: string) => {
    if (id !== workspace.id) throw new Error("Unknown workspace");
    return workspace;
  };
  let service: ReturnType<typeof createManagedNativeActivity>;
  const activity = createExecutionActivityReservations({
    get,
    probe: async () => [],
    pending: async () => false,
  });
  const compose = () =>
    createManagedNativeActivity({
      exactGitRewindEnabled: async () => exactGitRewind,
      root: join(root, "private"),
      workspace: async (id) => {
        const value = await get(id);
        if (value.directoryState !== "present")
          throw new Error("Workspace directory is unavailable; resume it first");
        return value;
      },
      listWorkspaces: async () => workspaces,
      activity,
      assertWritable: async () => {},
      authorize: async (value) => value.authorizationId === "trusted",
    });
  service = compose();
  return {
    root,
    main,
    path,
    workspace,
    workspaces,
    activity,
    get service() {
      return service;
    },
    restart() {
      service = compose();
    },
  };
}
it("admits lightweight processes despite stale activity without a managed lease", async () => {
  const f = await fixture(false, false);
  // An old unknown turn must remain a destructive-operation guard, not a turn admission fence.
  await f.activity.start({
    workspaceId: f.workspace.id,
    kind: "provider",
    ownerId: "native-turn:stuck",
  });
  for (let turn = 0; turn < 3; turn++) {
    expect(
      await f.service.start(
        {
          activityId: `light-${turn}`,
          cwd: f.path,
          kind: "provider",
          sessionId: "session",
        },
        owner,
      ),
    ).toEqual({ activityId: `light-${turn}`, workspaceId: f.workspace.id });
    expect(await f.service.end({ activityId: `light-${turn}` }, owner)).toEqual({
      acknowledged: true,
    });
  }
  const entries = await f.activity.list(f.workspace.id);
  expect(entries.filter((entry) => entry.ownerId.startsWith("native-process:"))).toEqual([]);
});

it("admits canonical native processes beneath an aliased workspace ancestor", async () => {
  const f = await fixture(true);
  const broken = join(f.root, "linked-workspace");
  await symlink(f.main, broken, process.platform === "win32" ? "junction" : "dir");
  f.workspaces.push({ ...f.workspace, id: "broken-sibling", path: broken });
  const request = { activityId: "aliased", cwd: f.path, kind: "shell" as const };
  await f.service.start(request, owner);
  expect(await f.activity.list("workspace")).toHaveLength(1);
  await f.service.end({ activityId: request.activityId }, owner);
  expect(await f.activity.list("workspace")).toHaveLength(0);
});

it("binds canonical process admission to the device and accepted session and retains it across restart", async () => {
  const f = await fixture();
  const request = {
    activityId: "process",
    cwd: f.path,
    kind: "provider" as const,
    sessionId: "session",
  };
  await expect(f.service.start({ ...request, sessionId: "wrong" }, owner)).rejects.toThrow(
    "does not own",
  );
  await expect(f.service.start({ ...request, cwd: f.main }, owner)).rejects.toThrow(
    "no registered",
  );
  await expect(f.service.start(request, owner)).resolves.toEqual({
    activityId: "process",
    workspaceId: "workspace",
  });
  await expect(f.service.start(request, owner)).resolves.toHaveProperty("workspaceId", "workspace");
  expect(await f.activity.list("workspace")).toHaveLength(1);
  f.restart();
  await expect(f.service.end({ activityId: "process" }, other)).rejects.toThrow("another owner");
  await expect(f.service.start({ ...request, kind: "shell" }, owner)).rejects.toThrow(
    "another request",
  );
  await expect(
    f.activity.reserve({
      workspaceId: "workspace",
      operationId: "remove",
      purpose: "removal",
      expectedRevision: 1,
    }),
  ).rejects.toThrow("in use");
  await f.service.end({ activityId: "process" }, owner);
  await f.service.end({ activityId: "process" }, owner);
  expect(await f.activity.list("workspace")).toHaveLength(0);
  await expect(f.service.start(request, owner)).rejects.toThrow("already ended");
});
it("shares reservations and permits the process belonging to a captured native session", async () => {
  const f = await fixture();
  const reservation = await f.activity.reserve({
    workspaceId: "workspace",
    operationId: "rewind",
    purpose: "rewind",
    expectedRevision: 1,
  });
  await expect(
    f.service.start(
      { activityId: "blocked", cwd: f.path, kind: "shell", sessionId: "session" },
      owner,
    ),
  ).rejects.toThrow("reserved");
  await f.activity.release(reservation.id);
  const turn = await f.activity.start({
    workspaceId: "workspace",
    kind: "provider",
    ownerId: "native-turn:owned-session",
  });
  await f.service.start(
    { activityId: "captured", cwd: f.path, kind: "provider", sessionId: "session" },
    owner,
  );
  await f.service.start(
    { activityId: "nested-shell", cwd: f.path, kind: "shell", sessionId: "session" },
    owner,
  );
  await expect(
    f.service.start({ activityId: "unrelated", cwd: f.path, kind: "shell" }, other),
  ).rejects.toThrow("another writer");
  await f.service.end({ activityId: "captured" }, owner);
  await f.service.end({ activityId: "nested-shell" }, owner);
  await f.activity.stop(turn.id);
});

it("refuses process admission while the workspace directory is being retired", async () => {
  const f = await fixture();
  for (const directoryState of ["pendingRemoval", "removing", "removed"] as const) {
    f.workspace.directoryState = directoryState;
    await expect(
      f.service.start(
        { activityId: `blocked-${directoryState}`, cwd: f.path, kind: "shell" },
        owner,
      ),
    ).rejects.toThrow("unavailable");
  }
});
