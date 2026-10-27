import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "./store";
import { createManagedWorkspaceRegistry } from "./managed-workspaces";
import { createWorkspacePolicyResolver } from "./workspace-policy";
import { createWorkspaceFeatureClaims } from "./feature-claims";
import {
  invalidateHostWorktrees,
  managedWorkspaceNames,
  materializeManagedWorkspace,
} from "./git-worktrees";
import type { ManagedWorkspace, WorkspaceCreateOperation } from "./workspace-contracts";
import type { DurableRewindOperation } from "./session-rewind";

const cleanup: Array<() => Promise<void>> = [];
const owner = { ownerId: "owner", authorizationId: "authenticated-owner" };
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fn of cleanup.splice(0).reverse()) await fn();
  invalidateHostWorktrees();
});
async function fixture() {
  const parent = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-managed-test-")));
  const cwd = join(parent, "repo");
  mkdirSync(cwd);
  const gitAt = (path: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd: path,
      windowsHide: true,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const git = (...args: string[]) => gitAt(cwd, ...args);
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  // Keep byte assertions stable when the runner enables checkout conversion globally.
  git("config", "core.autocrlf", "false");
  writeFileSync(join(cwd, "source.txt"), "committed\n");
  git("add", ".");
  git("commit", "-qm", "baseline");
  const db = join(parent, "host.db");
  let store = new HostStore(db);
  await store.ready;
  const project = await store.addProject(cwd, "Repo");
  const root = join(parent, "managed");
  const policy = createWorkspacePolicyResolver(store, { hostPolicy: { root } });
  const registry = createManagedWorkspaceRegistry(store, policy);
  const request = {
    projectId: project.id,
    environmentId: "local",
    owner: { kind: "session" as const, id: "session-a" },
    slug: "Fix file picker",
    idempotencyKey: "create-a",
    choice: { defaultMode: "worktree" as const },
  };
  cleanup.push(async () => {
    await store.close();
    if (!parent.startsWith(join(realpathSync.native(tmpdir()), "bycoda-managed-test-")))
      throw new Error("Unsafe test cleanup");
    rmSync(parent, { recursive: true, force: true });
  });
  return {
    parent,
    cwd,
    root,
    git,
    gitAt,
    store,
    project,
    policy,
    registry,
    request,
    async reopen() {
      await store.close();
      store = new HostStore(db);
      await store.ready;
      return {
        store,
        registry: createManagedWorkspaceRegistry(
          store,
          createWorkspacePolicyResolver(store, { hostPolicy: { root } }),
        ),
      };
    },
  };
}

it("persists owner pinning with revision and idempotency binding", async () => {
  const f = await fixture();
  const created = await f.registry.prepare(f.request);
  const request = {
    workspaceId: created.workspace.id,
    expectedRevision: created.workspace.revision,
    idempotencyKey: "pin",
    pinned: true,
  };
  await expect(f.registry.pin(request, { ownerId: "", authorizationId: "" })).rejects.toThrow(
    "owner",
  );
  const pinned = await f.registry.pin(request, owner);
  expect(pinned.pinned).toBe(true);
  expect(pinned.revision).toBe(created.workspace.revision + 1);
  expect(await f.registry.pin(request, owner)).toEqual(pinned);
  await expect(f.registry.pin({ ...request, pinned: false }, owner)).rejects.toThrow(
    "different request",
  );
  await expect(f.registry.pin({ ...request, idempotencyKey: "stale" }, owner)).rejects.toThrow(
    "revision changed",
  );
  const reopened = await f.reopen();
  expect(await reopened.registry.pin(request, owner)).toEqual(pinned);
});

it("fences owner lifecycle writes until a completed rewind has its durable finalization acknowledgement", async () => {
  const f = await fixture();
  const { workspace } = await f.registry.prepare(f.request);
  const operation: DurableRewindOperation = {
    id: "rewind",
    kind: "rewind",
    workspaceId: workspace.id,
    expectedRevision: workspace.revision,
    idempotencyKey: "rewind-key",
    phase: "complete",
    createdAt: 1,
    updatedAt: 1,
    plan: {
      token: "plan",
      expiresAt: 100,
      direction: "rewind",
      workspaceId: workspace.id,
      sessionId: workspace.owner.id,
      userBlockId: "first",
      expectedRevision: workspace.revision,
      expectedConversationRevision: 4,
      branchRef: workspace.branchRef,
      currentHead: workspace.baseCommit,
      targetHead: workspace.baseCommit,
      statusFingerprint: "source-fingerprint",
      removedUserBlockIds: ["second"],
      affectedCommits: [],
      affectedPaths: [],
      blockers: [],
      published: false,
      merged: false,
    },
    target: {
      head: workspace.baseCommit,
      index: "b".repeat(40),
      worktree: "c".repeat(40),
      indexMetadataId: "private-index",
      paths: [],
      capturedAt: 1,
    },
    reservationId: "reservation:rewind",
    requestFingerprint: "immutable-request",
    rescueUserBlockIds: ["first", "second"],
    finalized: false,
  };
  await f.store.saveWorkspaceOperation(operation, null);
  const request = {
    workspaceId: workspace.id,
    expectedRevision: workspace.revision,
    idempotencyKey: "finish",
  };
  await expect(f.registry.finish(request)).rejects.toThrow("recovery required");
  await expect(f.registry.pin({ ...request, pinned: true }, owner)).rejects.toThrow(
    "recovery required",
  );
  await f.store.saveWorkspaceOperation({ ...operation, finalized: true }, "complete");
  expect((await f.registry.finish(request)).state).toBe("finished");
});

it("retargets only to the exact registered branch in the same repository and invalidates earlier revisions", async () => {
  const f = await fixture();
  const created = await f.registry.prepare(f.request);
  const target = join(f.parent, "delivery-target");
  f.git("worktree", "add", "-q", "-b", "integration", target, "HEAD");
  const request = {
    workspaceId: created.workspace.id,
    expectedRevision: created.workspace.revision,
    idempotencyKey: "retarget",
    targetBranchRef: "refs/heads/integration",
    targetDirectory: target,
  };
  await expect(
    f.registry.retarget({ ...request, targetBranchRef: "refs/heads/main" }, owner),
  ).rejects.toThrow("requested target branch");
  const changed = await f.registry.retarget(request, owner);
  expect(changed).toMatchObject({
    targetBranchRef: request.targetBranchRef,
    targetDirectory: target,
    revision: created.workspace.revision + 1,
    baseCommit: created.workspace.baseCommit,
  });
  expect(await f.registry.retarget(request, owner)).toEqual(changed);
  await expect(
    f.store.updateManagedWorkspace(
      { ...changed, targetBranchRef: "refs/heads/main", revision: changed.revision + 1 },
      changed.revision,
    ),
  ).rejects.toThrow("immutable");
  const reopened = await f.reopen();
  expect(await reopened.registry.get({ workspaceId: changed.id })).toEqual(changed);
});

it("pins the integration tip, excludes dirty files and returns the original duplicate receipt", async () => {
  const f = await fixture();
  const sha = f.git("rev-parse", "main");
  writeFileSync(join(f.cwd, "source.txt"), "unrelated dirty main\n");
  writeFileSync(join(f.cwd, "untracked.txt"), "private draft");
  const [a, duplicate] = await Promise.all([
    f.registry.prepare(f.request),
    f.registry.prepare(f.request),
  ]);
  expect(duplicate).toEqual(a);
  expect(a.workspace.baseCommit).toBe(sha);
  expect(a.workspace.branchRef).toMatch(/^refs\/heads\/bycoda\/s\/fix-file-picker-[a-f0-9]{12}$/);
  expect(basename(a.workspace.path)).toMatch(/^wt-[a-f0-9]{12}$/);
  expect(readFileSync(join(a.workspace.path, "source.txt"), "utf8")).toBe("committed\n");
  expect(existsSync(join(a.workspace.path, "untracked.txt"))).toBe(false);
  expect(readFileSync(join(f.cwd, "source.txt"), "utf8")).toBe("unrelated dirty main\n");
  const foreignPath = join(f.root, "not-owned");
  await expect(
    materializeManagedWorkspace(
      f.cwd,
      { ...a.workspace, path: foreignPath, repositoryId: "different-repository" },
      false,
    ),
  ).rejects.toThrow("repository identity changed");
  expect(existsSync(foreignPath)).toBe(false);
  await f.registry.finish({
    workspaceId: a.workspace.id,
    expectedRevision: a.workspace.revision,
    idempotencyKey: "finish",
  });
  expect(await f.registry.prepare(f.request)).toEqual(a);
  await expect(f.registry.prepare({ ...f.request, slug: "Changed" })).rejects.toThrow(
    "different request",
  );
  const reopened = await f.reopen();
  expect(await reopened.registry.prepare(f.request)).toEqual(a);
});

it("pins a selected lead's commit and delivery target across retries and Host restart", async () => {
  const f = await fixture();
  const lead = join(f.parent, "lead");
  f.git("worktree", "add", "-q", "-b", "feature/lead", lead, "HEAD");
  writeFileSync(join(lead, "prerequisite.txt"), "committed prerequisite\n");
  f.gitAt(lead, "add", ".");
  f.gitAt(lead, "commit", "-qm", "lead prerequisite");
  const source = {
    directory: lead,
    branchRef: "refs/heads/feature/lead",
    baseCommit: f.gitAt(lead, "rev-parse", "HEAD"),
  };
  const request = { ...f.request, source };
  writeFileSync(join(lead, "private-draft.txt"), "uncommitted lead draft\n");
  const prepared = await f.registry.prepare(request);
  expect(prepared.workspace).toMatchObject({
    baseRef: source.branchRef,
    baseCommit: source.baseCommit,
    targetBranchRef: source.branchRef,
    targetDirectory: lead,
  });
  expect(f.gitAt(prepared.workspace.path, "rev-parse", "HEAD")).toBe(source.baseCommit);
  expect(readFileSync(join(prepared.workspace.path, "prerequisite.txt"), "utf8")).toBe(
    "committed prerequisite\n",
  );
  expect(existsSync(join(prepared.workspace.path, "private-draft.txt"))).toBe(false);
  expect(existsSync(join(f.cwd, "prerequisite.txt"))).toBe(false);
  writeFileSync(join(lead, "later.txt"), "later committed lead state\n");
  f.gitAt(lead, "add", "later.txt");
  f.gitAt(lead, "commit", "-qm", "advance lead");
  expect(await f.registry.prepare(request)).toEqual(prepared);
  const reopened = await f.reopen();
  expect(await reopened.registry.prepare(request)).toEqual(prepared);
  await expect(
    reopened.registry.prepare({
      ...request,
      source: { ...source, baseCommit: f.gitAt(lead, "rev-parse", "HEAD") },
    }),
  ).rejects.toThrow("different request");
});

it("rejects unresolved, detached, foreign and stale selected leads without falling back to integration", async () => {
  const f = await fixture();
  const lead = join(f.parent, "lead");
  f.git("worktree", "add", "-q", "-b", "feature/lead", lead, "HEAD");
  const source = {
    directory: lead,
    branchRef: "refs/heads/feature/lead",
    baseCommit: f.gitAt(lead, "rev-parse", "HEAD"),
  };
  await expect(f.registry.prepare({ ...f.request, source: null as any })).rejects.toThrow(
    "Selected source requires",
  );
  await expect(
    f.registry.prepare({ ...f.request, source: { ...source, directory: "relative" } }),
  ).rejects.toThrow("Selected source requires");
  await expect(
    f.registry.prepare({ ...f.request, source: { ...source, baseCommit: "HEAD" } }),
  ).rejects.toThrow("committed SHA");
  await expect(
    f.registry.prepare({
      ...f.request,
      source: { ...source, directory: join(f.parent, "missing") },
    }),
  ).rejects.toThrow();
  const subdirectory = join(lead, "subdirectory");
  mkdirSync(subdirectory);
  await expect(
    f.registry.prepare({ ...f.request, source: { ...source, directory: subdirectory } }),
  ).rejects.toThrow("registered target checkout");
  await expect(
    f.registry.prepare({ ...f.request, source: { ...source, branchRef: "refs/heads/main" } }),
  ).rejects.toThrow("requested target branch");
  await expect(
    f.registry.prepare({ ...f.request, source, baseRef: "refs/heads/main" }),
  ).rejects.toThrow("another base or dependency");
  await expect(
    f.registry.prepare({
      ...f.request,
      source,
      dependency: { workspaceId: "another", commit: source.baseCommit },
    }),
  ).rejects.toThrow("another base or dependency");
  const foreign = await fixture();
  await expect(
    f.registry.prepare({
      ...f.request,
      source: { ...source, directory: foreign.cwd, branchRef: "refs/heads/main" },
    }),
  ).rejects.toThrow("different repository");
  f.gitAt(lead, "checkout", "--detach", "-q");
  await expect(f.registry.prepare({ ...f.request, source })).rejects.toThrow();
  f.gitAt(lead, "checkout", "-q", "feature/lead");
  writeFileSync(join(lead, "later.txt"), "advanced\n");
  f.gitAt(lead, "add", ".");
  f.gitAt(lead, "commit", "-qm", "advance source before preparation");
  await expect(f.registry.prepare({ ...f.request, source })).rejects.toThrow("commit changed");
  expect(await f.registry.list({ projectId: f.project.id })).toEqual([]);
});

it("recovers a selected lead's pinned base and rejects a changed delivery directory", async () => {
  const f = await fixture();
  const lead = join(f.parent, "lead");
  f.git("worktree", "add", "-q", "-b", "feature/lead", lead, "HEAD");
  const source = {
    directory: lead,
    branchRef: "refs/heads/feature/lead",
    baseCommit: f.gitAt(lead, "rev-parse", "HEAD"),
  };
  const paused = createManagedWorkspaceRegistry(f.store, f.policy, {
    beforeMaterialize: async () => {
      throw new Error("paused creation");
    },
  });
  await expect(paused.prepare({ ...f.request, source })).rejects.toThrow("paused creation");
  const [workspace] = await f.store.managedWorkspaces();
  const [operation] = await f.store.workspaceOperations(workspace.id);
  await f.store.db
    .prepare("UPDATE managed_workspaces SET payload=? WHERE id=?")
    .run(JSON.stringify({ ...workspace, targetDirectory: f.cwd }), workspace.id);
  await expect(f.registry.recoverCreate(operation.id)).rejects.toThrow("target identity changed");
  expect(existsSync(workspace.path)).toBe(false);
  await f.store.db
    .prepare("UPDATE managed_workspaces SET payload=? WHERE id=?")
    .run(JSON.stringify(workspace), workspace.id);
  writeFileSync(join(lead, "later.txt"), "lead moved after journal registration\n");
  f.gitAt(lead, "add", ".");
  f.gitAt(lead, "commit", "-qm", "lead advances while worker preparation is paused");
  const recovered = await f.registry.recoverCreate(operation.id);
  expect(recovered).toMatchObject({
    baseCommit: source.baseCommit,
    baseRef: source.branchRef,
    targetBranchRef: source.branchRef,
    targetDirectory: lead,
  });
  expect(f.gitAt(recovered.path, "rev-parse", "HEAD")).toBe(source.baseCommit);
  expect(existsSync(join(recovered.path, "later.txt"))).toBe(false);
});

it("allows one workspace per writer and independent workspaces for other writer kinds", async () => {
  const f = await fixture();
  const created = await f.registry.prepare(f.request);
  await expect(f.registry.prepare({ ...f.request, idempotencyKey: "other-key" })).rejects.toThrow();
  const task = await f.registry.prepare({
    ...f.request,
    idempotencyKey: "task",
    owner: { kind: "task", id: "task-a" },
  });
  expect(task.workspace.branchRef).toMatch(/^refs\/heads\/bycoda\/t\//);
  expect(task.workspace.path).not.toBe(created.workspace.path);
  expect(await f.registry.list({ projectId: f.project.id })).toHaveLength(2);
}, 60_000);

it("journals before directory mutation and automatically recovers the pinned creation after restart", async () => {
  const f = await fixture();
  const base = f.git("rev-parse", "main");
  const save = f.store.saveWorkspaceOperation.bind(f.store);
  let fail = true;
  vi.spyOn(f.store, "saveWorkspaceOperation").mockImplementation(async (op, phase) => {
    if (phase === null) expect(existsSync(f.root)).toBe(false);
    if (op.phase === "materialized" && fail) {
      fail = false;
      throw new Error("simulated host interruption");
    }
    return save(op, phase);
  });
  await expect(f.registry.prepare(f.request)).rejects.toThrow("interruption");
  const [workspace] = await f.store.managedWorkspaces();
  expect(existsSync(workspace.path)).toBe(true);
  expect((await f.registry.listOperations(workspace.id))[0]).toMatchObject({
    phase: "blocked",
    resumePhase: "registered",
  });
  await expect(
    f.registry.finish({
      workspaceId: workspace.id,
      expectedRevision: 0,
      idempotencyKey: "unsafe-finish",
    }),
  ).rejects.toThrow("recovery");
  writeFileSync(join(f.cwd, "source.txt"), "later committed tip\n");
  f.git("add", ".");
  f.git("commit", "-qm", "advance integration");
  const reopened = await f.reopen();
  const operation = (await reopened.registry.listOperations(workspace.id))[0];
  const startup = createManagedWorkspaceRegistry(reopened.store, f.policy, {
    assertWritable: async () => {
      throw new Error("Startup writes are disabled");
    },
    isActive: async () => false,
  });
  const recovered = await startup.recoverCreate(operation.id);
  expect(recovered.id).toBe(workspace.id);
  expect(recovered.baseCommit).toBe(base);
  expect(recovered.path).toBe(workspace.path);
  expect(await startup.recoverCreate(operation.id)).toEqual(recovered);
  expect(await reopened.registry.prepare(f.request)).toEqual({
    workspace: recovered,
    operationId: operation.id,
  });
  expect(f.gitAt(workspace.path, "rev-parse", "HEAD")).toBe(base);
  expect(await reopened.registry.listOperations(workspace.id)).toMatchObject([
    { phase: "complete" },
  ]);
});

it("creation recovery holds active or concurrently recovering workspaces and never materializes a moved identity", async () => {
  const f = await fixture();
  const blocked = createManagedWorkspaceRegistry(f.store, f.policy, {
    beforeMaterialize: async () => {
      throw new Error("interrupted before Git");
    },
  });
  await expect(
    blocked.prepare({ ...f.request, idempotencyKey: "resume:caller-key" }),
  ).rejects.toThrow("interrupted");
  const [workspace] = await f.store.managedWorkspaces();
  const [operation] = await f.store.workspaceOperations(workspace.id);
  const active = createManagedWorkspaceRegistry(f.store, f.policy, { isActive: async () => true });
  await expect(active.recoverCreate(operation.id)).rejects.toThrow("still active");
  expect(existsSync(workspace.path)).toBe(false);
  if (operation.kind !== "create") throw new Error("Expected creation journal");
  const other: WorkspaceCreateOperation = {
    ...operation,
    id: "another-operation",
    idempotencyKey: "other",
  };
  await f.store.saveWorkspaceOperation(other, null);
  await expect(f.registry.recoverCreate(operation.id)).rejects.toThrow(
    "Another workspace operation",
  );
  await f.store.saveWorkspaceOperation(
    { ...other, phase: "complete", resumePhase: undefined },
    other.phase,
  );
  const original = await f.store.managedWorkspace(workspace.id);
  await f.store.db
    .prepare("UPDATE managed_workspaces SET payload=? WHERE id=?")
    .run(JSON.stringify({ ...original, baseCommit: "f".repeat(40) }), workspace.id);
  await expect(f.registry.recoverCreate(operation.id)).rejects.toThrow(
    "identity changed: baseCommit",
  );
  expect(existsSync(workspace.path)).toBe(false);
  await f.store.db
    .prepare("UPDATE managed_workspaces SET payload=? WHERE id=?")
    .run(JSON.stringify(original), workspace.id);
  const recovered = await f.registry.recoverCreate(operation.id);
  expect(recovered).toMatchObject({
    id: workspace.id,
    baseCommit: workspace.baseCommit,
    path: workspace.path,
    directoryState: "present",
  });
});

it("never adopts an existing unregistered directory or falls back to main", async () => {
  const f = await fixture();
  const insert = f.store.insertManagedWorkspace.bind(f.store);
  vi.spyOn(f.store, "insertManagedWorkspace").mockImplementation(async (workspace) => {
    await insert(workspace);
    mkdirSync(workspace.path, { recursive: true });
    writeFileSync(join(workspace.path, "sentinel.txt"), "do not overwrite");
  });
  await expect(f.registry.prepare(f.request)).rejects.toThrow("already exists");
  const [workspace] = await f.store.managedWorkspaces();
  expect(workspace.directoryState).toBe("blocked");
  expect(workspace.path).not.toBe(f.cwd);
  expect(readFileSync(join(workspace.path, "sentinel.txt"), "utf8")).toBe("do not overwrite");
  expect(f.git("symbolic-ref", "HEAD")).toBe("refs/heads/main");
});

it("rejects an unavailable base and explicit current-mode preparation without allocating directories", async () => {
  const f = await fixture();
  await expect(f.registry.prepare({ ...f.request, baseRef: "missing-branch" })).rejects.toThrow();
  await expect(
    f.registry.prepare({ ...f.request, choice: { defaultMode: "current" } }),
  ).rejects.toThrow("explicit exception");
  expect(await f.store.managedWorkspaces()).toEqual([]);
  expect(existsSync(f.root)).toBe(false);
});

it("recovers interrupted rematerialization of a retained branch with later commits and preserves lifecycle receipts", async () => {
  const f = await fixture();
  const { workspace } = await f.registry.prepare(f.request);
  writeFileSync(join(workspace.path, "source.txt"), "task implementation\n");
  f.gitAt(workspace.path, "add", ".");
  f.gitAt(workspace.path, "commit", "-qm", "implementation");
  const tip = f.gitAt(workspace.path, "rev-parse", "HEAD");
  const finished = await f.registry.finish({
    workspaceId: workspace.id,
    expectedRevision: 1,
    idempotencyKey: "finish",
  });
  f.git("worktree", "remove", "--", workspace.path);
  invalidateHostWorktrees();
  await f.store.updateManagedWorkspace(
    { ...finished, directoryState: "removed", revision: finished.revision + 1 },
    finished.revision,
  );
  const request = { workspaceId: workspace.id, expectedRevision: 3, idempotencyKey: "resume" };
  const save = f.store.saveWorkspaceOperation.bind(f.store);
  let interrupted = false;
  vi.spyOn(f.store, "saveWorkspaceOperation").mockImplementation(
    async (operation, expectedPhase) => {
      if (
        !interrupted &&
        operation.phase === "materialized" &&
        operation.idempotencyKey === "resume:resume"
      ) {
        interrupted = true;
        throw new Error("resume interrupted after Git materialization");
      }
      return save(operation, expectedPhase);
    },
  );
  await expect(f.registry.resume(request)).rejects.toThrow("resume interrupted");
  const resumeOperation = (await f.registry.listOperations(workspace.id)).find(
    (op) => op.idempotencyKey === "resume:resume",
  )!;
  const resumed = await f.registry.recoverCreate(resumeOperation.id);
  expect(resumed).toMatchObject({
    id: workspace.id,
    path: workspace.path,
    branchRef: workspace.branchRef,
    state: "idle",
    directoryState: "present",
    revision: 4,
  });
  expect(f.gitAt(workspace.path, "rev-parse", "HEAD")).toBe(tip);
  expect(await f.registry.resume(request)).toEqual(resumed);
  const closed = await f.registry.close({
    workspaceId: workspace.id,
    expectedRevision: 4,
    idempotencyKey: "close",
  });
  expect(closed.state).toBe("abandoned");
  expect(existsSync(workspace.path)).toBe(true);
  expect(f.git("rev-parse", workspace.branchRef)).toBe(tip);
});

it("tracks meaningful activity, rejects active lifecycle transitions and requires reservation proof", async () => {
  const f = await fixture();
  const { workspace } = await f.registry.prepare(f.request);
  let active = true;
  const registry = createManagedWorkspaceRegistry(f.store, f.policy, {
    isActive: async () => active,
  });
  await expect(
    registry.finish({ workspaceId: workspace.id, expectedRevision: 1, idempotencyKey: "finish" }),
  ).rejects.toThrow("idle");
  await registry.touchOwnerActivity(workspace.owner);
  const running = (await registry.get({ workspaceId: workspace.id }))!;
  expect(running.state).toBe("active");
  expect(running.lastActivityAt).toBeGreaterThan(workspace.lastActivityAt);
  active = false;
  await registry.touchActivity(workspace.id);
  expect((await registry.get({ workspaceId: workspace.id }))?.state).toBe("idle");
  await expect(
    registry.update({
      workspaceId: workspace.id,
      expectedRevision: 3,
      idempotencyKey: "update",
      reservationId: "fake",
      changes: { state: "merged" },
    }),
  ).rejects.toThrow("reservation");
});

it("keeps an idle approval revision stable across duplicate idle activity reports", async () => {
  const f = await fixture();
  const { workspace } = await f.registry.prepare(f.request);
  const registry = createManagedWorkspaceRegistry(f.store, f.policy, {
    isActive: async () => false,
  });
  const before = (await registry.get({ workspaceId: workspace.id }))!;
  expect(before.state).toBe("idle");
  await registry.touchOwnerActivity(workspace.owner);
  await registry.touchActivity(workspace.id);
  expect(await registry.get({ workspaceId: workspace.id })).toEqual(before);
  // A late idle heartbeat must not invalidate an owner-approved lifecycle action.
  const finished = await registry.finish({
    workspaceId: workspace.id,
    expectedRevision: before.revision,
    idempotencyKey: "finish-after-idle-reports",
  });
  expect(finished.state).toBe("finished");
});

it("invalidates an idle approval revision after meaningful activity even when idle again", async () => {
  const f = await fixture();
  const { workspace } = await f.registry.prepare(f.request);
  let active = false;
  const registry = createManagedWorkspaceRegistry(f.store, f.policy, {
    isActive: async () => active,
  });
  const before = (await registry.get({ workspaceId: workspace.id }))!;
  active = true;
  await registry.touchActivity(workspace.id);
  const running = (await registry.get({ workspaceId: workspace.id }))!;
  expect(running.state).toBe("active");
  expect(running.revision).toBeGreaterThan(before.revision);
  active = false;
  await registry.touchActivity(workspace.id);
  const settled = (await registry.get({ workspaceId: workspace.id }))!;
  expect(settled.state).toBe("idle");
  expect(settled.revision).toBeGreaterThan(running.revision);
  expect(settled.lastActivityAt).toBeGreaterThan(running.lastActivityAt);
  await expect(
    registry.finish({
      workspaceId: workspace.id,
      expectedRevision: before.revision,
      idempotencyKey: "finish-after-real-activity",
    }),
  ).rejects.toThrow("revision changed");
});

it("uses fresh activity evidence to finish a workspace whose cached state is still active", async () => {
  const f = await fixture();
  const { workspace } = await f.registry.prepare(f.request);
  let active = true;
  const registry = createManagedWorkspaceRegistry(f.store, f.policy, {
    isActive: async () => active,
  });
  await registry.touchActivity(workspace.id);
  const current = (await registry.get({ workspaceId: workspace.id }))!;
  expect(current.state).toBe("active");
  const request = {
    workspaceId: current.id,
    expectedRevision: current.revision,
    idempotencyKey: "finish-cached-active",
  };
  await expect(registry.finish(request)).rejects.toThrow("idle");
  active = false;
  expect((await registry.get({ workspaceId: current.id }))?.state).toBe("active");
  expect((await registry.finish(request)).state).toBe("finished");
});

it("releases live feature claims on close and fences overlapping operation journals", async () => {
  const f = await fixture();
  const { workspace } = await f.registry.prepare(f.request);
  const claims = createWorkspaceFeatureClaims(f.store);
  expect(
    (
      await claims.acquire({
        workspaceId: workspace.id,
        expectedRevision: 1,
        idempotencyKey: "claim",
        featureKey: "picker",
      })
    ).acquired,
  ).toBe(true);
  await f.registry.close({
    workspaceId: workspace.id,
    expectedRevision: 2,
    idempotencyKey: "close",
  });
  expect(await claims.list({ projectId: f.project.id })).toEqual([]);
  const current = (await f.registry.get({ workspaceId: workspace.id }))!;
  const operation: WorkspaceCreateOperation = {
    id: "recovery",
    kind: "create",
    phase: "prepared",
    workspaceId: current.id,
    expectedRevision: current.revision,
    idempotencyKey: "op-a",
    createdAt: 1,
    updatedAt: 1,
    plannedWorkspace: current,
  };
  await f.registry.saveOperation(operation, null);
  await expect(
    f.registry.saveOperation({ ...operation, id: "other", idempotencyKey: "op-b" }, null),
  ).rejects.toThrow("recovery");
  await expect(f.registry.touchActivity(current.id)).rejects.toThrow("recovery");
});

it("records a committed dependency and rejects a dependency from another repository", async () => {
  const f = await fixture();
  const { workspace } = await f.registry.prepare(f.request);
  writeFileSync(join(workspace.path, "dependency.txt"), "committed dependency");
  f.gitAt(workspace.path, "add", ".");
  f.gitAt(workspace.path, "commit", "-qm", "dependency");
  const sha = f.gitAt(workspace.path, "rev-parse", "HEAD");
  const dependent = await f.registry.prepare({
    ...f.request,
    idempotencyKey: "dependent",
    owner: { kind: "task", id: "dependent" },
    dependency: { workspaceId: workspace.id, commit: sha },
  });
  expect(dependent.workspace.baseCommit).toBe(sha);
  expect(readFileSync(join(dependent.workspace.path, "dependency.txt"), "utf8")).toBe(
    "committed dependency",
  );
  const other = await fixture();
  const foreign = await other.registry.prepare(other.request);
  // Share only the persisted identity for this test; never touch the foreign checkout.
  await f.store.insertManagedWorkspace({
    ...foreign.workspace,
    projectId: f.project.id,
    environmentId: "local",
  } as ManagedWorkspace);
  await expect(
    f.registry.prepare({
      ...f.request,
      idempotencyKey: "foreign",
      owner: { kind: "task", id: "foreign" },
      dependency: { workspaceId: foreign.workspace.id, commit: foreign.workspace.baseCommit },
    }),
  ).rejects.toThrow("different repository");
}, 60_000);

it("uses stable collision-resistant naming and rejects malformed identities", () => {
  expect(
    managedWorkspaceNames(
      { kind: "automationRun", id: "a" },
      "../Türkçe ❄",
      "12345678-1234-1234-1234-123456789012",
    ),
  ).toEqual({ branch: "bycoda/s/t-rk-e-123456781234", directory: "wt-123456781234" });
  expect(() => managedWorkspaceNames({ kind: "session", id: "a" }, "x", "bad/id")).toThrow(
    "identity",
  );
});

it("holds a durable creation reservation when the storage guard pauses materialization", async () => {
  const f = await fixture();
  let paused = true;
  const registry = createManagedWorkspaceRegistry(f.store, f.policy, {
    beforeMaterialize: async () => {
      if (paused) throw new Error("Storage pressure pauses materialization");
    },
  });
  await expect(registry.prepare(f.request)).rejects.toThrow("Storage pressure");
  expect(existsSync(f.root)).toBe(false);
  const [reserved] = await registry.list({ projectId: f.project.id });
  expect(reserved.revision).toBe(0);
  expect(f.git("branch", "--list", reserved.branchRef.replace("refs/heads/", ""))).toBe("");
  paused = false;
  const resumed = await registry.prepare(f.request);
  expect(resumed.workspace).toMatchObject({
    id: reserved.id,
    baseCommit: reserved.baseCommit,
    directoryState: "present",
    revision: 1,
  });
}, 60_000);
