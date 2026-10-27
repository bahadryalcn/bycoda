import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as identity from "./build-identity";
import { HostEngine } from "./engine";
import type { HostProvider } from "./providers";
import { createHostServer } from "./server";
import { HostStore } from "./store";
import { DeliveryEffectNotAppliedError, GitHubDeliveryPublication } from "./branch-delivery";
import type { BuildIdentity, ManagedWorkspace, SessionRewindPlan } from "./workspace-contracts";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 });
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    windowsHide: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  }).trim();

async function fixture(buildIdentity: BuildIdentity | null = null, send?: HostProvider["send"]) {
  vi.spyOn(identity, "readHostBuildIdentity").mockReturnValue(buildIdentity);
  const root = mkdtempSync(join(tmpdir(), "bycoda-managed-rpc-"));
  const target = join(root, "repo");
  mkdirSync(target);
  git(target, "init", "-q", "-b", "main");
  git(target, "config", "user.name", "Managed RPC Test");
  git(target, "config", "user.email", "managed-rpc@example.test");
  git(target, "config", "commit.gpgsign", "false");
  git(target, "config", "core.autocrlf", "false");
  writeFileSync(join(target, "source.txt"), "baseline source\n");
  writeFileSync(join(target, "owner.txt"), "baseline owner\n");
  git(target, "add", ".");
  git(target, "commit", "-qm", "RPC baseline");
  const store = new HostStore(join(root, "host.db"));
  const provider: HostProvider = {
    async send(input) {
      if (send) return send(input);
      writeFileSync(join(input.cwd, "source.txt"), `${input.text}\n`);
      git(input.cwd, "add", "source.txt");
      git(input.cwd, "commit", "-qm", input.text);
    },
    stop: async () => {},
    cancel: async () => {},
    bind: () => {},
    approve: () => {},
    answer: () => {},
  };
  const engine = new HostEngine(store, { codex: provider });
  const project = await engine.openProject(target);
  const server = await createHostServer(engine, ["codex"]);
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.closeResources();
    await engine.close();
    await store.close();
    if (!root.startsWith(join(tmpdir(), "bycoda-managed-rpc-")))
      throw new Error("Unsafe RPC fixture cleanup");
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const device = await store.issueDevice("Owner test device");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
  const request = async (method: string, params: unknown = {}, token = device.token) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
    });
    return {
      status: response.status,
      value: (await response.json()) as { result?: any; error?: string },
    };
  };
  const call = async <T = any>(method: string, params: unknown = {}): Promise<T> => {
    const result = await request(method, params);
    expect(result.status, `${method}: ${result.value.error ?? ""}`).toBe(200);
    expect(result.value.error, method).toBeUndefined();
    return result.value.result as T;
  };
  const projectScope = { projectId: project.id, environmentId: store.environmentId };
  await call("projects.workspacePolicy.update", {
    ...projectScope,
    expectedRevision: 0,
    idempotencyKey: "rpc-fixture-policy",
    policy: {
      defaultMode: "worktree",
      root: join(root, "worktrees"),
      disk: { budgetBytes: 1024 ** 3, warningRatio: 0.8, minimumFreeBytes: 1 },
    },
  });
  return { root, target, store, engine, projectScope, server, device, request, call };
}

it("defaults authenticated creation without a choice to current and preserves explicit worktree opt-in", async () => {
  const f = await fixture();
  await f.call("projects.workspacePolicy.update", {
    ...f.projectScope,
    expectedRevision: 1,
    idempotencyKey: "default-policy",
    policy: { root: join(f.root, "worktrees"), disk: { minimumFreeBytes: 1 } },
  });
  const command = {
    type: "create",
    commandId: "rpc-current-default",
    projectId: f.projectScope.projectId,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  };
  const receipt = await f.call("commands.dispatch", command);
  expect(await f.call("commands.dispatch", command)).toEqual(receipt);
  const session = (await f.store.session(receipt.sessionId)).session;
  expect(session.cwd).toBe(f.target);
  expect(session.workspaceId).toBeUndefined();
  expect(session.workspaceMode).toBe("current");
  const managed = await f.call("commands.dispatch", {
    ...command,
    commandId: "rpc-worktree-opt-in",
    workspaceMode: "worktree",
  });
  const managedSession = (await f.store.session(managed.sessionId)).session;
  expect(managedSession.workspaceId).toBeTruthy();
  expect(managedSession.cwd).not.toBe(f.target);
});

it("prepares independent execution for project worktree policy before authenticated old-client atomic creation dispatches its first turn", async () => {
  const f = await fixture();
  const originalHead = git(f.target, "rev-parse", "HEAD");
  const command = {
    type: "create",
    commandId: "older-client-atomic",
    projectId: f.projectScope.projectId,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
    firstTurn: { type: "send", commandId: "older-client-send", text: "Independent older client" },
  };
  const created = await f.call("commands.dispatch", command);
  expect(await f.call("commands.dispatch", command)).toEqual(created);
  await f.engine.waitForRun(created.sessionId, (await f.store.session(created.sessionId)).runId);
  expect((await f.store.session(created.sessionId)).status).toBe("idle");
  const session = (await f.store.session(created.sessionId)).session;
  expect(session.workspaceId).toBeTruthy();
  expect(session.cwd).not.toBe(f.target);
  const workspace = await f.call<ManagedWorkspace>("workspaces.get", {
    workspaceId: session.workspaceId,
  });
  expect(workspace.owner).toEqual({ kind: "session", id: session.id });
  expect(workspace.path).toBe(session.cwd);
  expect(git(session.cwd, "log", "-1", "--format=%s")).toBe("Independent older client");
  expect(git(f.target, "rev-parse", "HEAD")).toBe(originalHead);
  expect(readFileSync(join(f.target, "source.txt"), "utf8")).toBe("baseline source\n");
});

it("coordinates native Git rewind through rescue, restored status and durable transcript acknowledgement", async () => {
  const f = await fixture();
  const sessionId = randomUUID();
  const prepared = await f.call("workspaces.prepare", {
    ...f.projectScope,
    owner: { kind: "session", id: sessionId },
    idempotencyKey: "native-prepare",
    slug: "native",
    mode: "worktree",
  });
  const workspace = prepared.workspace as ManagedWorkspace;
  const descriptor = await f.call("environment.describe");
  expect(descriptor.capabilities).toEqual(
    expect.arrayContaining([
      "sessions.managedCreation.v1",
      "sessions.native-execution.v1",
      "sessions.native-rewind.v1",
      "workspaces.native-activity.v1",
    ]),
  );
  const boundary = {
    workspaceId: workspace.id,
    sessionId,
    userBlockId: "native-user-1",
    runId: "native-run-1",
    conversationRevision: 4,
  };
  const head = git(workspace.path, "rev-parse", "HEAD");
  await f.call("native.turn.begin", boundary);
  await f.call("native.activity.start", {
    activityId: "native-provider",
    cwd: workspace.path,
    kind: "provider",
    sessionId,
  });
  writeFileSync(join(workspace.path, "source.txt"), "native committed\n");
  git(workspace.path, "add", "source.txt");
  git(workspace.path, "commit", "-qm", "native turn commit");
  writeFileSync(join(workspace.path, "owner.txt"), "native staged\n");
  git(workspace.path, "add", "owner.txt");
  writeFileSync(join(workspace.path, "owner.txt"), "native unstaged\n");
  writeFileSync(join(workspace.path, "untracked.txt"), "native untracked\n");
  expect((await f.request("native.turn.end", boundary)).value.error).toMatch(/activity|writer/i);
  await f.call("native.activity.end", { activityId: "native-provider" });
  await f.call("native.turn.end", boundary);
  const changedHead = git(workspace.path, "rev-parse", "HEAD");
  const beforeStatus = git(workspace.path, "status", "--porcelain=v1");
  const fresh = await f.call("workspaces.get", { workspaceId: workspace.id });
  const conversation = { revision: 5, userBlockIds: [boundary.userBlockId] };
  const plan = await f.call("native.rewind.plan", {
    request: {
      workspaceId: workspace.id,
      sessionId,
      expectedRevision: fresh.revision,
      expectedConversationRevision: 5,
      direction: "rewind",
      userBlockId: boundary.userBlockId,
    },
    conversation,
  });
  const request = {
    workspaceId: workspace.id,
    sessionId,
    expectedRevision: fresh.revision,
    expectedConversationRevision: 5,
    planToken: plan.token,
    idempotencyKey: "native-rewind",
  };
  const pending = await f.call("native.rewind.prepare", {
    request,
    direction: "rewind",
    conversation,
  });
  expect(git(workspace.path, "rev-parse", "HEAD")).toBe(changedHead);
  expect(git(workspace.path, "status", "--porcelain=v1")).toBe(beforeStatus);
  expect((await f.call("native.rewind.status", pending)).phase).toBe("prepared");
  expect(
    (
      await f.request("native.turn.begin", {
        ...boundary,
        userBlockId: "blocked",
        runId: "blocked",
      })
    ).value.error,
  ).toBeTruthy();
  const secondDevice = await f.store.issueDevice("Different native device");
  expect(
    (await f.request("native.rewind.status", pending, secondDevice.token)).value.error,
  ).toBeTruthy();
  await f.call("native.rewind.apply", {
    operationId: pending.operationId,
    request,
    direction: "rewind",
    transcriptRescueId: pending.operationId,
  });
  const restored = await f.call("native.rewind.status", pending);
  expect(restored.phase).toBe("git-restored");
  expect(restored.finalized).toBe(false);
  expect(restored.restoreRequest).toMatchObject({
    operationId: pending.operationId,
    sessionId,
    userBlockId: boundary.userBlockId,
    expectedRevision: 5,
  });
  expect(git(workspace.path, "rev-parse", "HEAD")).toBe(head);
  expect(git(workspace.path, "status", "--porcelain=v1")).toBe("");
  const ack = await f.call("native.rewind.ack", {
    operationId: pending.operationId,
    receipt: { revision: 6 },
  });
  expect(ack).toMatchObject({
    acknowledged: true,
    finalized: true,
    receipt: { conversationRevision: 6 },
  });
  expect(
    await f.call("native.rewind.ack", {
      operationId: pending.operationId,
      receipt: { revision: 6 },
    }),
  ).toEqual(ack);
  expect(
    (
      await f.request("native.rewind.ack", {
        operationId: pending.operationId,
        receipt: { revision: 7 },
      })
    ).value.error,
  ).toBeTruthy();
  const undoPlan = await f.call("native.rewind.plan", {
    request: {
      workspaceId: workspace.id,
      sessionId,
      expectedRevision: ack.receipt.workspaceRevision,
      expectedConversationRevision: 6,
      direction: "undo",
      operationId: pending.operationId,
    },
    conversation: { revision: 6, userBlockIds: [] },
  });
  const undoRequest = {
    ...request,
    expectedRevision: ack.receipt.workspaceRevision,
    expectedConversationRevision: 6,
    planToken: undoPlan.token,
    idempotencyKey: "native-undo",
  };
  const undo = await f.call("native.rewind.prepare", {
    request: undoRequest,
    direction: "undo",
    conversation: { revision: 6, userBlockIds: [] },
  });
  await f.call("native.rewind.apply", {
    operationId: undo.operationId,
    request: undoRequest,
    direction: "undo",
    transcriptRescueId: undo.operationId,
  });
  expect((await f.call("native.rewind.status", undo)).restoreRequest.transcriptRescueId).toBe(
    pending.operationId,
  );
  await f.call("native.rewind.ack", { operationId: undo.operationId, receipt: { revision: 7 } });
  expect(git(workspace.path, "rev-parse", "HEAD")).toBe(changedHead);
  expect(git(workspace.path, "status", "--porcelain=v1")).toBe(beforeStatus);
  expect(readFileSync(join(workspace.path, "untracked.txt"), "utf8")).toBe("native untracked\n");
});

it("dispatches revision-bound pin, host rewind/Undo, approved delivery and cleanup over authenticated HTTP", async () => {
  const f = await fixture();
  const descriptor = await f.call("environment.describe");
  expect(descriptor.capabilities).toEqual(
    expect.arrayContaining([
      "workspaces.managed.v1",
      "workspaces.policy.v1",
      "workspaces.delivery.v1",
      "workspaces.pr-publication.v1",
      "workspaces.lifecycle.v1",
      "workspaces.pinning.v1",
      "sessions.git-rewind.v1",
      "sessions.git-rewind-undo.v1",
    ]),
  );
  expect(descriptor.buildIdentity).toBeUndefined();
  expect(descriptor.capabilities).not.toContain("build.identity.v1");
  const sessionId = randomUUID();
  const prepared = await f.call("workspaces.prepare", {
    ...f.projectScope,
    idempotencyKey: "rpc-workspace",
    owner: { kind: "session", id: sessionId },
    slug: "RPC writer",
  });
  const workspaceId = prepared.workspace.id as string;
  const workspace = () => f.call<ManagedWorkspace>("workspaces.get", { workspaceId });
  const pinRequest = {
    workspaceId,
    expectedRevision: prepared.workspace.revision,
    idempotencyKey: "pin-workspace",
    pinned: true,
  };
  expect((await f.request("workspaces.pin", pinRequest, "invalid-token")).status).toBe(401);
  const pinned = await f.call<ManagedWorkspace>("workspaces.pin", pinRequest);
  expect(pinned.pinned).toBe(true);
  expect(pinned.revision).toBe(pinRequest.expectedRevision + 1);
  expect(await f.call("workspaces.pin", pinRequest)).toEqual(pinned);
  const stalePin = await f.request("workspaces.pin", {
    ...pinRequest,
    idempotencyKey: "stale-pin",
    pinned: false,
  });
  expect(stalePin.status).toBe(400);
  expect(stalePin.value.error).toMatch(/revision/i);
  await f.call("workspaces.pin", {
    ...pinRequest,
    expectedRevision: pinned.revision,
    idempotencyKey: "unpin-workspace",
    pinned: false,
  });
  const createRequest = {
    type: "create",
    commandId: "rpc-create-session",
    workspaceId,
    projectId: f.projectScope.projectId,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
    sessionId,
  };
  expect(
    (await f.request("commands.dispatch", { ...createRequest, sessionId: randomUUID() })).value
      .error,
  ).toMatch(/identity|own/i);
  const created = await f.call("commands.dispatch", createRequest);
  expect(created.sessionId).toBe(sessionId);
  expect(await f.call("commands.dispatch", createRequest)).toEqual(created);
  const grant = await f.call("conversation.access.issue", { sessionId });
  for (const method of [
    "workspaces.pin",
    "workspaces.delivery.merge",
    "workspaces.cleanup.apply",
    "native.buffers.retire",
    "native.buffers.reconcile",
  ]) {
    const denied = await f.request(method, pinRequest, grant.token);
    expect(denied.status).toBe(400);
    expect(denied.value.error).toMatch(/credential|conversation|owner|scope/i);
  }
  const editor = await f.call("workspaces.activities.start", {
    workspaceId,
    kind: "editor",
    dirtyBuffer: true,
  });
  expect(await f.call("workspaces.activities.list", { workspaceId })).toContainEqual(
    expect.objectContaining({ id: editor.id, kind: "editor", dirtyBuffer: true }),
  );
  const editingPlan = await f.call("workspaces.cleanup.plan", {
    workspaceId,
    expectedRevision: (await workspace()).revision,
  });
  expect(editingPlan.blockers.join(" ")).toMatch(/use|activity/i);
  const otherDevice = await f.store.issueDevice("Other owner device");
  const foreignStop = await f.request(
    "workspaces.activities.stop",
    { workspaceId, activityId: editor.id },
    otherDevice.token,
  );
  expect(foreignStop.status).toBe(400);
  expect(foreignStop.value.error).toMatch(/not owned/i);
  expect(
    await f.call("workspaces.activities.stop", { workspaceId, activityId: editor.id }),
  ).toEqual({ stopped: true });
  const storage = await f.call("workspaces.storage.status", f.projectScope);
  expect(storage.materialization).toBe("allowed");
  expect(storage.materializedBytes).toBeGreaterThan(0);
  const initialHead = git(prepared.workspace.path, "rev-parse", "HEAD");
  await f.call("commands.dispatch", {
    type: "send",
    commandId: "rpc-commit-turn",
    sessionId,
    text: "committed over owner transport",
  });
  await vi.waitFor(
    async () => {
      expect((await f.call("sessions.get", { sessionId })).status).toBe("idle");
      expect(
        (await f.server.managedWorkspaces.history.get(workspaceId, "rpc-commit-turn"))?.after
          ?.status,
      ).toBe("complete");
    },
    { timeout: 60_000, interval: 100 },
  );
  const committedHead = git(prepared.workspace.path, "rev-parse", "HEAD");
  expect(committedHead).not.toBe(initialHead);
  const transcript = await f.call("sessions.get", { sessionId });
  const plan = await f.call<SessionRewindPlan>("sessions.rewind.plan", {
    workspaceId,
    sessionId,
    expectedRevision: (await workspace()).revision,
    expectedConversationRevision: transcript.revision,
    direction: "rewind",
    userBlockId: "rpc-commit-turn",
  });
  const rewound = await f.call("sessions.rewind.apply", {
    workspaceId,
    sessionId,
    expectedRevision: plan.expectedRevision,
    expectedConversationRevision: plan.expectedConversationRevision,
    planToken: plan.token,
    idempotencyKey: "rpc-rewind",
  });
  expect(git(prepared.workspace.path, "rev-parse", "HEAD")).toBe(initialHead);
  expect((await f.call("sessions.get", { sessionId })).revision).toBe(rewound.conversationRevision);
  const undoPlan = await f.call<SessionRewindPlan>("sessions.rewind.plan", {
    workspaceId,
    sessionId,
    expectedRevision: rewound.workspaceRevision,
    expectedConversationRevision: rewound.conversationRevision,
    direction: "undo",
    operationId: rewound.operationId,
  });
  const undone = await f.call("sessions.rewind.undo", {
    workspaceId,
    sessionId,
    expectedRevision: undoPlan.expectedRevision,
    expectedConversationRevision: undoPlan.expectedConversationRevision,
    planToken: undoPlan.token,
    idempotencyKey: "rpc-undo",
  });
  expect(git(prepared.workspace.path, "rev-parse", "HEAD")).toBe(committedHead);
  expect((await f.call("sessions.get", { sessionId })).revision).toBe(undone.conversationRevision);
  // Reproduce complete Git/transcript receipts whose final acknowledgement was
  // interrupted. Session deletion must preserve the authoritative rescue target.
  const completedOperation = await f.store.workspaceOperation(undone.operationId);
  await f.store.db
    .prepare("UPDATE workspace_operations SET payload=? WHERE id=?")
    .run(JSON.stringify({ ...completedOperation, finalized: false }), undone.operationId);
  const deletion = await f.request("sessions.delete", {
    sessionId,
    projectId: f.projectScope.projectId,
  });
  expect(deletion.value.error).toMatch(/recovery.*pending|reconcile/i);
  expect((await f.call("sessions.get", { sessionId })).revision).toBe(undone.conversationRevision);
  await f.store.db
    .prepare("UPDATE workspace_operations SET payload=? WHERE id=?")
    .run(JSON.stringify(completedOperation), undone.operationId);
  await f.call("workspaces.finish", {
    workspaceId,
    expectedRevision: (await workspace()).revision,
    idempotencyKey: "rpc-finish",
  });
  writeFileSync(join(f.target, "owner.txt"), "dirty owner file survives HTTP delivery\n");
  const targetStatus = git(f.target, "status", "--porcelain=v1");
  const review = await f.call("workspaces.delivery.review", {
    workspaceId,
    expectedRevision: (await workspace()).revision,
    action: "merge",
  });
  expect(review.blockers).toEqual([]);
  const merged = await f.call("workspaces.delivery.merge", {
    workspaceId,
    expectedRevision: review.expectedRevision,
    planToken: review.token,
    idempotencyKey: "rpc-approved-merge",
  });
  expect(merged.sourceHead).toBe(committedHead);
  expect((await workspace()).state).toBe("merged");
  expect(git(f.target, "status", "--porcelain=v1")).toBe(targetStatus);
  expect(readFileSync(join(f.target, "owner.txt"), "utf8")).toBe(
    "dirty owner file survives HTTP delivery\n",
  );
  const cleanupPlan = await f.call("workspaces.cleanup.plan", {
    workspaceId,
    expectedRevision: (await workspace()).revision,
  });
  expect(cleanupPlan.blockers).toEqual([]);
  expect(
    (await f.call("workspaces.cleanup.status", { workspaceId })).workspace.directoryState,
  ).toBe("present");
  const removed = await f.call("workspaces.cleanup.apply", {
    workspaceId,
    expectedRevision: cleanupPlan.expectedRevision,
    planToken: cleanupPlan.token,
    idempotencyKey: "rpc-remove-directory",
  });
  expect(removed.directoryState).toBe("removed");
  expect(existsSync(prepared.workspace.path)).toBe(false);
  expect(
    (await f.call("workspaces.cleanup.status", { workspaceId })).workspace.directoryState,
  ).toBe("removed");
  expect(git(f.target, "rev-parse", prepared.workspace.branchRef)).toBe(committedHead);
});

it("advertises the executable build identity capability only when its reader supplies an identity", async () => {
  const stamp: BuildIdentity = {
    schemaVersion: 1,
    buildId: "rpc-build",
    version: "0.0.0-test",
    channel: "test",
    mode: "debug",
    repositoryId: "rpc-repository",
    branch: "rpc-branch",
    head: "a".repeat(40),
    sourceFingerprint: "b".repeat(64),
    dirtyPaths: [],
    capturedAt: 123,
    components: { web: "rpc-build", native: "rpc-build", host: "rpc-build" },
    includedSources: [],
  };
  const f = await fixture(stamp);
  const descriptor = await f.call("environment.describe");
  expect(descriptor.buildIdentity).toEqual(stamp);
  expect(descriptor.capabilities).toContain("build.identity.v1");
});

it("binds native turn capture to the authenticated device and retains its writer fence through completion", async () => {
  const f = await fixture();
  const prepared = await f.call("workspaces.prepare", {
    ...f.projectScope,
    owner: { kind: "session", id: "native-session" },
    slug: "native",
    idempotencyKey: "native-workspace",
  });
  const boundary = {
    workspaceId: prepared.workspace.id,
    sessionId: "native-session",
    userBlockId: "native-user",
    runId: "native-run",
  };
  const before = await f.call("sessions.managedTurn.begin", {
    ...boundary,
    conversationRevision: 3,
  });
  expect(before.before.status).toBe("complete");
  expect(
    (
      await f.call("workspaces.cleanup.plan", {
        workspaceId: boundary.workspaceId,
        expectedRevision: (await f.call("workspaces.get", { workspaceId: boundary.workspaceId }))
          .revision,
      })
    ).blockers.join(" "),
  ).toMatch(/use|active/);
  const other = await f.store.issueDevice("Other native device");
  expect((await f.request("sessions.managedTurn.end", boundary, other.token)).value.error).toMatch(
    /another owner device/,
  );
  writeFileSync(join(prepared.workspace.path, "source.txt"), "native committed change\n");
  git(prepared.workspace.path, "add", "source.txt");
  git(prepared.workspace.path, "commit", "-qm", "Native turn");
  const ended = await f.call("sessions.managedTurn.end", boundary);
  expect(ended.after.status).toBe("complete");
  expect(ended.after.snapshot.head).toBe(git(prepared.workspace.path, "rev-parse", "HEAD"));
  expect((await f.call("sessions.managedTurn.status", boundary)).activity).toBeNull();
  expect(await f.call("sessions.managedTurn.end", boundary)).toEqual(ended);
  expect((await f.call("environment.describe")).gitRewindExecution).toBe("host");
  expect(
    (
      await f.request("sessions.rewind.plan", {
        workspaceId: boundary.workspaceId,
        sessionId: boundary.sessionId,
        expectedRevision: prepared.workspace.revision,
        expectedConversationRevision: 3,
        direction: "rewind",
        userBlockId: boundary.userBlockId,
      })
    ).value.error,
  ).toMatch(/host-executed|native protocol/);
});

it("resumes the same owner-approved publication journal without pushing again and rejects changed retry bindings", async () => {
  const f = await fixture();
  const prepared = await f.call("workspaces.prepare", {
    ...f.projectScope,
    owner: { kind: "session", id: "publication-session" },
    slug: "publication",
    idempotencyKey: "publication-workspace",
  });
  writeFileSync(join(prepared.workspace.path, "source.txt"), "publishable source\n");
  git(prepared.workspace.path, "add", "source.txt");
  git(prepared.workspace.path, "commit", "-qm", "Publication change");
  const sourceHead = git(prepared.workspace.path, "rev-parse", "HEAD");
  await f.call("workspaces.finish", {
    workspaceId: prepared.workspace.id,
    expectedRevision: prepared.workspace.revision,
    idempotencyKey: "finish-publication",
  });
  git(f.target, "remote", "add", "origin", "https://example.invalid/owner/repo.git");
  // External effects are stand-ins; real owner transport, journal, reservation
  // and retry logic run. The test never publishes or contacts GitHub.
  const push = vi.spyOn(GitHubDeliveryPublication.prototype, "push").mockResolvedValue({
    remote: "origin",
    branchRef: prepared.workspace.branchRef,
    sourceHead,
    pushedAt: 1,
  });
  vi.spyOn(GitHubDeliveryPublication.prototype, "findPush").mockResolvedValue({
    remote: "origin",
    branchRef: prepared.workspace.branchRef,
    sourceHead,
    pushedAt: 1,
  });
  vi.spyOn(GitHubDeliveryPublication.prototype, "findPr").mockResolvedValue(null);
  const createPr = vi
    .spyOn(GitHubDeliveryPublication.prototype, "createPr")
    .mockRejectedValueOnce(new DeliveryEffectNotAppliedError("Known rejected PR request"))
    .mockResolvedValue({
      repository: "owner/repo",
      number: 1,
      url: "https://example.invalid/owner/repo/pull/1",
      sourceHead,
      createdAt: 2,
    });
  const current = await f.call<ManagedWorkspace>("workspaces.get", {
    workspaceId: prepared.workspace.id,
  });
  const plan = await f.call("workspaces.delivery.review", {
    workspaceId: current.id,
    expectedRevision: current.revision,
    action: "publish",
    publication: {
      repository: "owner/repo",
      remote: "origin",
      baseBranchRef: current.targetBranchRef,
      headBranchRef: current.branchRef,
      title: "Publication test",
      body: "Test-only external adapter",
    },
  });
  expect(plan.blockers).toEqual([]);
  const request = {
    workspaceId: current.id,
    expectedRevision: current.revision,
    planToken: plan.token,
    idempotencyKey: "owner-publication",
  };
  expect((await f.call("workspaces.delivery.publish", request)).status).toBe("blocked");
  expect(push).toHaveBeenCalledTimes(1);
  expect(
    (await f.request("workspaces.delivery.publish", { ...request, planToken: "changed" })).value
      .error,
  ).toMatch(/different delivery/);
  expect((await f.call("workspaces.delivery.publish", request)).status).toBe("complete");
  expect(push).toHaveBeenCalledTimes(1);
  expect(createPr).toHaveBeenCalledTimes(2);
});

it("authenticates clean native close and same-device instance reconciliation without trusting process-death claims", async () => {
  const f = await fixture();
  const report = {
    clientId: "profile",
    instanceId: "old",
    processId: process.pid,
    owners: [{ ownerId: "main", updatedAt: Date.now(), unknown: false, buffers: [] }],
  };
  await f.call("native.buffers.update", report);
  const identity = {
    clientId: report.clientId,
    instanceId: report.instanceId,
    processId: report.processId,
  };
  expect((await f.request("native.buffers.retire", identity, "invalid-token")).status).toBe(401);
  const other = await f.store.issueDevice("Other buffer device");
  expect((await f.request("native.buffers.retire", identity, other.token)).status).toBe(400);
  await f.call("native.buffers.update", { ...report, instanceId: "new" });
  const reconcile = {
    clientId: "profile",
    instanceId: "new",
    predecessors: [{ instanceId: "old", processId: process.pid }],
    processDead: true,
  };
  expect((await f.request("native.buffers.reconcile", reconcile, other.token)).status).toBe(400);
  const stillLive = await f.request("native.buffers.reconcile", reconcile);
  expect(stillLive.status).toBe(400);
  expect(stillLive.value.error).toMatch(/not proven dead/);
  expect(await f.call("native.buffers.retire", identity)).toEqual({ acknowledged: true });
  expect(await f.call("native.buffers.reconcile", reconcile)).toEqual({ acknowledged: true });
});

it("authenticates preparation cancellation and fences late same-key requests without allowing foreign tombstones", async () => {
  const f = await fixture();
  const sessionId = randomUUID();
  const { workspace } = await f.call<{ workspace: ManagedWorkspace }>("workspaces.prepare", {
    ...f.projectScope,
    owner: { kind: "session", id: sessionId },
    slug: "cancel native",
    mode: "worktree",
    idempotencyKey: "cancel-native-workspace",
  });
  const turn = {
    workspaceId: workspace.id,
    sessionId,
    userBlockId: "cancel-user",
    runId: "cancel-run",
    conversationRevision: 1,
  };
  await f.call("native.turn.begin", turn);
  writeFileSync(join(workspace.path, "source.txt"), "native dirty source\n");
  await f.call("native.turn.end", turn);
  const conversation = { revision: 2, userBlockIds: [turn.userBlockId] };
  const current = await f.call<ManagedWorkspace>("workspaces.get", { workspaceId: workspace.id });
  const plan = await f.call("native.rewind.plan", {
    request: {
      workspaceId: workspace.id,
      sessionId,
      expectedRevision: current.revision,
      expectedConversationRevision: 2,
      direction: "rewind",
      userBlockId: turn.userBlockId,
    },
    conversation,
  });
  const mutation = {
    workspaceId: workspace.id,
    sessionId,
    expectedRevision: current.revision,
    expectedConversationRevision: 2,
    planToken: plan.token,
    idempotencyKey: "rpc-cancelled",
  };
  const key = { workspaceId: workspace.id, sessionId, idempotencyKey: mutation.idempotencyKey };
  const cancelled = await f.call("native.rewind.cancelPreparation", key);
  expect(cancelled).toEqual({ ...key, cancelled: true });
  expect(await f.call("native.rewind.cancelPreparation", key)).toEqual(cancelled);
  expect(
    (
      await f.request("native.rewind.prepare", {
        request: mutation,
        direction: "rewind",
        conversation,
      })
    ).value.error,
  ).toMatch(/cancelled/);
  expect(readFileSync(join(workspace.path, "source.txt"), "utf8")).toBe("native dirty source\n");
  const protectedKey = { ...key, idempotencyKey: "rpc-protected-key" };
  expect(
    (await f.request("native.rewind.cancelPreparation", protectedKey, "invalid-token")).status,
  ).toBe(401);
  const foreign = await f.store.issueDevice("Foreign native device");
  expect(
    (await f.request("native.rewind.cancelPreparation", protectedKey, foreign.token)).value.error,
  ).toMatch(/another device/);
  const hostSession = await f.call("commands.dispatch", {
    type: "create",
    commandId: "scope-for-cancel",
    projectId: f.projectScope.projectId,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  const grant = await f.call("conversation.access.issue", { sessionId: hostSession.sessionId });
  const scoped = await f.request("native.rewind.cancelPreparation", protectedKey, grant.token);
  expect(scoped.status).toBe(400);
  expect(scoped.value.error).toMatch(/credential|conversation|owner|scope/i);
  const operation = await f.call("native.rewind.prepare", {
    request: { ...mutation, idempotencyKey: protectedKey.idempotencyKey },
    direction: "rewind",
    conversation,
  });
  expect(await f.call("native.rewind.cancelPreparation", protectedKey)).toEqual({
    ...protectedKey,
    cancelled: false,
    operation,
  });
  expect((await f.call("native.rewind.status", operation)).phase).toBe("prepared");
});

async function nativeWindowFixture(send?: HostProvider["send"]) {
  const f = await fixture(null, send);
  const sessionId = randomUUID();
  const { workspace } = await f.call("workspaces.prepare", {
    ...f.projectScope,
    owner: { kind: "session", id: sessionId },
    slug: "native desktop",
    idempotencyKey: "native-window",
    mode: "worktree",
  });
  const clientId = "native-own-window";
  const boundary = {
    workspaceId: workspace.id,
    sessionId,
    userBlockId: "busy-user",
    runId: "busy-run",
    conversationRevision: 1,
    clientId,
  };
  const busy = (active = true) =>
    f.call("sessions.desktopLive", { clientId, sessions: [{ id: sessionId, busy: active }] });
  return { ...f, workspace, sessionId, clientId, boundary, busy };
}

it("keeps a native rewind preview valid when the completed turn publishes idle after preview", async () => {
  const f = await nativeWindowFixture();
  await f.busy();
  const process = {
    activityId: "native-preview-provider",
    cwd: f.workspace.path,
    kind: "provider",
    sessionId: f.sessionId,
    clientId: f.clientId,
  };
  await f.call("native.activity.start", process);
  await f.call("native.turn.begin", f.boundary);
  writeFileSync(join(f.workspace.path, "source.txt"), "native rewind preview change\n");
  await f.call("native.activity.end", {
    activityId: process.activityId,
    clientId: f.clientId,
  });
  await f.call("native.turn.end", f.boundary);
  const completed = await f.call<ManagedWorkspace>("workspaces.get", {
    workspaceId: f.workspace.id,
  });
  const conversation = { revision: 2, userBlockIds: [f.boundary.userBlockId] };
  const plan = await f.call("native.rewind.plan", {
    request: {
      workspaceId: f.workspace.id,
      sessionId: f.sessionId,
      expectedRevision: completed.revision,
      expectedConversationRevision: conversation.revision,
      direction: "rewind",
      userBlockId: f.boundary.userBlockId,
    },
    conversation,
  });
  // The native end receipt precedes the renderer's next idle heartbeat.
  await f.busy(false);
  const prepared = await f.request("native.rewind.prepare", {
    request: {
      workspaceId: f.workspace.id,
      sessionId: f.sessionId,
      expectedRevision: plan.expectedRevision,
      expectedConversationRevision: conversation.revision,
      planToken: plan.token,
      idempotencyKey: "native-rewind-after-idle",
    },
    direction: "rewind",
    conversation,
  });
  expect(prepared.value.error).toBeUndefined();
  expect(prepared.status).toBe(200);
  expect(completed.state).toBe("idle");
  expect((await f.call("workspaces.get", { workspaceId: f.workspace.id })).revision).toBe(
    completed.revision,
  );
  expect((await f.call("native.rewind.status", prepared.value.result)).phase).toBe("prepared");
});

it("admits authenticated native desktop busy preflight and captures end only after process retirement", async () => {
  const f = await nativeWindowFixture();
  await f.busy(); // Actual UI reports busy and implicitly acquires a desktop run lease first.
  await f.call("sessions.desktopLive", { clientId: "another-window", sessions: [] });
  expect(
    (
      await f.request("native.turn.begin", {
        ...f.boundary,
        clientId: "another-window",
        userBlockId: "other-window",
        runId: "other-window",
      })
    ).value.error,
  ).toMatch(/writer|activity/);
  const other = await f.store.issueDevice("Foreign native device");
  expect(
    (
      await f.request(
        "native.turn.begin",
        { ...f.boundary, userBlockId: "other-device", runId: "other-device" },
        other.token,
      )
    ).value.error,
  ).toMatch(/device|writer|activity/);
  expect(
    (
      await f.request(
        "sessions.desktopLive",
        { clientId: f.clientId, sessions: [{ id: f.sessionId, busy: true }] },
        other.token,
      )
    ).value.error,
  ).toMatch(/another owner device/);
  for (let turn = 1; turn <= 3; turn++) {
    const request = {
      ...f.boundary,
      userBlockId: `busy-user-${turn}`,
      runId: `busy-run-${turn}`,
      conversationRevision: turn,
    };
    const process = {
      activityId: `native-busy-provider-${turn}`,
      cwd: f.workspace.path,
      kind: "provider",
      sessionId: f.sessionId,
      clientId: f.clientId,
    };
    if (turn !== 2) await f.call("native.activity.start", process);
    expect((await f.call("native.turn.begin", request)).before.status).toBe("complete");
    if (turn === 2) await f.call("native.activity.start", process);
    expect(
      (
        await f.request("native.activity.end", {
          activityId: process.activityId,
          clientId: "another-window",
        })
      ).value.error,
    ).toMatch(/another desktop client/);
    expect((await f.request("native.turn.end", request)).value.error).toMatch(/writer|activity/);
    writeFileSync(join(f.workspace.path, "source.txt"), `busy native turn ${turn}\n`);
    git(f.workspace.path, "add", "source.txt");
    git(f.workspace.path, "commit", "-qm", `Busy native turn ${turn}`);
    await f.call("native.activity.end", { activityId: process.activityId, clientId: f.clientId });
    expect((await f.call("native.turn.end", request)).after.status).toBe("complete");
    await f.busy(); // Keep the same own UI publication through all turn boundaries.
  }
  await f.busy(false);
});

it("recovers a legacy native starting binding with current authenticated UI context while retaining real process fences", async () => {
  const f = await nativeWindowFixture();
  const { clientId: _clientId, ...legacy } = f.boundary;
  const directory = join(f.root, "managed-workspaces", "native-turns", f.workspace.id);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${legacy.userBlockId}.json`);
  writeFileSync(
    path,
    JSON.stringify({
      ...legacy,
      ownerFingerprint: createHash("sha256")
        .update(createHash("sha256").update(f.device.id).digest("hex"))
        .digest("hex"),
      activityOwnerId: "native-turn:legacy",
    }),
  );
  await f.busy();
  await f.call("native.activity.start", {
    activityId: "legacy-live-process",
    cwd: f.workspace.path,
    kind: "provider",
    sessionId: f.sessionId,
    clientId: f.clientId,
  });
  expect((await f.call("native.turn.recover", f.boundary)).released).toBe(false);
  await f.call("native.activity.end", { activityId: "legacy-live-process", clientId: f.clientId });
  expect((await f.call("native.turn.recover", f.boundary)).released).toBe(true);
  expect(JSON.parse(readFileSync(path, "utf8")).clientId).toBeUndefined();
  expect((await f.request("native.turn.begin", f.boundary)).value.error).toMatch(
    /released|another desktop client/,
  );
  await f.busy(false);
});

it("keeps unknown stored Host execution fenced despite a remembered or matching native desktop client", async () => {
  const f = await nativeWindowFixture();
  await f.engine.command({
    type: "create",
    commandId: "native-mirror-create",
    projectId: f.projectScope.projectId,
    workspaceId: f.workspace.id,
    sessionId: f.sessionId,
    harness: "codex",
    model: "fixture",
    modelSettings: {},
    runtimeMode: "supervised",
  });
  const snapshot = await f.store.session(f.sessionId);
  await f.store.save(
    { ...snapshot, revision: snapshot.revision + 1, status: "running", runId: "unknown-host-run" },
    null,
  );
  await f.busy(false); // A remembered client alone is not live execution proof.
  expect((await f.request("sessions.managedTurn.begin", f.boundary)).value.error).toMatch(
    /writer|activity/,
  );
  await f.busy();
  expect(
    (
      await f.request("sessions.managedTurn.begin", {
        ...f.boundary,
        userBlockId: "busy-unknown-host",
        runId: "busy-unknown-host",
      })
    ).value.error,
  ).toMatch(/writer|activity/);
  await f.store.save({ ...snapshot, revision: snapshot.revision + 2, status: "idle" }, null);
  await f.busy(false);
});

it("keeps a real Host provider fenced while the same native client publishes its own busy mirror", async () => {
  let release!: () => void;
  let entered!: () => void;
  const running = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const finish = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await nativeWindowFixture(async () => {
    entered();
    await finish;
  });
  await f.engine.command({
    type: "create",
    commandId: "real-host-create",
    projectId: f.projectScope.projectId,
    workspaceId: f.workspace.id,
    sessionId: f.sessionId,
    harness: "codex",
    model: "fixture",
    modelSettings: {},
    runtimeMode: "supervised",
  });
  try {
    await f.engine.command({
      type: "send",
      commandId: "real-host-send",
      sessionId: f.sessionId,
      text: "Host stays authoritative",
    });
    await running;
    await f.busy();
    expect((await f.request("sessions.managedTurn.begin", f.boundary)).value.error).toMatch(
      /writer|activity/,
    );
  } finally {
    release();
    await f.engine.waitForRun(f.sessionId, (await f.store.session(f.sessionId)).runId);
    await f.busy(false);
  }
});
