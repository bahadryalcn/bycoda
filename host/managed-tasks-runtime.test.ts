import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostEngine } from "./engine";
import type { HostProvider } from "./providers";
import { createHostServer } from "./server";
import { HostStore } from "./store";
import type { TaskDeliveryReview } from "../src/features/tasks/model/hostTasks";
import type { BranchMergeReceipt } from "./workspace-contracts";

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
  }).trim();
const artifactPath = "temp/local/report/report.md";
const report = "# Reviewed task report\n\nRetain this ignored output.\n";

it.each([false, true])(
  "delivers a real managed task and unblocks its dependency (artifact interruption: %s)",
  async (interruptArtifacts) => {
    const root = mkdtempSync(join(tmpdir(), "bycoda-managed-task-runtime-"));
    const target = join(root, "repo");
    mkdirSync(target);
    git(target, "init", "-q", "-b", "main");
    git(target, "config", "user.name", "Managed Task Runtime");
    git(target, "config", "user.email", "managed-task@example.test");
    git(target, "config", "commit.gpgsign", "false");
    git(target, "config", "core.autocrlf", "false");
    writeFileSync(join(target, ".gitignore"), "/temp/\n");
    writeFileSync(join(target, "source.txt"), "committed baseline\n");
    git(target, "add", ".");
    git(target, "commit", "-qm", "Task runtime baseline");
    const base = git(target, "rev-parse", "HEAD");
    const store = new HostStore(join(root, "host.db"));
    const providerDirectories: string[] = [];
    const provider: HostProvider = {
      async send(input) {
        providerDirectories.push(input.cwd);
        if (providerDirectories.length === 1) {
          writeFileSync(join(input.cwd, "source.txt"), "managed task implementation\n");
          mkdirSync(join(input.cwd, "temp/local/report"), { recursive: true });
          writeFileSync(join(input.cwd, artifactPath), report);
          git(input.cwd, "add", "source.txt");
          git(input.cwd, "commit", "-qm", "Implement managed task source");
        } else {
          // The real dependency admission/transfer path must prepare both inputs.
          expect(readFileSync(join(input.cwd, artifactPath), "utf8")).toBe(report);
          expect(readFileSync(join(input.cwd, "source.txt"), "utf8")).toBe(
            "managed task implementation\n",
          );
          writeFileSync(join(input.cwd, "dependent.txt"), "consumed delivered source and report\n");
          git(input.cwd, "add", "dependent.txt");
          git(input.cwd, "commit", "-qm", "Consume managed task dependency");
        }
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
      if (!root.startsWith(join(tmpdir(), "bycoda-managed-task-runtime-")))
        throw new Error("Unsafe managed task fixture cleanup");
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const device = await store.issueDevice("Task delivery owner");
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
    const request = async (method: string, params: unknown) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${device.token}` },
        body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
      });
      return {
        status: response.status,
        value: (await response.json()) as { result?: any; error?: string },
      };
    };
    const call = async <T = any>(method: string, params: unknown): Promise<T> => {
      const response = await request(method, params);
      expect(response.status, `${method}: ${response.value.error ?? ""}`).toBe(200);
      expect(response.value.error, method).toBeUndefined();
      return response.value.result as T;
    };
    await call("projects.workspacePolicy.update", {
      projectId: project.id,
      environmentId: store.environmentId,
      expectedRevision: 0,
      idempotencyKey: "task-runtime-policy",
      policy: {
        root: join(root, "worktrees"),
        disk: { budgetBytes: 1024 ** 3, warningRatio: 0.8, minimumFreeBytes: 1 },
      },
    });
    const taskInput = {
      title: "Produce committed source and report",
      prompt: "Implement the source and write an ignored local report.",
      projectId: project.id,
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "auto",
      maxRunMinutes: 0,
      isolate: true,
      review: false,
    };
    const tasks = server.tasks;
    await tasks.save({ ...taskInput, id: "parent" });
    await tasks.save({ ...taskInput, id: "dependent", dependsOn: ["parent"] });
    await tasks.startTask("parent");
    await vi.waitFor(
      async () => {
        const task = (await tasks.get("parent"))!;
        expect(task.sessionId).toBeTruthy();
        expect((await store.session(task.sessionId!)).status).toBe("idle");
      },
      { timeout: 60_000, interval: 100 },
    );
    await tasks.tick();
    await tasks.idle();
    const reviewed = (await tasks.get("parent"))!;
    expect(
      reviewed,
      JSON.stringify({
        status: reviewed.status,
        error: reviewed.error,
        verification: reviewed.verification,
      }),
    ).toMatchObject({
      status: "review",
      isolate: true,
      deliveryApprovalRequired: true,
      finalization: { clean: true },
    });
    expect(reviewed.workspaceId).toBeTruthy();
    expect(reviewed.worktreeCwd).not.toBe(project.cwd);
    expect((await tasks.get("dependent"))?.status).toBe("queued");
    expect(providerDirectories).toEqual([reviewed.worktreeCwd]);
    expect(git(target, "rev-parse", "HEAD")).toBe(base);
    expect(existsSync(join(target, artifactPath))).toBe(false);
    const review = await call<TaskDeliveryReview>("workspaces.delivery.review", {
      workspaceId: reviewed.workspaceId,
      expectedRevision: (await server.managedWorkspaces.get(reviewed.workspaceId!)).revision,
      action: "merge",
    });
    expect(review.blockers).toEqual([]);
    expect(review.artifacts?.paths).toEqual([artifactPath]);
    const mergeRequest = {
      workspaceId: reviewed.workspaceId,
      expectedRevision: review.expectedRevision,
      planToken: review.token,
      idempotencyKey: "task-owner-delivery",
    };
    let receipt: BranchMergeReceipt;
    if (interruptArtifacts) {
      const admission = vi
        .spyOn(server.managedWorkspaces.activity, "start")
        .mockRejectedValueOnce(new Error("Injected artifact admission interruption"));
      try {
        const failed = await request("workspaces.delivery.merge", mergeRequest);
        expect(failed.status).toBe(400);
        expect(failed.value.error).toContain("Injected artifact admission interruption");
      } finally {
        admission.mockRestore();
      }
      const pending = (await tasks.get("parent"))!;
      expect(pending).toMatchObject({
        status: "review",
        merged: true,
        artifactDeliveryPending: true,
      });
      expect(pending.artifactDeliveryActivityId).toBeUndefined();
      expect(git(target, "rev-parse", "HEAD")).not.toBe(base);
      expect(existsSync(join(target, artifactPath))).toBe(false);
      await tasks.tick();
      await tasks.idle();
      expect((await tasks.get("dependent"))?.status).toBe("queued");
      expect(providerDirectories).toHaveLength(1);
      expect(
        await server.managedWorkspaces.recover((workspaceId) =>
          tasks.reconcileDelivery(workspaceId),
        ),
      ).toEqual([]);
      // Duplicate HTTP delivery returns its durable Git receipt, without a second merge.
      receipt = await call<BranchMergeReceipt>("workspaces.delivery.merge", mergeRequest);
    } else {
      receipt = await call<BranchMergeReceipt>("workspaces.delivery.merge", mergeRequest);
    }
    expect(receipt).toMatchObject({
      workspaceId: reviewed.workspaceId,
      sourceHead: review.sourceHead,
      targetHead: git(target, "rev-parse", "HEAD"),
    });
    expect(receipt.operationId).toBeTruthy();
    expect(receipt).not.toHaveProperty("status");
    const delivered = (await tasks.get("parent"))!;
    expect(delivered).toMatchObject({
      status: "done",
      merged: true,
      deliveredCommit: receipt.targetHead,
      artifactPaths: [artifactPath],
    });
    expect(delivered.artifactDeliveryPending).toBeUndefined();
    expect(delivered.artifactDeliveryActivityId).toBeUndefined();
    expect(readFileSync(join(target, artifactPath), "utf8")).toBe(report);
    expect(readFileSync(join(target, "source.txt"), "utf8")).toBe("managed task implementation\n");
    const dependent = await tasks.startTask("dependent");
    expect(dependent.workspaceId).toBeTruthy();
    expect(dependent.workspaceId).not.toBe(reviewed.workspaceId);
    await vi.waitFor(() => expect(providerDirectories).toHaveLength(2), {
      timeout: 60_000,
      interval: 100,
    });
    expect(
      git(dependent.worktreeCwd!, "merge-base", "--is-ancestor", receipt.targetHead, "HEAD"),
    ).toBe("");
    await vi.waitFor(
      async () => expect((await store.session(dependent.sessionId!)).status).toBe("idle"),
      { timeout: 60_000, interval: 100 },
    );
    expect((await tasks.get("dependent"))?.error).toBeUndefined();
    expect(readFileSync(join(dependent.worktreeCwd!, artifactPath), "utf8")).toBe(report);
    expect((await server.managedWorkspaces.get(reviewed.workspaceId!)).state).toBe("merged");
  },
);
