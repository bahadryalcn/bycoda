import { afterEach, expect, it, vi } from "vitest";
import * as processExecution from "../src/shared/lib/processExecution.node";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createExecutionActivityReservations,
  createWorkspaceRemovalService,
  guardedRemoveWorkspace,
  inventoryWorkspaceLinks,
} from "./workspace-cleanup";
import type {
  ManagedWorkspace,
  WorkspaceOperation,
  WorkspaceRemovalOperation,
} from "./workspace-contracts";
import type { WorkspaceCleanupDependencies } from "./workspace-cleanup";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}, 120_000);
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
async function setup(linkedAncestor = false) {
  const root = mkdtempSync(join(tmpdir(), "workspace-cleanup-"));
  roots.push(root);
  const parent = join(root, "parent");
  mkdirSync(parent);
  const ancestor = linkedAncestor ? join(root, "alias") : parent;
  if (linkedAncestor)
    symlinkSync(parent, ancestor, process.platform === "win32" ? "junction" : "dir");
  const project = join(ancestor, "project"),
    managedRoot = join(ancestor, "worktrees"),
    path = join(managedRoot, "wt-test"),
    archiveRoot = join(root, "recovery");
  mkdirSync(project);
  mkdirSync(managedRoot);
  git(project, "init", "-q");
  git(project, "checkout", "-q", "-b", "main");
  git(project, "config", "user.name", "Test");
  git(project, "config", "user.email", "test@example.test");
  writeFileSync(join(project, ".gitignore"), "/temp/\n/node_modules\n");
  writeFileSync(join(project, "source.txt"), "initial");
  git(project, "add", ".");
  git(project, "commit", "-q", "-m", "initial");
  git(project, "worktree", "add", "-q", "-b", "bycoda/t/test", path, "HEAD");
  let workspace: ManagedWorkspace = {
    id: "workspace",
    repositoryId: join(project, ".git"),
    projectId: "project",
    environmentId: "local",
    owner: { kind: "task", id: "owner" },
    path,
    branchRef: "refs/heads/bycoda/t/test",
    baseRef: "refs/heads/main",
    baseCommit: git(project, "rev-parse", "HEAD"),
    targetBranchRef: "refs/heads/main",
    state: "finished",
    directoryState: "present",
    revision: 1,
    lastActivityAt: 1,
    finishedAt: 1,
    pinned: false,
  };
  const operations = new Map<string, WorkspaceOperation>();
  const registry: WorkspaceCleanupDependencies["registry"] = {
    async get() {
      return structuredClone(workspace);
    },
    async update(request) {
      expect(request.expectedRevision).toBe(workspace.revision);
      workspace = { ...workspace, ...request.changes, revision: workspace.revision + 1 };
      return structuredClone(workspace);
    },
    async saveOperation(op, expected) {
      expect(operations.get(op.id)?.phase ?? null).toBe(expected);
      operations.set(op.id, structuredClone(op));
    },
    async getOperation(id) {
      return structuredClone(operations.get(id) ?? null);
    },
    async findOperation(request) {
      return structuredClone(
        [...operations.values()].find(
          (op) =>
            op.workspaceId === request.workspaceId &&
            op.kind === request.kind &&
            op.idempotencyKey === request.idempotencyKey,
        ) ?? null,
      );
    },
    async listOperations() {
      return structuredClone([...operations.values()]);
    },
  };
  let probe: () => Promise<[]> = async () => [];
  const reservations = createExecutionActivityReservations({
    get: async () => workspace,
    probe: async () => probe(),
    pending: async (id, except) =>
      [...operations.values()].some(
        (op) => op.workspaceId === id && op.id !== except && op.phase !== "complete",
      ),
  });
  const deps: WorkspaceCleanupDependencies = {
    registry,
    reservations,
    location: async () => ({ projectCwd: project, managedRoot, archiveRoot }),
    retentionEligible: async (w) => !w.pinned && w.state === "finished",
    authorize: async (owner) => owner.ownerId === "owner" && owner.authorizationId === "trusted",
    storageStatus: async () => {
      throw new Error("unused");
    },
  };
  const service = createWorkspaceRemovalService(deps);
  const plan = () =>
    service.plan({ workspaceId: workspace.id, expectedRevision: workspace.revision });
  const apply = async (
    authority: { ownerId: string; authorizationId: string } | { kind: "retentionScheduler" } = {
      ownerId: "owner",
      authorizationId: "trusted",
    },
  ) => {
    const p = await plan();
    return service.apply(
      {
        workspaceId: workspace.id,
        expectedRevision: workspace.revision,
        idempotencyKey: "cleanup",
        planToken: p.token,
      },
      authority,
    );
  };
  return {
    root,
    project,
    path,
    managedRoot,
    archiveRoot,
    service,
    plan,
    apply,
    reservations,
    operations,
    deps,
    get workspace() {
      return workspace;
    },
    setWorkspace: (changes: Partial<ManagedWorkspace>) => {
      workspace = { ...workspace, ...changes };
    },
    setProbe: (next: typeof probe) => {
      probe = next;
    },
  };
}

it("detaches a node_modules junction before Git removal and preserves the outside sentinel, branch and rescue refs", async () => {
  const s = await setup();
  const sentinel = join(s.root, "outside-main-node_modules");
  mkdirSync(sentinel);
  writeFileSync(join(sentinel, "sentinel.txt"), "never delete");
  symlinkSync(
    sentinel,
    join(s.path, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  writeFileSync(join(s.path, "source.txt"), "independent branch");
  git(s.path, "add", "source.txt");
  git(s.path, "commit", "-q", "-m", "unmerged");
  const head = git(s.path, "rev-parse", "HEAD"),
    ref = "refs/bycoda/rewinds/existing/rescue-head";
  git(s.project, "update-ref", ref, head);
  mkdirSync(join(s.path, "temp/verification"), { recursive: true });
  writeFileSync(join(s.path, "temp/verification/result.txt"), "evidence");
  const receipt = await s.apply({ kind: "retentionScheduler" });
  expect(existsSync(s.path)).toBe(false);
  expect(readFileSync(join(sentinel, "sentinel.txt"), "utf8")).toBe("never delete");
  expect(git(s.project, "rev-parse", "refs/heads/bycoda/t/test")).toBe(head);
  expect(git(s.project, "rev-parse", ref)).toBe(head);
  expect(
    readFileSync(join(receipt.evidenceArchivePath!, "temp/verification/result.txt"), "utf8"),
  ).toBe("evidence");
  expect(receipt.directoryState).toBe("removed");
  expect([...s.operations.values()].map((op) => op.phase)).toEqual(["complete"]);
}, 120_000);

it("cleans a registered workspace below a linked ancestor and detaches only its dependency link", async () => {
  const s = await setup(true);
  const outside = join(s.root, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "sentinel.txt"), "outside survives");
  symlinkSync(
    outside,
    join(s.path, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const head = git(s.path, "rev-parse", "HEAD");
  const ref = "refs/bycoda/rewinds/linked-ancestor/rescue-head";
  git(s.project, "update-ref", ref, head);
  expect((await s.plan()).blockers).toEqual([]);
  const receipt = await s.apply({ kind: "retentionScheduler" });
  expect(receipt.directoryState).toBe("removed");
  expect(existsSync(s.path)).toBe(false);
  expect(readFileSync(join(outside, "sentinel.txt"), "utf8")).toBe("outside survives");
  expect(git(s.project, "rev-parse", s.workspace.branchRef)).toBe(head);
  expect(git(s.project, "rev-parse", ref)).toBe(head);
}, 120_000);

it.skipIf(process.platform === "win32")(
  "removes only the validated deletion delta of a committed dependency symlink",
  async () => {
    const s = await setup();
    const target = join(s.root, "outside-dependencies");
    mkdirSync(target);
    writeFileSync(join(target, "sentinel"), "preserve");
    git(s.path, "config", "core.symlinks", "true");
    symlinkSync(target, join(s.path, "node_modules"), "dir");
    git(s.path, "add", "-f", "node_modules");
    git(s.path, "commit", "-q", "-m", "committed dependency link");
    expect(git(s.path, "ls-files", "--stage", "node_modules")).toMatch(/^120000 /);
    expect(git(s.path, "status", "--porcelain")).toBe("");
    const head = git(s.path, "rev-parse", "HEAD");
    await s.apply({ kind: "retentionScheduler" });
    expect(existsSync(s.path)).toBe(false);
    expect(readFileSync(join(target, "sentinel"), "utf8")).toBe("preserve");
    expect(git(s.project, "rev-parse", "bycoda/t/test")).toBe(head);
  },
  120_000,
);

it.skipIf(process.platform === "win32")(
  "rejects unrelated edits made while detaching a committed dependency link",
  async () => {
    const s = await setup();
    const target = join(s.root, "outside-dependencies");
    mkdirSync(target);
    git(s.path, "config", "core.symlinks", "true");
    symlinkSync(target, join(s.path, "node_modules"), "dir");
    git(s.path, "add", "-f", "node_modules");
    git(s.path, "commit", "-q", "-m", "committed dependency link");
    await expect(
      guardedRemoveWorkspace({
        projectCwd: s.project,
        managedRoot: s.managedRoot,
        path: s.path,
        branchRef: s.workspace.branchRef,
        archiveRoot: s.archiveRoot,
        operationId: "detachment-drift",
        inUse: () => false,
        phase: async (phase) => {
          if (phase === "links-detached")
            writeFileSync(join(s.path, "source.txt"), "concurrent edit");
        },
      }),
    ).rejects.toThrow(/changed|uncommitted/);
    expect(readFileSync(join(s.path, "source.txt"), "utf8")).toBe("concurrent edit");
    expect(git(s.project, "worktree", "list", "--porcelain")).toContain(
      realpathSync(s.path).replaceAll("\\", "/"),
    );
  },
  120_000,
);

it.skipIf(process.platform === "win32")(
  "rejects concurrent source drift before the link-detachment baseline is captured",
  async () => {
    const s = await setup();
    const target = join(s.root, "outside-dependencies");
    mkdirSync(target);
    symlinkSync(target, join(s.path, "node_modules"), "dir");
    git(s.path, "add", "-f", "node_modules");
    git(s.path, "commit", "-q", "-m", "committed dependency link");
    const original = processExecution.runGitText;
    let statuses = 0;
    vi.spyOn(processExecution, "runGitText").mockImplementation(async (args, options) => {
      if (args.includes("status") && ++statuses === 2)
        writeFileSync(join(s.path, "source.txt"), "concurrent edit before detachment baseline");
      return original(args, options);
    });
    await expect(
      guardedRemoveWorkspace({
        projectCwd: s.project,
        managedRoot: s.managedRoot,
        path: s.path,
        branchRef: s.workspace.branchRef,
        archiveRoot: s.archiveRoot,
        operationId: "pre-detachment-baseline-drift",
        inUse: () => false,
      }),
    ).rejects.toThrow(/changed|uncommitted/);
    expect(statuses).toBeGreaterThanOrEqual(2);
    expect(readFileSync(join(s.path, "source.txt"), "utf8")).toBe(
      "concurrent edit before detachment baseline",
    );
    expect(git(s.project, "worktree", "list", "--porcelain")).toContain(
      realpathSync(s.path).replaceAll("\\", "/"),
    );
  },
  120_000,
);

it("blocks automatic dirty cleanup; authenticated owner confirmation privately preserves staged, unstaged and untracked source", async () => {
  const s = await setup();
  writeFileSync(join(s.path, "source.txt"), "staged");
  git(s.path, "add", "source.txt");
  writeFileSync(join(s.path, "source.txt"), "unstaged");
  writeFileSync(join(s.path, "draft.txt"), "draft");
  await expect(s.apply({ kind: "retentionScheduler" })).rejects.toThrow(
    "Cleanup blocked: uncommitted changes",
  );
  expect(s.operations.size).toBe(0);
  const receipt = await s.apply();
  expect(readFileSync(join(receipt.evidenceArchivePath!, "source/source.txt"), "utf8")).toBe(
    "unstaged",
  );
  expect(readFileSync(join(receipt.evidenceArchivePath!, "source/draft.txt"), "utf8")).toBe(
    "draft",
  );
  expect(existsSync(join(receipt.evidenceArchivePath!, "index"))).toBe(true);
  const rescue = receipt.recoveryIds.find((id) => id.startsWith("refs/"))!;
  expect(git(s.project, "rev-parse", rescue)).toBe(s.workspace.baseCommit);
  git(s.project, "gc", "--prune=now");
  const indexRef = receipt.recoveryIds.find((id) => id.endsWith("/rescue-index"))!;
  expect(git(s.project, "show", `${indexRef}:source.txt`)).toBe("staged");
}, 120_000);

it("binds owner approval to file contents, not only porcelain status, and never trusts caller-mutated plan data", async () => {
  const s = await setup();
  writeFileSync(join(s.path, "source.txt"), "first");
  const p = await s.plan();
  p.statusFingerprint = "forged";
  p.dirty = false;
  writeFileSync(join(s.path, "source.txt"), "second");
  await expect(
    s.service.apply(
      {
        workspaceId: s.workspace.id,
        expectedRevision: 1,
        idempotencyKey: "cleanup",
        planToken: p.token,
      },
      { ownerId: "owner", authorizationId: "trusted" },
    ),
  ).rejects.toThrow("fingerprint changed");
  expect(readFileSync(join(s.path, "source.txt"), "utf8")).toBe("second");
  const renewed = await s.plan();
  const receipt = await s.service.apply(
    {
      workspaceId: s.workspace.id,
      expectedRevision: s.workspace.revision,
      idempotencyKey: "renewed-owner-preview",
      planToken: renewed.token,
    },
    { ownerId: "owner", authorizationId: "trusted" },
  );
  expect(receipt.directoryState).toBe("removed");
  expect(readFileSync(join(receipt.evidenceArchivePath!, "source/source.txt"), "utf8")).toBe(
    "second",
  );
}, 120_000);

it("a status failure is unknown and leaves the directory untouched", async () => {
  const s = await setup();
  const index = git(s.path, "rev-parse", "--path-format=absolute", "--git-path", "index");
  writeFileSync(index, "invalid index");
  const p = await s.plan();
  expect(p.blockers.length).toBeGreaterThan(0);
  await expect(
    s.service.apply(
      {
        workspaceId: s.workspace.id,
        expectedRevision: 1,
        idempotencyKey: "cleanup",
        planToken: p.token,
      },
      { kind: "retentionScheduler" },
    ),
  ).rejects.toThrow();
  expect(existsSync(s.path)).toBe(true);
}, 120_000);

it("blocks unknown/unapproved links without entering or detaching them", async () => {
  const s = await setup();
  const outside = join(s.root, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "sentinel"), "safe");
  symlinkSync(
    outside,
    join(s.path, "user-data"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const p = await s.plan();
  expect(p.blockers.join(" ")).toContain("Unsafe");
  await expect(s.apply()).rejects.toThrow("Unsafe");
  expect(lstatSync(join(s.path, "user-data")).isSymbolicLink()).toBe(true);
  expect(readFileSync(join(outside, "sentinel"), "utf8")).toBe("safe");
}, 120_000);

it("rejects main, external paths, repository mismatch and expired/unauthorized plans", async () => {
  const s = await setup();
  s.setWorkspace({ path: s.project });
  expect((await s.plan()).blockers.join(" ")).toContain("outside");
  s.setWorkspace({ path: s.path, repositoryId: join(s.root, "unknown.git") });
  expect((await s.plan()).blockers.join(" ")).toContain("identity");
  s.setWorkspace({ repositoryId: join(s.project, ".git") });
  await expect(s.apply({ ownerId: "intruder", authorizationId: "trusted" })).rejects.toThrow(
    "authorized",
  );
  let time = 0;
  const service = createWorkspaceRemovalService({ ...s.deps, now: () => time });
  const p = await service.plan({ workspaceId: s.workspace.id, expectedRevision: 1 });
  time = 999999;
  await expect(
    service.apply(
      {
        workspaceId: s.workspace.id,
        expectedRevision: 1,
        idempotencyKey: "expired",
        planToken: p.token,
      },
      { kind: "retentionScheduler" },
    ),
  ).rejects.toThrow("expired");
}, 120_000);

it("atomically fences starts while reserving and rejects active, unknown or unfinished-recovery activity", async () => {
  const s = await setup();
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  s.setProbe(async () => {
    await waiting;
    return [];
  });
  const reserving = s.reservations.reserve({
    workspaceId: s.workspace.id,
    operationId: "op",
    purpose: "removal",
    expectedRevision: 1,
  });
  await expect(
    s.reservations.start({ workspaceId: s.workspace.id, kind: "shell", ownerId: "owner" }),
  ).rejects.toThrow("reserved");
  finish();
  const reservation = await reserving;
  await s.reservations.release(reservation.id);
  const activity = await s.reservations.start({
    workspaceId: s.workspace.id,
    kind: "provider",
    ownerId: "owner",
  });
  await expect(
    s.reservations.reserve({
      workspaceId: s.workspace.id,
      operationId: "op",
      purpose: "removal",
      expectedRevision: 1,
    }),
  ).rejects.toThrow("in use");
  await s.reservations.stop(activity.id);
  s.setProbe(async () => {
    throw new Error("activity unavailable");
  });
  await expect(s.apply()).rejects.toThrow("unavailable");
  expect(existsSync(s.path)).toBe(true);
}, 120_000);

it("returns an idempotent receipt and rejects payload reuse", async () => {
  const s = await setup();
  const p = await s.plan();
  const request = {
    workspaceId: s.workspace.id,
    expectedRevision: 1,
    idempotencyKey: "cleanup",
    planToken: p.token,
  };
  const receipt = await s.service.apply(request, { kind: "retentionScheduler" });
  expect(await s.service.apply(request, { kind: "retentionScheduler" })).toEqual(receipt);
  await expect(
    s.service.apply({ ...request, planToken: "different" }, { kind: "retentionScheduler" }),
  ).rejects.toThrow("payload changed");
}, 120_000);

it("reconciles journaled partially deleted Windows-style remnants after restart while preserving residual files", async () => {
  const s = await setup();
  const p = await s.plan();
  git(s.project, "worktree", "remove", s.path);
  mkdirSync(s.path);
  writeFileSync(join(s.path, "locked-output.txt"), "retained");
  const op: WorkspaceRemovalOperation = {
    id: "partial",
    workspaceId: s.workspace.id,
    idempotencyKey: "partial",
    expectedRevision: 1,
    kind: "removal",
    phase: "blocked",
    resumePhase: "evidence-preserved",
    createdAt: 1,
    updatedAt: 1,
    plan: p,
    recoveryIds: [],
  };
  s.operations.set(op.id, op);
  const fresh = createWorkspaceRemovalService(s.deps);
  const result = await fresh.recover(op.id);
  expect(result.phase).toBe("complete");
  expect(existsSync(s.path)).toBe(false);
  expect(
    result.kind === "removal" &&
      result.recoveryIds.some((path) => existsSync(join(path, "locked-output.txt"))),
  ).toBe(true);
}, 120_000);

it("recovers a journal after Git unregisters before the host writes its next phase", async () => {
  const s = await setup();
  const p = await s.plan();
  const op: WorkspaceRemovalOperation = {
    id: "interrupted",
    workspaceId: s.workspace.id,
    idempotencyKey: "interrupted",
    expectedRevision: 1,
    kind: "removal",
    phase: "evidence-preserved",
    createdAt: 1,
    updatedAt: 1,
    plan: p,
    recoveryIds: [],
  };
  s.operations.set(op.id, op);
  git(s.project, "worktree", "remove", s.path);
  expect((await s.service.recover(op.id)).phase).toBe("complete");
}, 120_000);

it("validates a managed root symlink without following its outside target", async () => {
  const s = await setup();
  const alias = join(s.root, "alias");
  symlinkSync(s.managedRoot, alias, process.platform === "win32" ? "junction" : "dir");
  await expect(
    guardedRemoveWorkspace({
      projectCwd: s.project,
      managedRoot: alias,
      path: join(alias, "wt-test"),
      branchRef: s.workspace.branchRef,
      archiveRoot: s.archiveRoot,
      operationId: "unsafe",
      inUse: () => false,
    }),
  ).rejects.toThrow("reparse");
  expect(existsSync(s.path)).toBe(true);
  expect(await inventoryWorkspaceLinks(s.path)).toEqual([]);
}, 120_000);

it("automatic recovery rechecks current pins and retention policy after restart", async () => {
  const s = await setup();
  const p = await s.plan();
  const op: WorkspaceRemovalOperation = {
    id: "automatic",
    workspaceId: s.workspace.id,
    idempotencyKey: "automatic",
    expectedRevision: 1,
    kind: "removal",
    phase: "blocked",
    resumePhase: "reserved",
    createdAt: 1,
    updatedAt: 1,
    plan: p,
    recoveryIds: [],
  };
  s.operations.set(op.id, { ...op, automatic: true } as WorkspaceRemovalOperation);
  s.setWorkspace({ pinned: true });
  await expect(createWorkspaceRemovalService(s.deps).recover(op.id)).rejects.toThrow("eligible");
  expect(existsSync(s.path)).toBe(true);
}, 120_000);

it("recovery never force-removes newly dirty intact source after its earlier preservation", async () => {
  const s = await setup();
  const p = await s.plan();
  const op: WorkspaceRemovalOperation = {
    id: "changed",
    workspaceId: s.workspace.id,
    idempotencyKey: "changed",
    expectedRevision: 1,
    kind: "removal",
    phase: "evidence-preserved",
    createdAt: 1,
    updatedAt: 1,
    plan: p,
    recoveryIds: [],
  };
  s.operations.set(op.id, op);
  writeFileSync(join(s.path, "later-owner-draft.txt"), "new work");
  await expect(s.service.recover(op.id)).rejects.toThrow("owner preview");
  expect(readFileSync(join(s.path, "later-owner-draft.txt"), "utf8")).toBe("new work");
}, 120_000);
