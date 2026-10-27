import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostEngine } from "./engine";
import type { HostProvider } from "./providers";
import { createHostServer } from "./server";
import { HostStore } from "./store";

const cleanups: (() => Promise<void>)[] = [];
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

it("releases a prior Host provider after restart even when its shared session still records running", async () => {
  const root = mkdtempSync(join(tmpdir(), "managed-host-restart-"));
  cleanups.push(async () => {
    if (!root.startsWith(join(tmpdir(), "managed-host-restart-")))
      throw new Error("Unsafe restart fixture cleanup");
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "Restart test");
  git(repo, "config", "user.email", "restart@example.test");
  writeFileSync(join(repo, "source.txt"), "committed baseline\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "baseline");
  const provider: HostProvider = {
    send: vi.fn(async () => {}),
    cancel: async () => {},
    stop: async () => {},
    bind: () => {},
    approve: () => {},
    answer: () => {},
  };
  const open = async () => {
    const store = new HostStore(join(root, "host.db"));
    const engine = new HostEngine(store, { codex: provider });
    let server: Awaited<ReturnType<typeof createHostServer>> | undefined;
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await server?.closeResources();
      await engine.close();
      await store.close();
    };
    cleanups.push(close);
    await engine.ready;
    return {
      store,
      engine,
      close,
      createServer: async () => {
        server = await createHostServer(engine, ["codex"]);
        return server;
      },
    };
  };
  const first = await open();
  const project = await first.store.addProject(repo, "Restart project");
  const firstServer = await first.createServer();
  const runtime = firstServer.managedWorkspaces;
  await runtime.withOwner("owner", (owner) =>
    runtime.policy.update(
      {
        projectId: project.id,
        environmentId: first.store.environmentId,
        expectedRevision: 0,
        idempotencyKey: "restart-policy",
        policy: {
          root: join(root, "worktrees"),
          disk: { minimumFreeBytes: 1, budgetBytes: 1024 ** 3, warningRatio: 0.8 },
        },
      },
      owner,
    ),
  );
  const sessionId = randomUUID();
  const { workspace } = await runtime.registry.prepare({
    projectId: project.id,
    environmentId: first.store.environmentId,
    owner: { kind: "session", id: sessionId },
    idempotencyKey: "restart-workspace",
    slug: "Restart writer",
    choice: { defaultMode: "worktree" },
  });
  await first.engine.command({
    type: "create",
    commandId: "restart-create",
    workspaceId: workspace.id,
    projectId: project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  const current = await first.store.session(sessionId);
  expect(current.desktop).toBeDefined();
  const marker = await runtime.activity.start({
    workspaceId: workspace.id,
    kind: "provider",
    ownerId: sessionId,
  });
  // Simulate durable state at process death. No provider is live or automatically replayed.
  await first.store.save(
    {
      ...current,
      desktop: { updatedAt: 0 },
      status: "running",
      runId: "interrupted-host-run",
      revision: current.revision + 1,
    },
    { type: "restart-fixture" },
  );
  expect((await first.store.startupStates()).find((value) => value.id === sessionId)).toMatchObject(
    { running: true, hasDesktop: true, workspaceId: workspace.id },
  );
  await first.close();

  const reopened = await open();
  expect((await reopened.store.session(sessionId)).status).toBe("running");
  const restartedServer = await reopened.createServer();
  const recovered = await reopened.store.session(sessionId);
  expect(recovered.status).toBe("interrupted");
  expect(recovered.desktop).toBeDefined();
  expect(recovered.session.workspaceId).toBe(workspace.id);
  expect(
    (await restartedServer.managedWorkspaces.activity.list(workspace.id)).map((value) => value.id),
  ).not.toContain(marker.id);
  expect((await reopened.store.workspaceActivityPersistence().load()).activities).toEqual([]);
  await restartedServer.managedWorkspaces.assertWritable(workspace.id);
  const started = await restartedServer.managedWorkspaces.activity.start({
    workspaceId: workspace.id,
    kind: "provider",
    ownerId: sessionId,
  });
  await restartedServer.managedWorkspaces.activity.stop(started.id);
  expect(provider.send).not.toHaveBeenCalled();
}, 180_000);
