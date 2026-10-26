import { afterEach, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { turnGit } from "./turn-git-history";
import { createExecutionActivityReservations } from "./workspace-cleanup";
import { createManagedNativeActivity } from "./managed-native-activity";
import type { NativeBufferSnapshot } from "./managed-native-activity";
import type { ManagedWorkspace } from "./workspace-contracts";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const owner = { ownerId: "device-one", authorizationId: "trusted" };
const other = { ownerId: "device-two", authorizationId: "trusted" };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "native-activity-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const main = join(root, "main");
  await mkdir(main);
  await turnGit(main, ["init", "-b", "main"]);
  await turnGit(main, ["config", "user.name", "Native activity test"]);
  await turnGit(main, ["config", "user.email", "native@example.test"]);
  await writeFile(join(main, "source.txt"), "base\n");
  await turnGit(main, ["add", "."]);
  await turnGit(main, ["commit", "-m", "base"]);
  const path = join(root, "worktree");
  await turnGit(main, ["worktree", "add", "-b", "bycoda/s/native", path]);
  const workspace: ManagedWorkspace = {
    id: "workspace",
    repositoryId: await realpath(join(main, ".git")),
    projectId: "project",
    environmentId: "environment",
    owner: { kind: "session", id: "session" },
    path: await realpath(path),
    branchRef: "refs/heads/bycoda/s/native",
    baseRef: "refs/heads/main",
    baseCommit: "base",
    targetBranchRef: "refs/heads/main",
    state: "idle",
    directoryState: "present",
    revision: 1,
    lastActivityAt: 1,
    pinned: false,
  };
  let clock = 1_000_000;
  const get = async (id: string) => {
    if (id !== workspace.id) throw new Error("Unknown workspace");
    return workspace;
  };
  let service: ReturnType<typeof createManagedNativeActivity>;
  const activity = createExecutionActivityReservations({
    get,
    probe: (id) => service.probe(id),
    pending: async () => false,
  });
  const compose = () =>
    createManagedNativeActivity({
      root: join(root, "private"),
      workspace: async (id) => {
        const value = await get(id);
        if (value.directoryState !== "present")
          throw new Error("Workspace directory is unavailable; resume it first");
        return value;
      },
      listWorkspaces: async () => [workspace],
      activity,
      assertWritable: async () => {},
      authorize: async (value) => value.authorizationId === "trusted",
      now: () => clock,
    });
  service = compose();
  const report = (
    dirty: boolean,
    clientId = "client",
    instanceId = "instance",
  ): NativeBufferSnapshot => ({
    clientId,
    instanceId,
    processId: 1234,
    owners: [
      {
        ownerId: "main",
        updatedAt: clock,
        unknown: false,
        buffers: [{ path: join(path, "source.txt"), dirty }],
      },
    ],
  });
  return {
    root,
    main,
    path,
    workspace,
    activity,
    get service() {
      return service;
    },
    report,
    restart() {
      service = compose();
    },
    advance(ms: number) {
      clock += ms;
    },
  };
}
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
it("retains dirty and unknown windows and other clients until their own fresh reports settle", async () => {
  const f = await fixture();
  await f.service.updateBuffers(f.report(true), owner);
  await f.service.updateBuffers(f.report(false, "other-client"), owner);
  await expect(
    f.activity.reserve({
      workspaceId: "workspace",
      operationId: "remove",
      purpose: "removal",
      expectedRevision: 1,
    }),
  ).rejects.toThrow("in use");
  await f.service.updateBuffers({ ...f.report(false), owners: [] }, owner);
  expect(await f.service.probe("workspace")).toHaveLength(1);
  await f.service.updateBuffers(f.report(false), other);
  expect(await f.service.probe("workspace")).toHaveLength(1);
  await f.service.updateBuffers(f.report(false), owner);
  expect(await f.service.probe("workspace")).toHaveLength(0);
  f.advance(46_000);
  expect(await f.service.probe("workspace")).toHaveLength(3);
  f.restart();
  await f.service.updateBuffers(f.report(false), owner);
  expect(await f.service.probe("workspace")).toHaveLength(2);
});
it("requires fresh reports after Host restart and canonicalizes new files through dependency aliases", async () => {
  const f = await fixture();
  await f.service.updateBuffers(f.report(false), owner);
  f.restart();
  expect(await f.service.probe("workspace")).toHaveLength(1);
  await f.service.updateBuffers(f.report(false), owner);
  const alias = join(f.root, "alias");
  await symlink(f.path, alias, process.platform === "win32" ? "junction" : "dir");
  try {
    const report = f.report(true);
    report.owners[0].buffers[0].path = join(alias, "new-file.txt");
    await f.service.updateBuffers(report, owner);
    expect(await f.service.probe("workspace")).toHaveLength(1);
    await expect(
      f.service.start({ activityId: "blocked", cwd: f.path, kind: "shell" }, owner),
    ).rejects.toThrow("unsettled");
  } finally {
    // Remove only this link entry before recursive test-root cleanup.
    await rm(alias);
  }
});
it("rejects malformed and reused instance reports without clearing a dirty snapshot", async () => {
  const f = await fixture();
  await f.service.updateBuffers(f.report(true), owner);
  await expect(
    f.service.updateBuffers({ ...f.report(false), processId: 999 }, owner),
  ).rejects.toThrow("process identity changed");
  const invalid = f.report(false);
  invalid.owners[0].buffers[0].path = "relative";
  await expect(f.service.updateBuffers(invalid, owner)).rejects.toThrow("buffer path");
  expect(await f.service.probe("workspace")).toHaveLength(1);
});

it("keeps lifecycle activity probes available while a directory is pending removal or retired", async () => {
  const f = await fixture();
  await f.service.updateBuffers(f.report(true), owner);
  for (const directoryState of ["pendingRemoval", "removing", "removed"] as const) {
    f.workspace.directoryState = directoryState;
    await expect(f.service.probe("workspace")).resolves.toMatchObject([
      { workspaceId: "workspace", kind: "editor", dirtyBuffer: true },
    ]);
    await expect(
      f.service.start(
        { activityId: `blocked-${directoryState}`, cwd: f.path, kind: "shell" },
        owner,
      ),
    ).rejects.toThrow("unavailable");
  }
});
