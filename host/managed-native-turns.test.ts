import { afterEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HostStore } from "./store";
import { createManagedWorkspaceRegistry } from "./managed-workspaces";
import { createWorkspacePolicyResolver } from "./workspace-policy";
import { createExecutionActivityReservations } from "./workspace-cleanup";
import { hostGitRepositoryKey } from "./git-mutations";
import { GitTurnHistory, gitText, turnGit } from "./turn-git-history";
import { createManagedNativeTurns } from "./managed-native-turns";
import { createManagedNativeActivity } from "./managed-native-activity";
import { nativeProcessPrefix } from "./native-activity-identity";
import { GitSessionRewindService } from "./session-rewind";
import type { ConversationRewindAdapter } from "./session-rewind";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const owner = { ownerId: "device-one", authorizationId: "trusted" };
const secondOwner = { ownerId: "device-two", authorizationId: "trusted" };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "managed-native-turns-"));
  cleanups.push(async () => rm(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  await mkdir(repo);
  await turnGit(repo, ["init", "-b", "main"]);
  await turnGit(repo, ["config", "user.name", "Test"]);
  await turnGit(repo, ["config", "user.email", "test@example.test"]);
  await turnGit(repo, ["config", "core.autocrlf", "false"]);
  await writeFile(join(repo, "source.txt"), "baseline\n");
  await turnGit(repo, ["add", "."]);
  await turnGit(repo, ["commit", "-m", "baseline"]);
  const db = join(root, "host.db");
  const compose = async () => {
    const store = new HostStore(db);
    cleanups.push(() => store.close());
    await store.ready;
    const policy = createWorkspacePolicyResolver(store, {
      hostPolicy: { root: join(root, "worktrees") },
    });
    const registry = createManagedWorkspaceRegistry(store, policy, {
      verifyReservation: (request) => activity.verifyReservation(request),
    });
    const workspace = async (id: string) => {
      const value = await registry.get({ workspaceId: id });
      if (
        !value ||
        (await hostGitRepositoryKey(value.path)) !== value.repositoryId ||
        (await gitText(value.path, ["symbolic-ref", "HEAD"])) !== value.branchRef
      )
        throw new Error("Managed workspace identity changed");
      const project = await store.project(value.projectId);
      const registered = (await gitText(project.cwd, ["worktree", "list", "--porcelain", "-z"]))
        .split("\0\0")
        .some(
          (record) =>
            record
              .split("\0")
              .some(
                (line) =>
                  line.startsWith("worktree ") &&
                  resolve(line.slice(9)).toLowerCase() === resolve(value.path).toLowerCase(),
              ) && record.split("\0").includes(`branch ${value.branchRef}`),
        );
      if (!registered) throw new Error("Managed worktree is not registered");
      return value;
    };
    let process: ReturnType<typeof createManagedNativeActivity>;
    const activity = createExecutionActivityReservations({
      get: workspace,
      probe: (id) => process.probe(id),
      pending: async (id, exceptOperationId) =>
        (await registry.listOperations(id)).some(
          (op) => op.id !== exceptOperationId && op.phase !== "complete",
        ),
      persistence: store.workspaceActivityPersistence(),
      operation: (id) => registry.getOperation(id),
    });
    process = createManagedNativeActivity({
      root: join(root, "private-history"),
      workspace,
      listWorkspaces: () => store.managedWorkspaces(),
      activity,
      assertWritable: async () => {},
      authorize: async (value) => value.authorizationId === "trusted",
    });
    const history = new GitTurnHistory({ root: join(root, "private-history"), workspace });
    let writable = true;
    const native = createManagedNativeTurns({
      workspace,
      history,
      activity,
      assertWritable: async () => {
        if (!writable) throw new Error("Workspace recovery pending");
      },
      authorize: async (value) =>
        [owner.ownerId, secondOwner.ownerId].includes(value.ownerId) &&
        value.authorizationId === "trusted",
    });
    return {
      store,
      registry,
      activity,
      history,
      native,
      process,
      block: () => {
        writable = false;
      },
    };
  };
  const graph = await compose();
  const project = await graph.store.addProject(repo, "Native project");
  const { workspace } = await graph.registry.prepare({
    projectId: project.id,
    environmentId: graph.store.environmentId,
    owner: { kind: "session", id: "native-session" },
    slug: "Native session",
    idempotencyKey: "native-workspace",
  });
  return {
    ...graph,
    root,
    repo,
    workspace,
    compose,
    request: {
      workspaceId: workspace.id,
      sessionId: "native-session",
      userBlockId: "user-one",
      runId: "run-one",
      conversationRevision: 1,
    },
  };
}

it("captures real native turn commits with durable owner binding and idempotent before/end receipts", async () => {
  const f = await fixture();
  const first = await f.native.begin(f.request, owner);
  expect(first.before.status).toBe("complete");
  const binding = await readFile(
    join(f.root, "private-history", "native-turns", f.workspace.id, "user-one.json"),
    "utf8",
  );
  expect(binding).not.toContain(owner.ownerId);
  expect(binding).not.toContain(owner.authorizationId);
  expect(JSON.parse(binding).ownerFingerprint).toMatch(/^[a-f0-9]{64}$/);
  const pending = await f.native.status(f.request, owner);
  expect(pending.activity?.ownerId).toMatch(/^native-turn:[a-f0-9]{64}:[a-f0-9]{64}$/);
  expect(await f.native.begin(f.request, owner)).toEqual(first);
  expect(await f.activity.list(f.workspace.id)).toHaveLength(1);
  await writeFile(join(f.workspace.path, "source.txt"), "native implementation\n");
  await turnGit(f.workspace.path, ["add", "."]);
  await turnGit(f.workspace.path, ["commit", "-m", "native turn implementation"]);
  const ended = await f.native.end(f.request, owner);
  expect(ended.after?.status).toBe("complete");
  if (ended.after?.status !== "complete") throw new Error("Missing after snapshot");
  expect(ended.after.snapshot.head).toBe(await gitText(f.workspace.path, ["rev-parse", "HEAD"]));
  expect(await f.activity.list(f.workspace.id)).toEqual([]);
  expect(await f.native.end(f.request, owner)).toEqual(ended);
  expect(await f.native.begin(f.request, owner)).toEqual(ended);
  const laterWriter = await f.activity.start({
    workspaceId: f.workspace.id,
    kind: "shell",
    ownerId: "later-turn-shell",
  });

  expect(await f.native.end(f.request, owner)).toEqual(ended);
  expect(await f.native.begin(f.request, owner)).toEqual(ended);
  expect((await f.activity.list(f.workspace.id)).map((value) => value.id)).toEqual([
    laterWriter.id,
  ]);
  await f.activity.stop(laterWriter.id);
  await f.store.close();
  const reopened = await f.compose();
  expect(await reopened.native.status(f.request, owner)).toEqual({ record: ended, activity: null });
  await expect(reopened.native.end(f.request, secondOwner)).rejects.toThrow("another owner device");
}, 120_000);

it("rejects untrusted ownership, another writer and changed accepted turn identities", async () => {
  const f = await fixture();
  await expect(f.native.begin(f.request, { ...owner, authorizationId: "forged" })).rejects.toThrow(
    "authenticated owner",
  );
  await expect(f.native.begin({ ...f.request, sessionId: "other-session" }, owner)).rejects.toThrow(
    "does not own",
  );
  const shell = await f.activity.start({
    workspaceId: f.workspace.id,
    kind: "shell",
    ownerId: "another-writer",
  });
  await expect(f.native.begin(f.request, owner)).rejects.toThrow("Another workspace writer");
  expect((await f.native.recover(f.request, owner)).released).toBe(true);
  await f.activity.stop(shell.id);
  f.request.userBlockId = "user-race";
  f.request.runId = "run-race";
  const start = f.activity.start.bind(f.activity);
  let racedActivity: string | undefined;
  const startSpy = vi.spyOn(f.activity, "start").mockImplementation(async (input) => {
    const accepted = await start(input);
    racedActivity = (
      await start({ workspaceId: f.workspace.id, kind: "shell", ownerId: "racing-shell" })
    ).id;
    return accepted;
  });
  await expect(f.native.begin(f.request, owner)).rejects.toThrow("Another workspace writer");
  startSpy.mockRestore();
  expect((await f.activity.list(f.workspace.id)).map((value) => value.id)).toEqual([racedActivity]);
  await f.activity.stop(racedActivity!);
  expect((await f.native.recover(f.request, owner)).released).toBe(true);
  f.request.userBlockId = "user-accepted";
  f.request.runId = "run-accepted";
  await f.native.begin(f.request, owner);
  await expect(f.native.begin(f.request, secondOwner)).rejects.toThrow("another owner device");
  await expect(f.native.begin({ ...f.request, conversationRevision: 2 }, owner)).rejects.toThrow(
    "revision changed",
  );
  await expect(f.native.end({ ...f.request, runId: "other-run" }, owner)).rejects.toThrow(
    "identity changed",
  );
  await expect(f.native.status(f.request, secondOwner)).rejects.toThrow("another owner device");
  f.block();
  await expect(f.native.end(f.request, owner)).rejects.toThrow("recovery pending");
  expect((await f.native.status(f.request, owner)).activity).not.toBeNull();
}, 120_000);

it("retains failed after-capture activity and resumes the same durable marker after host reconstruction", async () => {
  const f = await fixture();
  await f.native.begin(f.request, owner);
  const firstActivity = (await f.native.status(f.request, owner)).activity!;
  await writeFile(join(f.workspace.path, "source.txt"), "finished native changes\n");
  vi.spyOn(f.history, "capture").mockRejectedValueOnce(
    new Error("temporary after capture failure"),
  );
  await expect(f.native.end(f.request, owner)).rejects.toThrow("temporary after capture failure");
  expect((await f.native.status(f.request, owner)).activity?.id).toBe(firstActivity.id);
  await f.store.close();
  const reopened = await f.compose();
  expect((await reopened.native.status(f.request, owner)).activity?.id).toBe(firstActivity.id);
  expect((await reopened.native.end(f.request, owner)).after?.status).toBe("complete");
  expect(await reopened.activity.list(f.workspace.id)).toEqual([]);
}, 120_000);

it("releases a rejected before capture and starts the next turn while fencing delayed retries", async () => {
  const f = await fixture();
  vi.spyOn(f.history, "capture").mockRejectedValueOnce(
    new Error("temporary before capture failure"),
  );
  await expect(f.native.begin(f.request, owner)).rejects.toThrow(
    "temporary before capture failure",
  );
  expect(await f.activity.list(f.workspace.id)).toEqual([]);
  expect((await f.native.recover(f.request, owner)).released).toBe(true);
  await expect(f.native.begin(f.request, owner)).rejects.toThrow("released before execution");
  f.request.userBlockId = "next-user";
  f.request.runId = "next-run";
  expect((await f.native.begin(f.request, owner)).before.status).toBe("complete");
  const marker = (await f.native.status(f.request, owner)).activity!;
  await f.activity.stop(marker.id);
  await expect(f.native.end(f.request, owner)).rejects.toThrow("activity is missing");
}, 120_000);

it("captures three committed native turns after provider retirement then rewinds and undoes", async () => {
  const f = await fixture();
  const provider = {
    activityId: "provider-process",
    cwd: f.workspace.path,
    kind: "provider" as const,
    sessionId: f.request.sessionId,
  };
  const heads: string[] = [];
  for (let turn = 1; turn <= 3; turn++) {
    const process = { ...provider, activityId: `provider-process-${turn}` };
    await f.process.start(process, owner);
    if (turn === 1)
      await expect(
        f.process.start({ ...provider, activityId: "duplicate-process" }, owner),
      ).rejects.toThrow("another writer");
    const request = {
      ...f.request,
      userBlockId: `user-${turn}`,
      runId: `run-${turn}`,
      conversationRevision: turn,
    };
    expect((await f.native.begin(request, owner)).before.status).toBe("complete");
    await expect(f.native.end(request, owner)).rejects.toThrow("Another workspace writer");
    expect((await f.native.status(request, owner)).record?.after).toBeUndefined();
    await writeFile(join(f.workspace.path, "source.txt"), `native turn ${turn}\n`);
    await turnGit(f.workspace.path, ["add", "source.txt"]);
    await turnGit(f.workspace.path, ["commit", "-m", `native turn ${turn}`]);
    heads.push(await gitText(f.workspace.path, ["rev-parse", "HEAD"]));
    await f.process.end({ activityId: process.activityId }, owner);
    const record = await f.native.end(request, owner);
    expect(record.after?.status).toBe("complete");
    expect(await f.activity.list(f.workspace.id)).toHaveLength(0);
  }
  expect(new Set(heads).size).toBe(3);
  expect((await f.history.list(f.workspace.id, f.request.sessionId)).length).toBe(3);
  expect(await f.activity.list(f.workspace.id)).toEqual([]);
  let transcript = { revision: 3, userBlockIds: ["user-1", "user-2", "user-3"] };
  const rescues = new Map<string, typeof transcript>();
  const receipts = new Map<string, { revision: number }>();
  const conversation: ConversationRewindAdapter = {
    read: async () => structuredClone(transcript),
    settle: async () => {},
    withSessionGate: async (_id, work) => work(),
    rescue: async (operationId) => {
      rescues.set(operationId, structuredClone(transcript));
      return operationId;
    },
    restore: async (request) => {
      const receipt = receipts.get(request.operationId);
      if (receipt) return receipt;
      expect(request.expectedRevision).toBe(transcript.revision);
      const ids =
        request.direction === "rewind"
          ? transcript.userBlockIds.slice(0, transcript.userBlockIds.indexOf(request.userBlockId))
          : rescues.get(request.transcriptRescueId!)!.userBlockIds;
      transcript = { revision: transcript.revision + 1, userBlockIds: [...ids] };
      const result = { revision: transcript.revision };
      receipts.set(request.operationId, result);
      return result;
    },
    receipt: async (id) => receipts.get(id) ?? null,
  };
  const rewind = new GitSessionRewindService({
    root: join(f.root, "rewind"),
    history: f.history,
    registry: f.registry,
    activity: f.activity,
    conversation,
  });
  const plan = await rewind.plan({
    workspaceId: f.workspace.id,
    sessionId: f.request.sessionId,
    expectedRevision: f.workspace.revision,
    expectedConversationRevision: transcript.revision,
    direction: "rewind",
    userBlockId: "user-3",
  });
  expect(plan.blockers).toEqual([]);
  const applied = await rewind.apply({
    workspaceId: f.workspace.id,
    sessionId: f.request.sessionId,
    expectedRevision: plan.expectedRevision,
    expectedConversationRevision: plan.expectedConversationRevision,
    planToken: plan.token,
    idempotencyKey: "rewind-third",
  });
  expect(await gitText(f.workspace.path, ["rev-parse", "HEAD"])).toBe(heads[1]);
  expect(await readFile(join(f.workspace.path, "source.txt"), "utf8")).toBe("native turn 2\n");
  expect(transcript.userBlockIds).toEqual(["user-1", "user-2"]);
  const undo = await rewind.plan({
    workspaceId: f.workspace.id,
    sessionId: f.request.sessionId,
    expectedRevision: applied.workspaceRevision,
    expectedConversationRevision: applied.conversationRevision,
    direction: "undo",
    operationId: applied.operationId,
  });
  await rewind.undo({
    workspaceId: f.workspace.id,
    sessionId: f.request.sessionId,
    expectedRevision: undo.expectedRevision,
    expectedConversationRevision: undo.expectedConversationRevision,
    planToken: undo.token,
    idempotencyKey: "undo-third",
  });
  expect(await gitText(f.workspace.path, ["rev-parse", "HEAD"])).toBe(heads[2]);
  expect(await readFile(join(f.workspace.path, "source.txt"), "utf8")).toBe("native turn 3\n");
  expect(transcript.userBlockIds).toEqual(["user-1", "user-2", "user-3"]);
}, 300_000);

it("keeps foreign devices, runs, terminals, dirty buffers and duplicate providers fenced", async () => {
  const f = await fixture();
  const provider = {
    activityId: "foreign-provider",
    cwd: f.workspace.path,
    kind: "provider" as const,
    sessionId: f.request.sessionId,
  };
  await f.process.start(provider, secondOwner);
  await expect(f.native.begin(f.request, owner)).rejects.toThrow("Another workspace writer");
  expect((await f.native.recover(f.request, owner)).released).toBe(true);
  await f.process.end({ activityId: provider.activityId }, secondOwner);
  f.request.userBlockId = "user-terminal";
  f.request.runId = "run-terminal";

  await f.process.start({ ...provider, activityId: "terminal", kind: "terminal" }, owner);
  await expect(f.native.begin(f.request, owner)).rejects.toThrow("Another workspace writer");
  await f.process.end({ activityId: "terminal" }, owner);
  f.request.userBlockId = "user-duplicates";
  f.request.runId = "run-duplicates";

  const duplicate = await f.activity.start({
    workspaceId: f.workspace.id,
    kind: "provider",
    ownerId: `${nativeProcessPrefix(owner.ownerId, f.request.sessionId)}duplicate-one`,
  });
  const duplicateTwo = await f.activity.start({
    workspaceId: f.workspace.id,
    kind: "provider",
    ownerId: `${nativeProcessPrefix(owner.ownerId, f.request.sessionId)}duplicate-two`,
  });
  await expect(f.native.begin(f.request, owner)).rejects.toThrow("Multiple native provider");
  await f.activity.stop(duplicate.id);
  await f.activity.stop(duplicateTwo.id);
  f.request.userBlockId = "user-buffers";
  f.request.runId = "run-buffers";

  const buffers = (dirty: boolean) => ({
    clientId: "editor",
    instanceId: "window",
    processId: 1234,
    owners: [
      {
        ownerId: "editor",
        updatedAt: Date.now(),
        unknown: false,
        buffers: [{ path: join(f.workspace.path, "source.txt"), dirty }],
      },
    ],
  });
  await f.process.updateBuffers(buffers(true), owner);
  await expect(f.native.begin(f.request, owner)).rejects.toThrow("Another workspace writer");
  await f.process.updateBuffers(buffers(false), owner);
  f.request.userBlockId = "user-clear";
  f.request.runId = "run-clear";
  await f.native.begin(f.request, owner);
  await expect(
    f.native.begin({ ...f.request, userBlockId: "foreign-run", runId: "foreign-run" }, owner),
  ).rejects.toThrow("Another workspace writer");
}, 180_000);

it("self-heals legacy starting bindings only after Host proves no capture and no activity", async () => {
  const f = await fixture();
  const shell = await f.activity.start({
    workspaceId: f.workspace.id,
    kind: "shell",
    ownerId: "foreign",
  });
  await expect(f.native.begin(f.request, owner)).rejects.toThrow("Another workspace writer");
  const path = join(
    f.root,
    "private-history",
    "native-turns",
    f.workspace.id,
    `${f.request.userBlockId}.json`,
  );
  const binding = JSON.parse(await readFile(path, "utf8"));
  delete binding.released; // Simulate a 0.6.92 binding abandoned before history.begin.
  await writeFile(path, JSON.stringify(binding));
  expect(await f.native.recover(f.request, owner)).toMatchObject({
    released: false,
    reason: expect.stringContaining("activity"),
  });
  await expect(f.native.recover(f.request, secondOwner)).rejects.toThrow("another owner device");
  await expect(f.native.recover({ ...f.request, runId: "wrong-run" }, owner)).rejects.toThrow(
    "identity changed",
  );
  await expect(f.native.recover({ ...f.request, conversationRevision: 2 }, owner)).rejects.toThrow(
    "revision changed",
  );
  await f.activity.stop(shell.id);
  expect(await f.native.recover(f.request, owner)).toEqual({ ...f.request, released: true });
  await f.store.close();
  const reopened = await f.compose();
  expect(await reopened.native.recover(f.request, owner)).toEqual({ ...f.request, released: true });
  await expect(reopened.native.begin(f.request, owner)).rejects.toThrow(
    "released before execution",
  );
  expect(
    (
      await reopened.native.begin(
        { ...f.request, userBlockId: "next-user", runId: "next-run" },
        owner,
      )
    ).before.status,
  ).toBe("complete");
}, 120_000);

it("never releases an authorized before capture even when its process and marker have disappeared", async () => {
  const f = await fixture();
  await f.native.begin(f.request, owner);
  const marker = (await f.native.status(f.request, owner)).activity!;
  expect(await f.native.recover(f.request, owner)).toMatchObject({
    released: false,
    reason: expect.stringContaining("complete before capture"),
  });
  await f.activity.stop(marker.id);
  expect(await f.native.recover(f.request, owner)).toMatchObject({ released: false });
  await f.store.close();
  const reopened = await f.compose();
  expect(await reopened.native.recover(f.request, owner)).toMatchObject({ released: false });
}, 120_000);

it("tombstones a missing unknown turn before releasing and rejects a delayed begin", async () => {
  const f = await fixture();
  const provider = {
    activityId: "live-provider",
    cwd: f.workspace.path,
    kind: "provider" as const,
    sessionId: f.request.sessionId,
  };
  await f.process.start(provider, owner);
  expect(await f.native.recover(f.request, owner)).toMatchObject({ released: false });
  await f.process.end({ activityId: provider.activityId }, owner);
  expect(await f.native.recover(f.request, owner)).toEqual({ ...f.request, released: true });
  await expect(f.native.begin(f.request, owner)).rejects.toThrow("released before execution");
  expect(await f.history.get(f.workspace.id, f.request.userBlockId)).toBeNull();
}, 120_000);
