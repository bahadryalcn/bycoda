import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostEngine } from "./engine";
import { HostStore } from "./store";
import { createManagedWorkspaceRuntime } from "./managed-workspace-runtime";
import { createManagedNativeRewind } from "./managed-native-rewind";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture(options: Parameters<typeof createManagedWorkspaceRuntime>[2] = {}) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "managed-runtime-")));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(root, "source.txt"), "base\n");
  git("add", "source.txt");
  git("commit", "-qm", "base");
  mkdirSync(join(root, "private"));
  const store = new HostStore(join(root, "private", "host.db"));
  const send = vi.fn(async () => {});
  const engine = new HostEngine(store, {
    codex: {
      send,
      bind: () => {},
      stop: async () => {},
      cancel: async () => {},
      approve: () => {},
      answer: () => {},
    },
  });
  const project = await engine.openProject(root);
  const runtime = createManagedWorkspaceRuntime(store, engine, options);
  cleanups.push(async () => {
    runtime.retention.stop();
    await engine.close();
    await store.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  });
  await runtime.withOwner("test-owner", (owner) =>
    runtime.policy.update(
      {
        projectId: project.id,
        environmentId: store.environmentId,
        expectedRevision: 0,
        idempotencyKey: "policy",
        policy: {
          root: join(root, "worktrees"),
          disk: { minimumFreeBytes: 1, budgetBytes: 1024 ** 3, warningRatio: 0.8 },
        },
      },
      owner,
    ),
  );
  const request = {
    projectId: project.id,
    environmentId: store.environmentId,
    owner: { kind: "session" as const, id: "owned-session" },
    slug: "source",
    idempotencyKey: "prepare",
  };
  return { root, git, store, engine, runtime, project, request, send };
}

it("reads legacy registry paths beneath an aliased ancestor and rejects a linked workspace entry", async () => {
  const f = await fixture();
  await f.runtime.recover();
  const { workspace } = await f.runtime.registry.prepare(f.request);
  const alias = join(f.root, "alias");
  symlinkSync(f.root, alias, process.platform === "win32" ? "junction" : "dir");
  const legacy = {
    ...workspace,
    path: join(alias, "worktrees", basename(workspace.path)),
  };
  // Seed a pre-canonicalization row directly; the public write API must keep
  // rejecting path changes to an existing workspace's immutable identity.
  await f.store.db
    .prepare("UPDATE managed_workspaces SET path=?, payload=? WHERE id=?")
    .run(legacy.path, JSON.stringify(legacy), workspace.id);
  expect((await f.runtime.workspace(workspace.id)).path).toBe(workspace.path);
  const endpoint = join(f.root, "linked-workspace");
  symlinkSync(workspace.path, endpoint, process.platform === "win32" ? "junction" : "dir");
  await f.store.db
    .prepare("UPDATE managed_workspaces SET path=?, payload=? WHERE id=?")
    .run(endpoint, JSON.stringify({ ...legacy, path: endpoint }), workspace.id);
  await expect(f.runtime.workspace(workspace.id)).rejects.toThrow("symbolic link or reparse point");
});

it("prepares an owned workspace at the Host creation boundary for a client without workspace fields", async () => {
  const f = await fixture();
  await f.runtime.recover();
  const command = {
    type: "create",
    commandId: "older-client",
    projectId: f.project.id,
    harness: "codex",
    model: "fixture",
    runtimeMode: "supervised",
  };
  const created = await f.engine.command(command);
  expect(await f.engine.command(command)).toEqual(created);
  const session = (await f.store.session(created.sessionId)).session;
  expect(session.workspaceId).toBeTruthy();
  expect(session.cwd).not.toBe(f.root);
  expect(session.worktreeCwd).toBe(session.cwd);
  expect((await f.runtime.workspace(session.workspaceId!)).owner).toEqual({
    kind: "session",
    id: created.sessionId,
  });
  await f.engine.command({
    type: "send",
    commandId: "older-send",
    sessionId: created.sessionId,
    text: "Work independently",
  });
  await f.engine.waitForRun(created.sessionId, (await f.store.session(created.sessionId)).runId);
  expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ cwd: session.cwd }));
  const prepare = vi
    .spyOn(f.runtime.registry, "prepare")
    .mockRejectedValueOnce(new Error("Preparation unavailable"));
  await expect(f.engine.command({ ...command, commandId: "preparation-failed" })).rejects.toThrow(
    "Preparation unavailable",
  );
  expect(prepare).toHaveBeenCalledOnce();
  expect((await f.store.sessions()).filter((entry) => entry.session.cwd === f.root)).toHaveLength(
    0,
  );
});

it("requires an explicit current choice and gives a contextual legacy source an independent workspace", async () => {
  const f = await fixture();
  await f.runtime.recover();
  const created = await f.engine.command({
    type: "create",
    commandId: "explicit-current",
    projectId: f.project.id,
    workspaceMode: "current",
    harness: "codex",
    model: "fixture",
    runtimeMode: "supervised",
  });
  const source = await f.store.session(created.sessionId);
  expect(source.session.cwd).toBe(f.root);
  await f.store.save(
    {
      ...source,
      revision: source.revision + 1,
      session: {
        ...source.session,
        harness: "claude",
        blocks: [
          { id: "legacy-user", role: "user", text: "Existing current-mode work" },
          { id: "legacy-reply", role: "assistant", text: "Context to transfer" },
        ],
      },
    },
    { type: "test.legacy-current" },
  );
  const input = {
    sessionId: created.sessionId,
    sourceBlockId: "legacy-reply",
    expectedRevision: source.revision + 1,
    mode: "handoff",
    harness: "codex",
    model: "fixture",
    modelSettings: {},
  };
  const preview = await f.engine.previewContextual(input);
  const destination = await f.engine.command({
    ...input,
    type: "contextual",
    commandId: "legacy-handoff",
    previewDigest: preview.digest,
  });
  const session = (await f.store.session(destination.sessionId)).session;
  expect(session.workspaceId).toBeTruthy();
  expect(session.cwd).not.toBe(f.root);
  expect((await f.store.session(created.sessionId)).session.cwd).toBe(f.root);
});

it("gives a reopened old Host row without workspaceMode an independent contextual workspace", async () => {
  const f = await fixture();
  const baseCommit = f.git("rev-parse", "HEAD");
  // Seed the snapshot shape written by older Hosts, without passing through the
  // current create command (which stamps an explicit compatibility mode).
  await f.store.save(
    {
      projectId: f.project.id,
      revision: 1,
      status: "idle",
      updatedAt: 1,
      session: {
        id: "old-host-session",
        cwd: f.root,
        harness: "claude",
        model: "fixture",
        runtimeMode: "supervised",
        modelSettings: {},
        title: "Old Host conversation",
        blocks: [
          { id: "old-user", role: "user", text: "Existing legacy work" },
          { id: "old-reply", role: "assistant", text: "Legacy context to transfer" },
        ],
      },
    },
    { type: "test.old-host-snapshot" },
  );
  const store = new HostStore(join(f.root, "private", "host.db"));
  const send = vi.fn(async () => {});
  const legacySend = vi.fn(async () => {});
  const provider = {
    send,
    bind: () => {},
    stop: async () => {},
    cancel: async () => {},
    approve: () => {},
    answer: () => {},
  };
  const engine = new HostEngine(store, {
    codex: provider,
    claude: { ...provider, send: legacySend },
  });
  const runtime = createManagedWorkspaceRuntime(store, engine);
  cleanups.push(async () => {
    runtime.retention.stop();
    await engine.close();
    await store.close();
  });
  await runtime.recover();
  const source = await store.session("old-host-session");
  expect(source.session).not.toHaveProperty("workspaceMode");
  expect(source.session).not.toHaveProperty("workspaceId");
  const input = {
    sessionId: source.session.id,
    sourceBlockId: "old-reply",
    expectedRevision: source.revision,
    mode: "handoff",
    harness: "codex",
    model: "fixture",
    modelSettings: {},
  };
  const preview = await engine.previewContextual(input);
  const destination = await engine.command({
    ...input,
    type: "contextual",
    commandId: "old-host-handoff",
    previewDigest: preview.digest,
  });
  const session = (await store.session(destination.sessionId)).session;
  expect(session.workspaceId).toBeTruthy();
  expect(session.cwd).not.toBe(f.root);
  expect(session.worktreeCwd).toBe(session.cwd);
  expect((await runtime.workspace(session.workspaceId!)).owner).toEqual({
    kind: "session",
    id: destination.sessionId,
  });
  expect(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: session.cwd,
      encoding: "utf8",
      windowsHide: true,
    }).trim(),
  ).toBe(baseCommit);
  expect(send).not.toHaveBeenCalled();
  await engine.command({
    type: "send",
    commandId: "old-host-contextual-send",
    sessionId: destination.sessionId,
    text: "Continue the transferred work",
  });
  await engine.waitForRun(
    destination.sessionId,
    (await store.session(destination.sessionId)).runId,
  );
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ cwd: session.cwd }));
  expect(legacySend).not.toHaveBeenCalled();
  expect(await store.session(source.session.id)).toEqual(source);
  expect(f.git("rev-parse", "HEAD")).toBe(baseCommit);
});

it("recovers a native receipt saved before Host finalization after reconstructing its adapter", async () => {
  const f = await fixture({
    afterNativeReceiptSaved: async () => {
      throw new Error("simulated crash after native receipt");
    },
  });
  await f.runtime.recover();
  const { workspace } = await f.runtime.registry.prepare(f.request);
  const turn = {
    workspaceId: workspace.id,
    sessionId: "owned-session",
    userBlockId: "native-user",
    runId: "native-run",
    conversationRevision: 1,
  };
  await f.runtime.withOwner("native-device", async (owner) => {
    await f.runtime.nativeRewind.bindTurn(turn, owner);
    await f.runtime.nativeTurns.begin(turn, owner);
    writeFileSync(join(workspace.path, "source.txt"), "native changed\n");
    await f.runtime.nativeTurns.end(turn, owner);
    const conversation = { revision: 2, userBlockIds: [turn.userBlockId] };
    const plan = await f.runtime.nativeRewind.plan(
      {
        request: {
          workspaceId: workspace.id,
          sessionId: turn.sessionId,
          expectedRevision: workspace.revision,
          expectedConversationRevision: 2,
          direction: "rewind",
          userBlockId: turn.userBlockId,
        },
        conversation,
      },
      owner,
    );
    const request = {
      workspaceId: workspace.id,
      sessionId: turn.sessionId,
      expectedRevision: workspace.revision,
      expectedConversationRevision: 2,
      planToken: plan.token,
      idempotencyKey: "native-crash",
    };
    const prepared = await f.runtime.nativeRewind.prepare(
      { request, conversation, direction: "rewind" },
      owner,
    );
    await f.runtime.nativeRewind.apply(
      {
        operationId: prepared.operationId,
        request,
        direction: "rewind",
        transcriptRescueId: prepared.operationId,
      },
      owner,
    );
    await expect(
      f.runtime.nativeRewind.ack(
        { operationId: prepared.operationId, receipt: { revision: 3 } },
        owner,
      ),
    ).rejects.toThrow("simulated crash");
    await expect(f.runtime.assertWritable(workspace.id)).rejects.toThrow("recovery");
    const recovered = createManagedNativeRewind({
      ...f.runtime.rewind.options,
      authorize: async (candidate) => candidate === owner,
      isHostSession: async (id) => !!(await f.store.sessionAuthority(id)),
    });
    const status = await recovered.status({ operationId: prepared.operationId }, owner);
    expect(status).toMatchObject({
      phase: "complete",
      finalized: true,
      receipt: { conversationRevision: 3 },
    });
    await expect(f.runtime.assertWritable(workspace.id)).resolves.toBeUndefined();
    await expect(
      recovered.ack({ operationId: prepared.operationId, receipt: { revision: 3 } }, owner),
    ).resolves.toMatchObject({ acknowledged: true, finalized: true });
  });
}, 120_000);

it("recovers an interrupted materialization before enabling managed writes without replaying its request", async () => {
  const f = await fixture();
  const save = f.store.saveWorkspaceOperation.bind(f.store);
  let interrupted = false;
  const failure = vi
    .spyOn(f.store, "saveWorkspaceOperation")
    .mockImplementation(async (operation, phase) => {
      if (operation.kind === "create" && operation.phase === "materialized" && !interrupted) {
        interrupted = true;
        throw new Error("interrupted host");
      }
      await save(operation, phase);
    });
  await expect(f.runtime.registry.prepare(f.request)).rejects.toThrow("interrupted host");
  failure.mockRestore();
  const [planned] = await f.store.managedWorkspaces();
  expect(existsSync(planned.path)).toBe(true);
  await expect(f.runtime.assertWritable(planned.id)).rejects.toThrow("startup recovery");
  const before = f.git("rev-parse", "HEAD");
  const results = await f.runtime.recover();
  expect(results.filter((result) => result.error)).toEqual([]);
  const recovered = await f.runtime.get(planned.id);
  expect(recovered).toMatchObject({
    id: planned.id,
    path: planned.path,
    baseCommit: before,
    directoryState: "present",
    revision: 1,
  });
  await expect(f.runtime.assertWritable(planned.id)).resolves.toBeUndefined();
  expect((await f.runtime.registry.listOperations(planned.id))[0].phase).toBe("complete");
  expect(await f.runtime.registry.prepare(f.request)).toMatchObject({ workspace: recovered });
});

it("accepts only transport-issued owner proof and fences every start while a workspace is reserved", async () => {
  const f = await fixture();
  await f.runtime.recover();
  const { workspace } = await f.runtime.registry.prepare(f.request);
  const request = {
    workspaceId: workspace.id,
    expectedRevision: workspace.revision,
    idempotencyKey: "pin",
    pinned: true,
  };
  await expect(
    f.runtime.registry.pin(request, { ownerId: "test-owner", authorizationId: "claimed" }),
  ).rejects.toThrow("owner");
  await f.runtime.withOwner("test-owner", (owner) => f.runtime.registry.pin(request, owner));
  const current = await f.runtime.get(workspace.id);
  const reservation = await f.runtime.activity.reserve({
    workspaceId: current.id,
    expectedRevision: current.revision,
    purpose: "removal",
    operationId: "reviewed-operation",
  });
  await expect(
    f.runtime.activity.start({ workspaceId: current.id, kind: "editor", ownerId: "owner" }),
  ).rejects.toThrow("reserved");
  await f.runtime.activity.release(reservation.id);
  const editor = await f.runtime.activity.start({
    workspaceId: current.id,
    kind: "editor",
    ownerId: "owner",
    dirtyBuffer: true,
  });
  await expect(
    f.runtime.activity.reserve({
      workspaceId: current.id,
      expectedRevision: current.revision,
      purpose: "rewind",
      operationId: "rewind",
    }),
  ).rejects.toThrow("use");
  await f.runtime.activity.stop(editor.id);
});

it("prevents a host provider from starting while the same managed session has a native turn in flight", async () => {
  const f = await fixture();
  await f.runtime.recover();
  const { workspace } = await f.runtime.registry.prepare(f.request);
  const created = await f.engine.command({
    type: "create",
    commandId: "host-create",
    projectId: f.project.id,
    workspaceId: workspace.id,
    harness: "codex",
    model: "fixture",
    modelSettings: {},
    runtimeMode: "supervised",
  });
  const boundary = {
    workspaceId: workspace.id,
    sessionId: created.sessionId,
    runId: "native-run",
    userBlockId: "native-user",
    conversationRevision: 0,
  };
  await f.runtime.withOwner("native-device", (owner) =>
    f.runtime.nativeTurns.begin(boundary, owner),
  );
  await f.engine.command({
    type: "send",
    commandId: "host-send",
    sessionId: created.sessionId,
    text: "must remain blocked",
  });
  await vi.waitFor(
    async () => expect((await f.store.session(created.sessionId)).status).not.toBe("running"),
    { timeout: 10_000 },
  );
  expect(f.send).not.toHaveBeenCalled();
  expect(JSON.stringify((await f.store.session(created.sessionId)).session.blocks)).toContain(
    "native provider",
  );
  await f.runtime.withOwner("native-device", (owner) => f.runtime.nativeTurns.end(boundary, owner));
});
