import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostEngine } from "./engine";
import { createManagedWorkspaceRuntime } from "./managed-workspace-runtime";
import type { HostProvider } from "./providers";
import { HostStore } from "./store";
import { rewindRef } from "./turn-git-history";
import type { ManagedWorkspace } from "./workspace-contracts";

// This transaction crosses real Git/index, HostStore and transcript persistence.
vi.setConfig({ testTimeout: 300_000, hookTimeout: 60_000 });
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

it("runs isolated host sessions through commits, rewind/Undo, owner delivery and junction-safe retirement", async () => {
  const root = mkdtempSync(join(tmpdir(), "bycoda-managed-e2e-"));
  const target = join(root, "repo");
  const worktrees = join(root, "worktrees");
  mkdirSync(target);
  git(target, "init", "-q", "-b", "main");
  git(target, "config", "user.name", "Managed E2E");
  git(target, "config", "user.email", "managed-e2e@example.test");
  git(target, "config", "commit.gpgsign", "false");
  git(target, "config", "core.autocrlf", "false");
  writeFileSync(join(target, ".gitignore"), "/node_modules\n/temp/\n");
  writeFileSync(join(target, "first.txt"), "base first\n");
  writeFileSync(join(target, "second.txt"), "base second\n");
  writeFileSync(join(target, "owner.txt"), "owner base\n");
  git(target, "add", ".");
  git(target, "commit", "-qm", "committed base");
  const base = git(target, "rev-parse", "HEAD");
  const store = new HostStore(join(root, "host.db"));
  await store.ready;
  let engine: HostEngine | undefined;
  cleanups.push(async () => {
    await engine?.close();
    await store.close();
    // Every filesystem target is a fresh child of this test's OS temp directory.
    if (!root.startsWith(join(tmpdir(), "bycoda-managed-e2e-")))
      throw new Error("Unsafe integration fixture cleanup");
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const project = await store.addProject(target, "Managed integration");
  const providerDirectories: string[] = [];
  const provider: HostProvider = {
    async send(input) {
      providerDirectories.push(input.cwd);
      const [file, text] = input.text.split(":");
      if (!["first.txt", "second.txt"].includes(file))
        throw new Error("Unexpected fake-provider write request");
      writeFileSync(join(input.cwd, file), `${text}\n`);
      git(input.cwd, "add", "--", file);
      git(input.cwd, "commit", "-qm", `Fake provider: ${text}`);
    },
    cancel: async () => {},
    stop: async () => {},
    bind: () => {},
    approve: () => {},
    answer: () => {},
  };
  engine = new HostEngine(store, { codex: provider });
  await engine.ready;
  const runtime = createManagedWorkspaceRuntime(store, engine);
  expect(await runtime.recover()).toEqual([]);
  const { registry, history, rewind, delivery, retention } = runtime;
  const required = runtime.get;
  await runtime.withOwner("owner", (owner) =>
    runtime.policy.update(
      {
        projectId: project.id,
        environmentId: store.environmentId,
        expectedRevision: 0,
        idempotencyKey: "test-policy",
        policy: {
          root: worktrees,
          disk: { budgetBytes: 1024 ** 3, warningRatio: 0.8, minimumFreeBytes: 1 },
        },
      },
      owner,
    ),
  );
  const createSession = async (slug: string) => {
    const sessionId = randomUUID();
    const prepared = await registry.prepare({
      projectId: project.id,
      environmentId: store.environmentId,
      owner: { kind: "session", id: sessionId },
      slug,
      idempotencyKey: `prepare-${sessionId}`,
    });
    const receipt = await engine!.command({
      type: "create",
      commandId: `create-${sessionId}`,
      workspaceId: prepared.workspace.id,
      projectId: project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    expect(receipt.sessionId).toBe(sessionId);
    expect((await store.session(sessionId)).session.workspaceId).toBe(prepared.workspace.id);
    expect(prepared.workspace.baseCommit).toBe(base);
    return prepared.workspace;
  };
  const first = await createSession("First writer");
  const second = await createSession("Second writer");
  expect(first.path).not.toBe(second.path);
  expect(first.branchRef).not.toBe(second.branchRef);
  const send = async (workspace: ManagedWorkspace, commandId: string, text: string) => {
    await engine!.command({
      type: "send",
      commandId,
      sessionId: workspace.owner.id,
      text,
    });
    await vi.waitFor(
      async () => {
        expect((await store.session(workspace.owner.id)).status).toBe("idle");
        expect((await history.get(workspace.id, commandId))?.after?.status).toBe("complete");
      },
      { timeout: 60_000, interval: 100 },
    );
  };
  await send(first, "first-turn", "first.txt:first committed change");
  await send(second, "sibling-turn", "second.txt:independent sibling change");
  await send(first, "later-turn", "first.txt:later committed change");
  const firstHead = git(first.path, "rev-parse", "HEAD");
  const siblingHead = git(second.path, "rev-parse", "HEAD");
  expect(git(first.path, "rev-list", "--count", `${base}..HEAD`)).toBe("2");
  expect(git(second.path, "rev-list", "--count", `${base}..HEAD`)).toBe("1");
  expect(readFileSync(join(second.path, "first.txt"), "utf8")).toBe("base first\n");
  expect(providerDirectories).toEqual([first.path, second.path, first.path]);
  const transcript = await store.session(first.owner.id);
  const plan = await rewind.plan({
    workspaceId: first.id,
    sessionId: first.owner.id,
    expectedRevision: (await required(first.id)).revision,
    expectedConversationRevision: transcript.revision,
    direction: "rewind",
    userBlockId: "first-turn",
  });
  const receipt = await rewind.apply({
    workspaceId: first.id,
    sessionId: first.owner.id,
    expectedRevision: plan.expectedRevision,
    expectedConversationRevision: transcript.revision,
    planToken: plan.token,
    idempotencyKey: "rewind-both-commits",
  });
  expect(git(first.path, "rev-parse", "HEAD")).toBe(base);
  expect((await store.session(first.owner.id)).session.blocks).toEqual([]);
  expect(git(second.path, "rev-parse", "HEAD")).toBe(siblingHead);
  const undoPlan = await rewind.plan({
    workspaceId: first.id,
    sessionId: first.owner.id,
    expectedRevision: (await required(first.id)).revision,
    expectedConversationRevision: receipt.conversationRevision,
    direction: "undo",
    operationId: receipt.operationId,
  });
  await rewind.undo({
    workspaceId: first.id,
    sessionId: first.owner.id,
    expectedRevision: undoPlan.expectedRevision,
    expectedConversationRevision: receipt.conversationRevision,
    planToken: undoPlan.token,
    idempotencyKey: "undo-both-commits",
  });
  expect(git(first.path, "rev-parse", "HEAD")).toBe(firstHead);
  expect((await store.session(first.owner.id)).session.blocks.map((block) => block.id)).toEqual(
    transcript.session.blocks.map((block) => block.id),
  );
  const finished = await registry.finish({
    workspaceId: first.id,
    expectedRevision: (await required(first.id)).revision,
    idempotencyKey: "finish-before-review",
  });
  writeFileSync(join(target, "first.txt"), "overlapping owner draft\n");
  const overlap = await delivery.review({
    workspaceId: first.id,
    expectedRevision: finished.revision,
    action: "merge",
  });
  expect(overlap.blockers.join(" ")).toMatch(/overlap/i);
  await expect(
    runtime.withOwner("owner", (owner) =>
      delivery.merge(
        {
          workspaceId: first.id,
          expectedRevision: finished.revision,
          planToken: overlap.token,
          idempotencyKey: "overlap-rejected",
        },
        owner,
      ),
    ),
  ).rejects.toThrow();
  expect(readFileSync(join(target, "first.txt"), "utf8")).toBe("overlapping owner draft\n");
  writeFileSync(join(target, "first.txt"), "base first\n");
  writeFileSync(join(target, "owner.txt"), "unrelated owner draft preserved\n");
  const ownerStatus = git(target, "status", "--porcelain=v1");
  const reviewed = await delivery.review({
    workspaceId: first.id,
    expectedRevision: (await required(first.id)).revision,
    action: "merge",
  });
  expect(reviewed.blockers).toEqual([]);
  const merged = await runtime.withOwner("owner", (owner) =>
    delivery.merge(
      {
        workspaceId: first.id,
        expectedRevision: reviewed.expectedRevision,
        planToken: reviewed.token,
        idempotencyKey: "owner-approved-merge",
      },
      owner,
    ),
  );
  expect(merged.sourceHead).toBe(firstHead);
  expect((await required(first.id)).state).toBe("merged");
  expect(git(target, "status", "--porcelain=v1")).toBe(ownerStatus);
  expect(readFileSync(join(target, "owner.txt"), "utf8")).toBe("unrelated owner draft preserved\n");
  expect(readFileSync(join(target, "first.txt"), "utf8")).toBe("later committed change\n");
  const sentinel = join(root, "shared-dependencies");
  mkdirSync(sentinel);
  writeFileSync(join(sentinel, "sentinel.txt"), "dependency target survives\n");
  symlinkSync(
    sentinel,
    join(first.path, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const removed = await runtime.withOwner("owner", (owner) =>
    retention.quickDelete(first.id, owner),
  );
  expect(removed.directoryState).toBe("removed");
  expect(existsSync(first.path)).toBe(false);
  expect((await required(first.id)).directoryState).toBe("removed");
  expect(readFileSync(join(sentinel, "sentinel.txt"), "utf8")).toBe("dependency target survives\n");
  expect(git(target, "rev-parse", first.branchRef)).toBe(firstHead);
  expect(git(target, "rev-parse", rewindRef(receipt.operationId, "rescue-head"))).toBe(firstHead);
  expect(git(second.path, "rev-parse", "HEAD")).toBe(siblingHead);
  expect(readFileSync(join(target, "owner.txt"), "utf8")).toBe("unrelated owner draft preserved\n");
  expect((await registry.getOperation(receipt.operationId))?.phase).toBe("complete");
});
