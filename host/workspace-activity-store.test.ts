import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { createExecutionActivityReservations } from "./workspace-cleanup";
import type { WorkspaceRemovalJournal } from "./workspace-cleanup";
import type { DurableRewindOperation } from "./session-rewind";
import type {
  ManagedWorkspace,
  WorkspaceActivity,
  WorkspaceCreateOperation,
} from "./workspace-contracts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "workspace-admission-"));
  cleanups.push(async () => rmSync(root, { recursive: true, force: true }));
  const stores: HostStore[] = [];
  cleanups.push(async () => {
    for (const store of stores) await store.close();
  });
  const workspace: ManagedWorkspace = {
    id: "workspace",
    repositoryId: "repository",
    projectId: "project",
    environmentId: "host",
    owner: { kind: "session", id: "session" },
    path: root,
    branchRef: "refs/heads/bycoda/s/test",
    baseRef: "refs/heads/main",
    baseCommit: "a".repeat(40),
    targetBranchRef: "refs/heads/main",
    state: "idle",
    directoryState: "present",
    revision: 3,
    lastActivityAt: 1,
    pinned: false,
  };
  let probe: WorkspaceActivity[] = [];
  const open = async (canReconcileActivity?: (activity: WorkspaceActivity) => Promise<boolean>) => {
    const store = new HostStore(join(root, "host.db"));
    stores.push(store);
    await store.ready;
    const gate = createExecutionActivityReservations({
      get: async () => workspace,
      probe: async () => probe,
      pending: async (id, except) =>
        (await store.workspaceOperations(id)).some(
          (op) => op.id !== except && op.phase !== "complete",
        ),
      operation: (id) => store.workspaceOperation(id),
      persistence: store.workspaceActivityPersistence(),
      canReconcileActivity,
    });
    return { store, gate };
  };
  return {
    workspace,
    open,
    probe: (value: WorkspaceActivity[]) => {
      probe = value;
    },
    request: {
      workspaceId: workspace.id,
      operationId: "operation",
      purpose: "rewind" as const,
      expectedRevision: 3,
    },
  };
}

it("round trips extended recovery fields and prevents stale payloads reversing finalization", async () => {
  const f = await fixture(),
    { store } = await f.open();
  const snapshot = {
    head: "a".repeat(40),
    index: "b".repeat(40),
    worktree: "c".repeat(40),
    indexMetadataId: "private-index",
    paths: [],
    capturedAt: 1,
  };
  const operation: DurableRewindOperation = {
    id: "rewind",
    kind: "rewind",
    workspaceId: f.workspace.id,
    expectedRevision: 3,
    idempotencyKey: "rewind-key",
    phase: "prepared",
    createdAt: 1,
    updatedAt: 2,
    plan: {
      token: "plan",
      expiresAt: 100,
      direction: "rewind",
      workspaceId: f.workspace.id,
      sessionId: "session",
      userBlockId: "first",
      expectedRevision: 3,
      expectedConversationRevision: 4,
      branchRef: f.workspace.branchRef,
      currentHead: snapshot.head,
      targetHead: snapshot.head,
      statusFingerprint: "source-fingerprint",
      removedUserBlockIds: ["second"],
      affectedCommits: [],
      affectedPaths: [],
      blockers: [],
      published: false,
      merged: false,
    },
    target: snapshot,
    reservationId: "reservation:rewind",
    requestFingerprint: "immutable-request",
    transcriptRescueId: "rescue",
    undoTranscriptRescueId: "undo-rescue",
    rescueUserBlockIds: ["first", "second"],
    conversationResult: { revision: 5 },
    finalized: false,
  };
  await store.saveWorkspaceOperation(operation, null);
  await expect(
    store.saveWorkspaceOperation({ ...operation, requestFingerprint: "replaced" }, "prepared"),
  ).rejects.toThrow("recovery identity is immutable");
  await store.saveWorkspaceOperation({ ...operation, phase: "complete", updatedAt: 3 }, "prepared");
  await store.close();
  const reopened = await f.open();
  expect(await reopened.store.workspaceOperation(operation.id)).toEqual({
    ...operation,
    phase: "complete",
    updatedAt: 3,
  });
  const final = { ...operation, phase: "complete" as const, finalized: true, updatedAt: 4 };
  await reopened.store.saveWorkspaceOperation(final, "complete");
  await expect(
    reopened.store.saveWorkspaceOperation({ ...final, finalized: false }, "complete"),
  ).rejects.toThrow("finalization cannot be reversed");
  expect(await reopened.store.workspaceOperation(operation.id)).toEqual(final);
  const removal: WorkspaceRemovalJournal = {
    id: "removal",
    kind: "removal",
    phase: "reserved",
    workspaceId: f.workspace.id,
    expectedRevision: 4,
    idempotencyKey: "remove",
    createdAt: 1,
    updatedAt: 2,
    automatic: true,
    workspaceRevision: 5,
    archiveRoot: join(f.workspace.path, "recovery"),
    reservationId: "reservation:removal",
    recoveryIds: ["rescue-ref"],
    plan: {
      token: "cleanup",
      expiresAt: 100,
      workspaceId: f.workspace.id,
      expectedRevision: 4,
      path: f.workspace.path,
      branchRef: f.workspace.branchRef,
      head: snapshot.head,
      statusFingerprint: "clean-source",
      dirty: false,
      preservationRequired: false,
      blockers: [],
      links: [],
    },
  };
  await reopened.store.saveWorkspaceOperation(removal, null);
  await reopened.store.close();
  const again = await f.open();
  expect(await again.store.workspaceOperation(removal.id)).toEqual(removal);
});

it("reconstructs durable reservations and freshly rejects surviving buffers on idempotent recovery", async () => {
  const f = await fixture(),
    first = await f.open();
  const reservation = await first.gate.reserve(f.request);
  await first.store.close();
  const reopened = await f.open();
  await expect(
    reopened.gate.start({ workspaceId: f.workspace.id, kind: "provider", ownerId: "session" }),
  ).rejects.toThrow("reserved");
  f.workspace.revision++;
  expect(await reopened.gate.reserve(f.request)).toEqual(reservation);
  f.probe([
    {
      id: "buffer",
      workspaceId: f.workspace.id,
      ownerId: "editor",
      kind: "editor",
      dirtyBuffer: true,
      startedAt: 1,
    },
  ]);
  await expect(reopened.gate.reserve(f.request)).rejects.toThrow("still in use");
  await expect(
    reopened.gate.verifyReservation({
      workspaceId: f.workspace.id,
      reservationId: reservation.id,
      expectedRevision: 4,
    }),
  ).rejects.toThrow("still in use");
  f.probe([]);
  await reopened.gate.verifyReservation({
    workspaceId: f.workspace.id,
    reservationId: reservation.id,
    expectedRevision: 4,
  });
  await reopened.gate.release(reservation.id);
  expect((await reopened.store.workspaceActivityPersistence().load()).reservations).toEqual([]);
});

it("retains unknown activity after restart until its owner reconciles it", async () => {
  const f = await fixture(),
    first = await f.open();
  const activity = await first.gate.start({
    workspaceId: f.workspace.id,
    ownerId: "shell-owner",
    kind: "shell",
  });
  await first.store.close();
  const reopened = await f.open();
  expect(await reopened.gate.list(f.workspace.id)).toEqual([activity]);
  await expect(reopened.gate.reserve(f.request)).rejects.toThrow("still in use");
  await reopened.gate.stop(activity.id);
  await reopened.gate.reserve(f.request);
});

it("reconciles only prior-runtime activities with authoritative stopped-process proof", async () => {
  const f = await fixture(),
    first = await f.open();
  const provider = await first.gate.start({
    workspaceId: f.workspace.id,
    ownerId: "session",
    kind: "provider",
  });
  await first.store.close();
  const confirmed: string[] = [];
  const reopened = await f.open(async (activity) => {
    confirmed.push(activity.id);
    return true;
  });
  expect(await reopened.gate.reconcilePreviousActivities()).toEqual({
    released: [provider.id],
    blocked: [],
  });
  expect((await reopened.store.workspaceActivityPersistence().load()).activities).toEqual([]);
  const current = await reopened.gate.start({
    workspaceId: f.workspace.id,
    ownerId: "session",
    kind: "provider",
  });
  expect(await reopened.gate.reconcilePreviousActivities()).toEqual({ released: [], blocked: [] });
  expect(await reopened.gate.list(f.workspace.id)).toEqual([current]);
  expect(confirmed).toEqual([provider.id]);
});

it("retains editors and process activities without sufficient ownership proof", async () => {
  const f = await fixture(),
    first = await f.open();
  const editor = await first.gate.start({
    workspaceId: f.workspace.id,
    ownerId: "native-editor",
    kind: "editor",
    dirtyBuffer: true,
  });
  const shell = await first.gate.start({
    workspaceId: f.workspace.id,
    ownerId: "unknown-shell",
    kind: "shell",
  });
  const server = await first.gate.start({
    workspaceId: f.workspace.id,
    ownerId: "unknown-server",
    kind: "devServer",
  });
  await first.store.close();
  const unknown = await f.open();
  expect(await unknown.gate.reconcilePreviousActivities()).toMatchObject({
    released: [],
    blocked: expect.any(Array),
  });
  expect(await unknown.gate.list(f.workspace.id)).toHaveLength(3);
  await unknown.store.close();
  const checked: string[] = [];
  const reopened = await f.open(async (activity) => {
    checked.push(activity.id);
    return false;
  });
  const result = await reopened.gate.reconcilePreviousActivities();
  expect(result.released).toEqual([]);
  expect(result.blocked.map((value) => value.activityId).sort()).toEqual(
    [editor.id, shell.id, server.id].sort(),
  );
  expect(checked.sort()).toEqual([shell.id, server.id].sort());
});

it("requires fresh idle probes and excludes only the operation whose recovery owns the stale process", async () => {
  const f = await fixture(),
    first = await f.open();
  const provider = await first.gate.start({
    workspaceId: f.workspace.id,
    ownerId: "session",
    kind: "provider",
  });
  const operation: WorkspaceCreateOperation = {
    id: "operation",
    kind: "create",
    phase: "registered",
    workspaceId: f.workspace.id,
    idempotencyKey: "create",
    expectedRevision: 3,
    plannedWorkspace: f.workspace,
    createdAt: 1,
    updatedAt: 1,
  };
  await first.store.saveWorkspaceOperation(operation, null);
  await first.store.close();
  const reopened = await f.open(async () => true);
  expect((await reopened.gate.reconcilePreviousActivities()).blocked).toHaveLength(1);
  f.probe([
    { id: "live", workspaceId: f.workspace.id, ownerId: "live-shell", kind: "shell", startedAt: 1 },
  ]);
  expect(
    await reopened.gate.reconcilePreviousActivities({
      workspaceId: f.workspace.id,
      operationId: operation.id,
    }),
  ).toMatchObject({
    released: [],
    blocked: [{ activityId: provider.id, reason: expect.stringContaining("still in use") }],
  });
  f.probe([]);
  await reopened.store.saveWorkspaceOperation(
    { ...operation, id: "other-operation", idempotencyKey: "other" },
    null,
  );
  expect(
    await reopened.gate.reconcilePreviousActivities({
      workspaceId: f.workspace.id,
      operationId: operation.id,
    }),
  ).toMatchObject({
    released: [],
    blocked: [
      { activityId: provider.id, reason: expect.stringContaining("Another workspace operation") },
    ],
  });
  await reopened.store.saveWorkspaceOperation(
    { ...operation, id: "other-operation", idempotencyKey: "other", phase: "complete" },
    "registered",
  );
  expect(
    await reopened.gate.reconcilePreviousActivities({
      workspaceId: f.workspace.id,
      operationId: operation.id,
    }),
  ).toEqual({ released: [provider.id], blocked: [] });
  await expect(
    reopened.gate.start({ workspaceId: f.workspace.id, ownerId: "session", kind: "provider" }),
  ).rejects.toThrow("recovery is pending");
});

it("fences new starts while stopped-process evidence is checked and retains current-runtime activities", async () => {
  const f = await fixture(),
    first = await f.open();
  const previous = await first.gate.start({
    workspaceId: f.workspace.id,
    ownerId: "session",
    kind: "provider",
  });
  await first.store.close();
  let checked!: () => void, confirm!: (value: boolean) => void;
  const checking = new Promise<void>((resolve) => {
    checked = resolve;
  });
  const evidence = new Promise<boolean>((resolve) => {
    confirm = resolve;
  });
  const reopened = await f.open(async () => {
    checked();
    return evidence;
  });
  const reconciliation = reopened.gate.reconcilePreviousActivities();
  await checking;
  await expect(
    reopened.gate.start({ workspaceId: f.workspace.id, ownerId: "new-shell", kind: "shell" }),
  ).rejects.toThrow("reserved");
  confirm(true);
  expect(await reconciliation).toEqual({ released: [previous.id], blocked: [] });
  const current = await reopened.gate.start({
    workspaceId: f.workspace.id,
    ownerId: "new-shell",
    kind: "shell",
  });
  expect(await reopened.gate.reconcilePreviousActivities()).toEqual({ released: [], blocked: [] });
  expect(await reopened.gate.list(f.workspace.id)).toEqual([current]);
});

it("releases a crash-before-intent reservation only after fresh probes confirm idle state", async () => {
  const f = await fixture(),
    first = await f.open();
  const reservation = await first.gate.reserve(f.request);
  await first.store.close();
  const reopened = await f.open();
  f.probe([
    {
      id: "surviving-shell",
      workspaceId: f.workspace.id,
      ownerId: "owner",
      kind: "shell",
      startedAt: 1,
    },
  ]);
  expect(await reopened.gate.recoverOrphanReservations()).toMatchObject({
    released: [],
    blocked: [{ reservationId: reservation.id }],
  });
  f.probe([]);
  expect(await reopened.gate.recoverOrphanReservations()).toEqual({
    released: [reservation.id],
    blocked: [],
  });
  await reopened.gate.start({ workspaceId: f.workspace.id, ownerId: "session", kind: "provider" });
});

it("atomically prevents starts crossing reservations even through independently reconstructed gates", async () => {
  const f = await fixture(),
    first = await f.open(),
    second = await f.open();
  await first.gate.list(f.workspace.id);
  await second.gate.list(f.workspace.id);
  const outcomes = await Promise.allSettled([
    first.gate.start({ workspaceId: f.workspace.id, ownerId: "provider", kind: "provider" }),
    second.gate.reserve(f.request),
  ]);
  expect(outcomes.filter((value) => value.status === "fulfilled")).toHaveLength(1);
  const durable = await first.store.workspaceActivityPersistence().load();
  expect(durable.activities.length + durable.reservations.length).toBe(1);
});

it("rejects forged reservations, changed requests and release before the durable operation settles", async () => {
  const f = await fixture(),
    { store, gate } = await f.open();
  const reservation = await gate.reserve(f.request);
  await expect(
    gate.verifyReservation({
      workspaceId: "other",
      reservationId: reservation.id,
      expectedRevision: 3,
    }),
  ).rejects.toThrow("another workspace");
  await expect(gate.reserve({ ...f.request, purpose: "delivery" })).rejects.toThrow(
    "request changed",
  );
  const operation: WorkspaceCreateOperation = {
    id: f.request.operationId,
    workspaceId: f.workspace.id,
    idempotencyKey: "create",
    expectedRevision: 3,
    kind: "create",
    phase: "registered",
    plannedWorkspace: f.workspace,
    createdAt: 1,
    updatedAt: 1,
  };
  await store.saveWorkspaceOperation(operation, null);
  await expect(gate.release(reservation.id)).rejects.toThrow("must settle");
  await store.saveWorkspaceOperation({ ...operation, phase: "complete" }, "registered");
  await gate.release(reservation.id);
  await gate.start({ workspaceId: f.workspace.id, ownerId: "session", kind: "provider" });
});
