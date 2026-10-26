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
import { HostEngine } from "./engine";
import { createManagedWorkspaceRuntime } from "./managed-workspace-runtime";
import { HostStore } from "./store";

vi.setConfig({ testTimeout: 120_000 });
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    windowsHide: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

it("delivers a worker seeded from a nondefault lead prerequisite only to its owner-approved lead target", async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "managed-crew-target-")));
  const integration = join(root, "integration");
  const lead = join(root, "lead");
  mkdirSync(integration);
  git(integration, "init", "-q", "-b", "main");
  git(integration, "config", "user.name", "Crew target regression");
  git(integration, "config", "user.email", "crew-target@example.invalid");
  git(integration, "config", "commit.gpgsign", "false");
  git(integration, "config", "core.autocrlf", "false");
  writeFileSync(join(integration, "base.txt"), "integration base\n");
  git(integration, "add", ".");
  git(integration, "commit", "-qm", "integration baseline");
  const integrationHead = git(integration, "rev-parse", "HEAD");
  git(integration, "worktree", "add", "-q", "-b", "feature/selected-lead", lead, "HEAD");
  writeFileSync(join(lead, "prerequisite.txt"), "required lead capability\n");
  git(lead, "add", ".");
  git(lead, "commit", "-qm", "selected lead prerequisite absent from integration");
  const baseCommit = git(lead, "rev-parse", "HEAD");
  const source = { directory: lead, branchRef: "refs/heads/feature/selected-lead", baseCommit };
  const store = new HostStore(join(root, "host.db"));
  await store.ready;
  const engine = new HostEngine(store, {});
  await engine.ready;
  const runtime = createManagedWorkspaceRuntime(store, engine);
  cleanups.push(async () => {
    runtime.retention.stop();
    await engine.close();
    await store.close();
    if (!root.startsWith(realpathSync.native(tmpdir()))) throw new Error("Unsafe fixture cleanup");
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const project = await store.addProject(integration, "Crew regression");
  await runtime.recover();
  await runtime.withOwner("owner", (owner) =>
    runtime.policy.update(
      {
        projectId: project.id,
        environmentId: store.environmentId,
        expectedRevision: 0,
        idempotencyKey: "policy",
        policy: {
          root: join(root, "workers"),
          disk: { minimumFreeBytes: 1, budgetBytes: 1024 ** 3, warningRatio: 0.8 },
        },
      },
      owner,
    ),
  );
  const { workspace } = await runtime.registry.prepare({
    projectId: project.id,
    environmentId: store.environmentId,
    owner: { kind: "session", id: "worker" },
    slug: "Use the selected prerequisite",
    idempotencyKey: "worker",
    source,
  });
  expect(workspace).toMatchObject({
    baseCommit,
    baseRef: source.branchRef,
    targetBranchRef: source.branchRef,
    targetDirectory: lead,
  });
  expect(git(workspace.path, "rev-parse", "HEAD")).toBe(baseCommit);
  expect(readFileSync(join(workspace.path, "prerequisite.txt"), "utf8")).toBe(
    "required lead capability\n",
  );
  expect(existsSync(join(integration, "prerequisite.txt"))).toBe(false);
  writeFileSync(join(workspace.path, "result.txt"), "worker used lead capability\n");
  git(workspace.path, "add", ".");
  git(workspace.path, "commit", "-qm", "worker implements against lead prerequisite");
  const sourceHead = git(workspace.path, "rev-parse", "HEAD");
  const finished = await runtime.registry.finish({
    workspaceId: workspace.id,
    expectedRevision: workspace.revision,
    idempotencyKey: "finish",
  });
  const review = await runtime.delivery.review({
    workspaceId: workspace.id,
    expectedRevision: finished.revision,
    action: "merge",
  });
  expect(review.blockers).toEqual([]);
  expect(review.targetBranchRef).toBe(source.branchRef);
  expect(review.targetDirectory).toBe(lead);
  const request = {
    workspaceId: workspace.id,
    expectedRevision: finished.revision,
    idempotencyKey: "approved-merge",
    planToken: review.token,
  };
  await expect(
    runtime.delivery.merge(request, { ownerId: "owner", authorizationId: "fabricated" }),
  ).rejects.toThrow("owner approval");
  expect(git(lead, "rev-parse", "HEAD")).toBe(baseCommit);
  const receipt = await runtime.withOwner("owner", (owner) =>
    runtime.delivery.merge(request, owner),
  );
  expect(receipt.sourceHead).toBe(sourceHead);
  expect(git(lead, "rev-parse", "HEAD")).toBe(receipt.targetHead);
  expect(readFileSync(join(lead, "result.txt"), "utf8")).toBe("worker used lead capability\n");
  expect(git(lead, "merge-base", "--is-ancestor", sourceHead, "HEAD")).toBe("");
  expect(git(integration, "rev-parse", "HEAD")).toBe(integrationHead);
  expect(existsSync(join(integration, "result.txt"))).toBe(false);
  const delivered = await runtime.get(workspace.id);
  expect(delivered.state).toBe("merged");
  expect(delivered.targetBranchRef).toBe(source.branchRef);
  expect(delivered.targetDirectory).toBe(lead);
  const fresh = await runtime.delivery.review({
    workspaceId: workspace.id,
    expectedRevision: delivered.revision,
    action: "merge",
  });
  expect(fresh.commits).toEqual([]);
  expect(fresh.blockers).toEqual([]);
});
