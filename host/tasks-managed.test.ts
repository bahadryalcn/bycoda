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
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "./store";
import { HostTasks } from "./tasks";
import { previewTaskFinalization, type TaskWorkspaceServices } from "./task-workspace-runtime";
import { writerWorkspaces } from "./writer-workspaces.test-support";
import type { SessionRunEngine } from "./sessionRuns";
import type { HostTask } from "../src/features/tasks/model/hostTasks";
import { unfinishedDependencies } from "../src/features/tasks/model/hostTasks";
import type { WorkspaceDeliveryOperation } from "./workspace-contracts";
import * as taskArtifacts from "./task-artifacts";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    stdio: "pipe",
  }).trim();

async function fixture() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-managed-tasks-")));
  git(root, "init", "-q", "--initial-branch=main", "repo");
  const cwd = join(root, "repo");
  git(cwd, "config", "user.name", "Test");
  git(cwd, "config", "user.email", "test@example.test");
  git(cwd, "config", "core.autocrlf", "false");
  git(cwd, "config", "commit.gpgsign", "false");
  writeFileSync(join(cwd, "file.txt"), "base\n");
  git(cwd, "add", "file.txt");
  git(cwd, "commit", "-qm", "base");
  const store = new HostStore(join(root, "host.db"));
  const project = await store.addProject(cwd, "repo");
  const adapters = writerWorkspaces(root, async () => cwd);
  const services = adapters as unknown as TaskWorkspaceServices;
  services.registry.resume = vi.fn(async ({ workspaceId }) => {
    const row = adapters.rows.get(workspaceId)!;
    if (!existsSync(row.path))
      git(cwd, "worktree", "add", row.path, row.branchRef.replace("refs/heads/", ""));
    const next = {
      ...row,
      state: "active" as const,
      directoryState: "present" as const,
      revision: row.revision + 1,
    };
    adapters.rows.set(row.id, next);
    return next;
  });
  services.delivery = { review: vi.fn(), merge: vi.fn(), publish: vi.fn(), recover: vi.fn() };
  const engine = { command: vi.fn(), updateSession: vi.fn() } as unknown as SessionRunEngine;
  const tasks = new HostTasks(store, engine, () => 100, undefined, services);
  await tasks.ready;
  cleanups.push(async () => {
    await tasks.close();
    await store.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const input = (id = "task") => ({
    id,
    title: id,
    prompt: "Implement scoped work",
    projectId: project.id,
    harness: "claude",
    model: "test",
    modelSettings: {},
    runtimeMode: "auto",
    maxRunMinutes: 0,
    review: false,
    status: "todo",
  });
  const internal = tasks as unknown as {
    workingCopy(task: HostTask): Promise<HostTask>;
    requireFinalized(task: HostTask, cwd: string): Promise<void>;
    enterReview(task: HostTask): Promise<HostTask>;
    cleanupDelivered(task: HostTask, now: number): Promise<HostTask>;
  };
  return { root, cwd, store, project, services, adapters, tasks, engine, input, internal };
}

it("pins independent writer workspaces to committed source and reuses their identities", async () => {
  const f = await fixture();
  writeFileSync(join(f.cwd, "file.txt"), "owner draft\n");
  const first = await f.internal.workingCopy(await f.tasks.save(f.input("first")));
  const second = await f.internal.workingCopy(await f.tasks.save(f.input("second")));
  expect(first.workspaceId).not.toBe(second.workspaceId);
  expect(first.worktreeCwd).not.toBe(second.worktreeCwd);
  expect(first.baseCommit).toBe(git(f.cwd, "rev-parse", "HEAD"));
  expect(readFileSync(join(first.worktreeCwd!, "file.txt"), "utf8")).toBe("base\n");
  expect(readFileSync(join(f.cwd, "file.txt"), "utf8")).toBe("owner draft\n");
  expect((await f.internal.workingCopy(first)).workspaceId).toBe(first.workspaceId);
  expect(f.adapters.prepare).toHaveBeenCalledTimes(2);
});

it("previews leftovers without staging or committing and completes only a clean source branch", async () => {
  const f = await fixture();
  const task = await f.internal.workingCopy(await f.tasks.save(f.input()));
  const cwd = task.worktreeCwd!;
  writeFileSync(join(cwd, "file.txt"), "staged\n");
  git(cwd, "add", "file.txt");
  writeFileSync(join(cwd, "file.txt"), "working\n");
  writeFileSync(join(cwd, "unexpected.txt"), "retain\n");
  const before = git(cwd, "diff", "--cached", "--binary");
  const head = git(cwd, "rev-parse", "HEAD");
  await expect(f.internal.requireFinalized(task, cwd)).rejects.toThrow(
    "Finalization requires review",
  );
  expect(git(cwd, "rev-parse", "HEAD")).toBe(head);
  expect(git(cwd, "diff", "--cached", "--binary")).toBe(before);
  expect((await f.tasks.get(task.id))?.finalization?.status).toContain("unexpected.txt");
  git(cwd, "add", "file.txt");
  git(cwd, "commit", "-qm", "scoped implementation");
  await expect(f.internal.requireFinalized((await f.tasks.get(task.id))!, cwd)).rejects.toThrow(
    "Finalization requires review",
  );
  git(cwd, "add", "unexpected.txt");
  git(cwd, "commit", "-qm", "explicitly retain intended output");
  await f.internal.requireFinalized((await f.tasks.get(task.id))!, cwd);
  const completed = await f.internal.enterReview((await f.tasks.get(task.id))!);
  expect(completed).toMatchObject({
    status: "review",
    deliveryState: "awaitingOwner",
    deliveryApprovalRequired: true,
  });
  expect(f.adapters.finish).toHaveBeenCalledOnce();
  expect(f.services.delivery.merge).not.toHaveBeenCalled();
  expect(git(f.cwd, "rev-parse", "HEAD")).toBe(head);
});

it("suspends legacy automatic delivery across restart and refuses a board move as merge approval", async () => {
  const f = await fixture();
  const task = await f.internal.workingCopy(await f.tasks.save({ ...f.input(), autoMerge: true }));
  expect(task.autoMerge).toBeUndefined();
  expect(task.deliveryApprovalRequired).toBe(true);
  await f.store.db
    .prepare(
      "UPDATE tasks SET value=json_set(value, '$.autoMerge', json('true'), '$.status', 'review') WHERE id=?",
    )
    .run(task.id);
  const restarted = new HostTasks(f.store, f.engine, () => 101, undefined, f.services);
  await restarted.ready;
  expect(await restarted.get(task.id)).toMatchObject({
    deliveryApprovalRequired: true,
    deliveryState: "awaitingOwner",
  });
  expect((await restarted.get(task.id))?.autoMerge).toBeUndefined();
  await expect(restarted.move(task.id, "done")).rejects.toThrow("does not authorize delivery");
  expect(f.services.delivery.merge).not.toHaveBeenCalled();
  await restarted.close();
});

it("retiring a delivered directory preserves branch identity, dependency commit and rematerialization", async () => {
  const f = await fixture();
  const task = await f.internal.workingCopy(await f.tasks.save(f.input()));
  const head = git(task.worktreeCwd!, "rev-parse", "HEAD");
  const delivered = { ...task, status: "done" as const, merged: true, deliveredCommit: head };
  const retired = await f.internal.cleanupDelivered(delivered, 200);
  expect(existsSync(task.worktreeCwd!)).toBe(false);
  expect(retired.workspaceId).toBe(task.workspaceId);
  expect(retired.deliveredCommit).toBe(head);
  expect(git(f.cwd, "rev-parse", task.branch!)).toBe(head);
  expect(unfinishedDependencies({ dependsOn: [task.id] }, [retired])).toEqual([]);
  const resumed = await f.internal.workingCopy({ ...retired, merged: false });
  expect(resumed.workspaceId).toBe(task.workspaceId);
  expect(existsSync(resumed.worktreeCwd!)).toBe(true);
  expect((await previewTaskFinalization(resumed.worktreeCwd!, resumed.branch!)).head).toBe(head);
});

it("fails closed when new isolated execution has no registry", async () => {
  const f = await fixture();
  const tasks = new HostTasks(f.store, f.engine, () => 102);
  const task = await tasks.save(f.input());
  await expect(
    (tasks as unknown as { workingCopy(task: HostTask): Promise<HostTask> }).workingCopy(task),
  ).rejects.toThrow("Update this host");
  expect(f.engine.command).not.toHaveBeenCalled();
  await tasks.close();
});

it("gives a new post-delivery attempt a fresh creation key while retaining the delivered branch", async () => {
  const f = await fixture();
  const task = await f.internal.workingCopy(await f.tasks.save(f.input()));
  const head = git(task.worktreeCwd!, "rev-parse", "HEAD");
  await f.internal.cleanupDelivered(
    { ...task, status: "done", merged: true, deliveredCommit: head },
    200,
  );
  const queued = await f.tasks.move(task.id, "queued");
  expect(queued.workspaceGenerationId).not.toBe(task.workspaceGenerationId);
  const next = await f.internal.workingCopy(queued);
  expect(next.workspaceId).not.toBe(task.workspaceId);
  expect(next.branch).not.toBe(task.branch);
  expect(git(f.cwd, "rev-parse", task.branch!)).toBe(head);
});

it("projects durable publication receipts without releasing integration dependencies", async () => {
  const f = await fixture();
  const prepared = await f.internal.workingCopy(await f.tasks.save(f.input()));
  const task = await f.internal.enterReview(prepared);
  const workspace = f.adapters.rows.get(task.workspaceId!)!;
  const head = git(task.worktreeCwd!, "rev-parse", "HEAD");
  f.services.registry.listOperations = vi.fn(async () => []);
  expect((await f.tasks.reconcileDelivery(workspace.id))?.deliveryState).toBe("awaitingOwner");
  const operation: WorkspaceDeliveryOperation = {
    id: "publication-receipt",
    kind: "delivery",
    phase: "complete",
    workspaceId: workspace.id,
    expectedRevision: workspace.revision,
    idempotencyKey: "publish",
    createdAt: 100,
    updatedAt: 101,
    plan: {
      token: "reviewed",
      expiresAt: 200,
      workspaceId: workspace.id,
      expectedRevision: workspace.revision,
      sourceBranchRef: workspace.branchRef,
      sourceHead: head,
      targetBranchRef: workspace.targetBranchRef,
      targetHead: head,
      targetStatusFingerprint: "clean",
      commits: [],
      changedPaths: [],
      overlappingPaths: [],
      checks: [],
      visualEvidence: [],
      blockers: [],
      action: "publish",
      publication: {
        repository: "test/repo",
        remote: "origin",
        baseBranchRef: workspace.targetBranchRef,
        headBranchRef: workspace.branchRef,
        title: "Scoped work",
        body: "Reviewed changes",
      },
    },
    publication: {
      operationId: "publication-receipt",
      workspaceId: workspace.id,
      status: "complete",
      push: { remote: "origin", branchRef: workspace.branchRef, sourceHead: head, pushedAt: 101 },
      pullRequest: {
        repository: "test/repo",
        number: 1,
        url: "https://example.test/1",
        sourceHead: head,
        createdAt: 101,
      },
    },
  };
  f.services.registry.listOperations = vi.fn(async () => [operation]);
  const published = (await f.tasks.reconcileDelivery(workspace.id))!;
  expect(published).toMatchObject({
    status: "done",
    deliveryState: "published",
    deliveryOperationId: operation.id,
  });
  expect(unfinishedDependencies({ dependsOn: [published.id] }, [published])).toEqual([published]);
  expect(f.services.delivery.publish).not.toHaveBeenCalled();
});

it.each([false, true])(
  "delivers reviewed ignored outputs and retains the Git receipt across copy failure (%s)",
  async (failCopy) => {
    const f = await fixture();
    writeFileSync(join(f.cwd, ".gitignore"), "temp/\n");
    git(f.cwd, "add", ".gitignore");
    git(f.cwd, "commit", "-qm", "ignore task outputs");
    const prepared = await f.internal.workingCopy(await f.tasks.save(f.input()));
    const source = prepared.worktreeCwd!;
    writeFileSync(join(source, "feature.txt"), "implemented\n");
    git(source, "add", "feature.txt");
    git(source, "commit", "-qm", "scoped work");
    const path = "temp/local/report/result.txt";
    mkdirSync(join(source, "temp/local/report"), { recursive: true });
    writeFileSync(join(source, path), "verified output\n");
    const reviewing = await f.internal.enterReview(prepared);
    const workspace = f.adapters.rows.get(reviewing.workspaceId!)!;
    const sourceHead = git(source, "rev-parse", "HEAD");
    const plan: WorkspaceDeliveryOperation["plan"] = {
      token: "artifact-review",
      expiresAt: 1000,
      action: "merge",
      workspaceId: workspace.id,
      expectedRevision: workspace.revision,
      sourceBranchRef: workspace.branchRef,
      sourceHead,
      targetBranchRef: workspace.targetBranchRef,
      targetHead: git(f.cwd, "rev-parse", "HEAD"),
      targetStatusFingerprint: "reviewed",
      commits: [sourceHead],
      changedPaths: ["feature.txt"],
      overlappingPaths: [],
      checks: [],
      visualEvidence: [],
      blockers: [],
    };
    let operation: WorkspaceDeliveryOperation | undefined;
    let integrations = 0;
    f.services.registry.findOperation = vi.fn(async () => operation ?? null);
    f.services.registry.listOperations = vi.fn(async () => (operation ? [operation] : []));
    f.services.delivery.review = vi.fn(async () => ({ ...plan, targetDirectory: f.cwd }));
    f.services.delivery.merge = vi.fn(async () => {
      if (operation?.merge) return operation.merge;
      git(f.cwd, "merge", "--no-ff", "--no-edit", sourceHead);
      integrations++;
      const receipt = {
        operationId: "merge-artifacts",
        workspaceId: workspace.id,
        sourceHead,
        previousTargetHead: plan.targetHead,
        targetHead: git(f.cwd, "rev-parse", "HEAD"),
        workspaceRevision: workspace.revision + 1,
      };
      operation = {
        id: receipt.operationId,
        kind: "delivery",
        phase: "complete",
        workspaceId: workspace.id,
        expectedRevision: plan.expectedRevision,
        idempotencyKey: "deliver-artifacts",
        plan,
        merge: receipt,
        createdAt: 100,
        updatedAt: 101,
      };
      f.adapters.rows.set(workspace.id, {
        ...workspace,
        state: "merged",
        deliveredCommit: receipt.targetHead,
        revision: receipt.workspaceRevision,
      });
      return receipt;
    });
    const reviewed = await f.tasks.reviewDelivery(reviewing.id);
    expect("artifacts" in reviewed && reviewed.artifacts.paths).toEqual([path]);
    const request = {
      workspaceId: workspace.id,
      expectedRevision: plan.expectedRevision,
      idempotencyKey: "deliver-artifacts",
      planToken: plan.token,
    };
    const owner = { ownerId: "owner", authorizationId: "trusted-owner" };
    if (failCopy) {
      const copy = vi
        .spyOn(taskArtifacts, "transferTaskArtifacts")
        .mockRejectedValueOnce(new Error("temporary artifact copy failure"));
      try {
        await expect(f.tasks.mergeDelivery(reviewing.id, request, owner)).rejects.toThrow(
          "temporary artifact copy failure",
        );
      } finally {
        copy.mockRestore();
      }
      const held = (await f.tasks.get(reviewing.id))!;
      expect(held).toMatchObject({
        status: "review",
        merged: true,
        artifactDeliveryPending: true,
        deliveryOperationId: "merge-artifacts",
      });
      expect(held.artifactDeliveryActivityId).toBeTruthy();
      await expect(f.tasks.delete(held.id)).rejects.toThrow(
        "Reconcile the recorded artifact delivery",
      );
      await expect(f.tasks.move(held.id, "queued")).rejects.toThrow(
        "Finish the recorded artifact delivery",
      );
      await f.internal.cleanupDelivered(held, 200);
      expect(existsSync(source)).toBe(true);
    }
    const delivered = await f.tasks.mergeDelivery(reviewing.id, request, owner);
    expect(integrations).toBe(1);
    expect(delivered).toMatchObject({ status: "done", merged: true, artifactPaths: [path] });
    expect(delivered.artifactDeliveryPending).not.toBe(true);
    expect(readFileSync(join(f.cwd, path), "utf8")).toBe("verified output\n");
    await f.internal.cleanupDelivered(delivered, 300);
    expect(existsSync(source)).toBe(false);
    expect(git(f.cwd, "rev-parse", prepared.branch!)).toBe(sourceHead);
  },
);

it.each(["source", "target"])(
  "refuses ignored artifact %s drift before invoking integration",
  async (changed) => {
    const f = await fixture();
    writeFileSync(join(f.cwd, ".gitignore"), "temp/\n");
    git(f.cwd, "add", ".gitignore");
    git(f.cwd, "commit", "-qm", "ignore outputs");
    const prepared = await f.internal.workingCopy(await f.tasks.save(f.input()));
    const path = "temp/local/result.txt";
    mkdirSync(join(prepared.worktreeCwd!, "temp/local"), { recursive: true });
    writeFileSync(join(prepared.worktreeCwd!, path), "reviewed bytes\n");
    await f.internal.enterReview(prepared);
    const workspace = f.adapters.rows.get(prepared.workspaceId!)!;
    const head = git(f.cwd, "rev-parse", "HEAD");
    f.services.delivery.review = vi.fn(async () => ({
      token: "approved-artifacts",
      expiresAt: 1000,
      action: "merge",
      workspaceId: workspace.id,
      expectedRevision: workspace.revision,
      sourceBranchRef: workspace.branchRef,
      sourceHead: head,
      targetBranchRef: workspace.targetBranchRef,
      targetHead: head,
      targetStatusFingerprint: "clean",
      commits: [],
      changedPaths: [],
      overlappingPaths: [],
      checks: [],
      visualEvidence: [],
      blockers: [],
      targetDirectory: f.cwd,
    }));
    const plan = await f.tasks.reviewDelivery(prepared.id);
    const modifiedRoot = changed === "source" ? prepared.worktreeCwd! : f.cwd;
    mkdirSync(join(modifiedRoot, "temp/local"), { recursive: true });
    writeFileSync(join(modifiedRoot, path), "later owner bytes\n");
    f.services.registry.findOperation = vi.fn(async () => null);
    await expect(
      f.tasks.mergeDelivery(
        prepared.id,
        {
          workspaceId: workspace.id,
          expectedRevision: workspace.revision,
          idempotencyKey: "deliver-drift",
          planToken: plan.token,
        },
        { ownerId: "owner", authorizationId: "trusted" },
      ),
    ).rejects.toThrow();
    expect(f.services.delivery.merge).not.toHaveBeenCalled();
    expect(git(f.cwd, "rev-parse", "HEAD")).toBe(head);
    expect(readFileSync(join(modifiedRoot, path), "utf8")).toBe("later owner bytes\n");
  },
);
