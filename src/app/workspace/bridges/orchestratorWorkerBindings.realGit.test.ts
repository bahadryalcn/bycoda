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
import { HostEngine } from "../../../../host/engine";
import { createManagedWorkspaceRuntime } from "../../../../host/managed-workspace-runtime";
import { HostStore } from "../../../../host/store";
import type { WorkspaceRpcRequest } from "../../../features/workspaces/model/contracts";
import type {
  OrchestrationRun,
  OrchestrationTask,
} from "../../../features/orchestration/model/orchestration";
import type { Session } from "../../../features/sessions/model/session";

const m = vi.hoisted(() => ({
  request: vi.fn(),
  context: vi.fn(),
  listed: vi.fn(),
  sessions: [] as Session[],
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../../features/sessions/data/sessionStore", () => ({
  upsertSession: vi.fn(),
  getSession: vi.fn(),
  flushSessionWrites: vi.fn(),
  shouldPersistSession: () => true,
}));
vi.mock("../../../features/sessions/model/sessionsStore", () => ({
  sessionsRef: {
    get current() {
      return m.sessions;
    },
    set current(value) {
      m.sessions = value;
    },
  },
  setSessions: vi.fn(),
}));
vi.mock("../../../features/source-control/model/worktrees", () => ({
  listWorktrees: m.listed,
  removeOrchestrationWorktree: vi.fn(),
  detachSessionWorktree: vi.fn(),
}));
vi.mock("../../../features/workspaces/model/workspaceClient", () => ({
  workspaceRequest: m.request,
  resolveWorkspaceContext: m.context,
  workspaceOperationKey: () => "binding-operation",
}));
vi.mock("../../../integrations/harness", () => ({
  bindHarnessSession: vi.fn(),
  stopHarnessSession: vi.fn(),
  forgetHarnessSession: vi.fn(),
}));
vi.mock("../../../features/sessions/model/checkpoint", () => ({
  flushSessionCheckpoint: vi.fn(),
  sessionCheckpointCleanupSafe: vi.fn(),
  forgetSessionCheckpoint: vi.fn(),
  notifyReviewChanged: vi.fn(),
}));

import { newSession } from "../../../features/sessions/model/session";
import { workspaceIdentity } from "../../../features/orchestration/model/orchestration";
import { createOrchestratorWorkerBindings } from "./orchestratorWorkerBindings";

// Only the renderer/native transport is mocked. Preparation, persisted identity,
// owner approval, merge and post-delivery review use production Host services and Git.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 30_000 });
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.clearAllMocks();
  m.sessions = [];
});
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    windowsHide: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

async function fixture() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-crew-binding-")));
  const repo = join(root, "repo");
  const lead = join(root, "lead");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "Crew regression");
  git(repo, "config", "user.email", "crew-regression@example.invalid");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "config", "core.autocrlf", "false");
  writeFileSync(join(repo, "base.txt"), "integration baseline\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "integration baseline");
  const integrationHead = git(repo, "rev-parse", "HEAD");
  git(repo, "worktree", "add", "-q", "-b", "feature/lead", lead);
  writeFileSync(join(lead, "prerequisite.txt"), "lead prerequisite\n");
  git(lead, "add", ".");
  git(lead, "commit", "-qm", "lead prerequisite absent from integration");
  const leadHead = git(lead, "rev-parse", "HEAD");
  const store = new HostStore(join(root, "host.db"));
  await store.ready;
  const engine = new HostEngine(store, {});
  await engine.ready;
  const project = await engine.openProject(repo);
  const runtime = createManagedWorkspaceRuntime(store, engine);
  cleanups.push(async () => {
    runtime.retention.stop();
    await engine.close();
    await store.close();
    if (!root.startsWith(realpathSync.native(tmpdir())) || !root.includes("bycoda-crew-binding-"))
      throw new Error("Unsafe Crew regression cleanup");
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  });
  expect(await runtime.recover()).toEqual([]);
  await runtime.withOwner("regression-owner", (owner) =>
    runtime.policy.update(
      {
        projectId: project.id,
        environmentId: store.environmentId,
        expectedRevision: 0,
        idempotencyKey: "policy",
        policy: {
          root: join(root, "managed"),
          disk: { minimumFreeBytes: 1, budgetBytes: 1024 ** 3, warningRatio: 0.8 },
        },
      },
      owner,
    ),
  );
  m.context.mockResolvedValue({ projectId: project.id, environmentId: store.environmentId });
  m.request.mockImplementation(async (method: string, request: unknown) => {
    switch (method) {
      case "workspaces.prepare":
        return runtime.registry.prepare(request as WorkspaceRpcRequest<"workspaces.prepare">);
      case "workspaces.get":
        return runtime.registry.get(request as WorkspaceRpcRequest<"workspaces.get">);
      case "workspaces.finish":
        return runtime.registry.finish(request as WorkspaceRpcRequest<"workspaces.finish">);
      case "workspaces.delivery.review":
        return runtime.delivery.review(
          request as WorkspaceRpcRequest<"workspaces.delivery.review">,
        );
      default:
        throw new Error(`Unexpected binding request: ${method}`);
    }
  });
  m.listed.mockImplementation(async () => ({
    worktrees: git(repo, "worktree", "list", "--porcelain", "-z")
      .split("\0\0")
      .filter(Boolean)
      .map((record) => {
        const fields = record.split("\0");
        return {
          path: fields.find((field) => field.startsWith("worktree "))!.slice(9),
          head: fields.find((field) => field.startsWith("HEAD "))!.slice(5),
          branch:
            fields
              .find((field) => field.startsWith("branch "))
              ?.slice(7)
              .replace(/^refs\/heads\//, "") ?? null,
        };
      }),
  }));
  m.sessions = [
    { ...newSession("codex", repo), id: "lead", worktreeCwd: lead, branch: "feature/lead" },
  ];
  const run = {
    leadId: "lead",
    cwd: repo,
    workspace: workspaceIdentity(repo, lead, "feature/lead"),
  } as OrchestrationRun;
  const task = {
    id: "task",
    title: "Implement against prerequisite",
    sessionId: "worker",
    harness: "codex",
    model: "codex:fixture",
  } as OrchestrationTask;
  const binding = createOrchestratorWorkerBindings({
    checkOpenWorktreeFiles: vi.fn(),
    onStop: vi.fn(),
    setHistory: vi.fn(),
    setStoredLinkedSessions: vi.fn(),
  });
  task.workspace = (await binding.createWorker!(run, task)).workspace;
  const workspaceId = task.workspace.managedWorkspaceId!;
  expect(task.workspace.source).toMatchObject({
    baseCommit: leadHead,
    branchRef: "refs/heads/feature/lead",
  });
  expect(realpathSync.native(task.workspace.source!.directory)).toBe(lead);
  expect(git(task.workspace.checkoutCwd, "rev-parse", "HEAD")).toBe(leadHead);
  expect(readFileSync(join(task.workspace.checkoutCwd, "prerequisite.txt"), "utf8")).toBe(
    "lead prerequisite\n",
  );
  expect(existsSync(join(repo, "prerequisite.txt"))).toBe(false);
  writeFileSync(join(task.workspace.checkoutCwd, "worker.txt"), "depends on lead prerequisite\n");
  git(task.workspace.checkoutCwd, "add", ".");
  git(task.workspace.checkoutCwd, "commit", "-qm", "worker result");
  const workerHead = git(task.workspace.checkoutCwd, "rev-parse", "HEAD");
  await expect(binding.integrateWorker!(run, task)).rejects.toThrow(
    "owner-approved managed delivery",
  );
  expect(git(lead, "rev-parse", "HEAD")).toBe(leadHead);
  expect(git(repo, "rev-parse", "HEAD")).toBe(integrationHead);
  return {
    repo,
    lead,
    runtime,
    binding,
    run,
    task,
    workspaceId,
    workerHead,
    integrationHead,
    leadHead,
  };
}

it.each([false, true])(
  "binds acceptance to the selected lead after real owner delivery (wrong integration target: %s)",
  async (wrongTarget) => {
    const f = await fixture();
    let managed = await f.runtime.get(f.workspaceId);
    if (wrongTarget) {
      managed = await f.runtime.withOwner("regression-owner", (owner) =>
        f.runtime.services.retargetWorkspace(
          {
            workspaceId: managed.id,
            expectedRevision: managed.revision,
            idempotencyKey: "wrong-target",
            targetBranchRef: "refs/heads/main",
            targetDirectory: f.repo,
          },
          owner,
        ),
      );
    }
    const plan = await f.runtime.delivery.review({
      workspaceId: managed.id,
      expectedRevision: managed.revision,
      action: "merge",
    });
    expect(plan.blockers).toEqual([]);
    const request = {
      workspaceId: managed.id,
      expectedRevision: managed.revision,
      idempotencyKey: "deliver",
      planToken: plan.token,
    };
    await expect(
      f.runtime.delivery.merge(request, { ownerId: "invented", authorizationId: "invented" }),
    ).rejects.toThrow("Authenticated owner approval required");
    await f.runtime.withOwner("regression-owner", (owner) =>
      f.runtime.delivery.merge(request, owner),
    );
    expect((await f.runtime.get(managed.id)).state).toBe("merged");
    if (wrongTarget) {
      expect(git(f.repo, "merge-base", "--is-ancestor", f.workerHead, "HEAD")).toBe("");
      expect(git(f.lead, "rev-parse", "HEAD")).toBe(f.leadHead);
      expect(existsSync(join(f.lead, "worker.txt"))).toBe(false);
      await expect(f.binding.integrateWorker!(f.run, f.task)).rejects.toThrow(
        "delivery target differs from its selected lead",
      );
    } else {
      expect(git(f.lead, "merge-base", "--is-ancestor", f.workerHead, "HEAD")).toBe("");
      expect(readFileSync(join(f.lead, "worker.txt"), "utf8")).toBe(
        "depends on lead prerequisite\n",
      );
      expect(git(f.repo, "rev-parse", "HEAD")).toBe(f.integrationHead);
      await expect(f.binding.integrateWorker!(f.run, f.task)).resolves.toEqual({
        files: [],
        alreadyApplied: 0,
      });
    }
  },
);
