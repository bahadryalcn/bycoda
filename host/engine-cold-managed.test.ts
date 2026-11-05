import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { HostEngine, type ManagedTurnHistoryAdapter } from "./engine";
import type { HostProvider } from "./providers/providers";
import type { HostSession } from "../src/features/connections/model/protocol";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

it("defers cold managed reads and binds only the exact captured session after workspace validation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cold-managed-"));
  const store = new HostStore(join(directory, "host.db"));
  const project = await store.addProject(directory, "Cold");
  for (let i = 0; i < 120; i++)
    await store.save(
      {
        projectId: project.id,
        revision: 1,
        status: "idle",
        updatedAt: i,
        desktop: { updatedAt: 0 },
        session: {
          id: `cold-${i}`,
          cwd: directory,
          worktreeCwd: directory,
          workspaceId: `workspace-${i}`,
          title: "Cold",
          harness: "codex",
          model: "codex:test",
          runtimeMode: "supervised",
          blocks: [],
          providerSessionId: `provider-${i}`,
        },
      } as HostSession,
      {},
    );
  const provider = {
    bind: vi.fn(),
    send: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    approve: vi.fn(),
    answer: vi.fn(),
  } as HostProvider;
  const workspaceForSession = vi.fn(async (value: HostSession) => ({
    workspaceId: value.session.workspaceId!,
    path: value.session.worktreeCwd,
  }));
  const adapter = {
    workspaceForSession,
    exactGitRewindEnabled: () => false,
    assertWritable: vi.fn(),
    history: {},
  } as unknown as ManagedTurnHistoryAdapter;
  const reads = vi.spyOn(store, "session");
  const engine = new HostEngine(store, { codex: provider }, undefined, adapter);
  cleanup.push(async () => {
    await engine.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await engine.ready;
  expect(reads).not.toHaveBeenCalled();
  expect(workspaceForSession).not.toHaveBeenCalled();
  expect(provider.bind).not.toHaveBeenCalled();
  expect(await engine.busyReason("cold-0")).toBeUndefined();
  expect(provider.bind).toHaveBeenCalledWith("cold-0", "provider-0", directory, undefined);
  const replacement = await store.session("cold-1");
  await store.save(
    {
      ...replacement,
      revision: replacement.revision + 1,
      session: { ...replacement.session, providerSessionId: "replacement" },
    },
    {},
  );
  expect(await engine.busyReason("cold-1")).toContain("changed before deferred provider binding");
  expect(vi.mocked(provider.bind).mock.calls.some(([id]) => id === "cold-1")).toBe(false);
  const receipt = await engine.command({
    type: "send",
    commandId: "retry-cold-1",
    sessionId: "cold-1",
    text: "Continue",
  });
  await engine.waitForRun("cold-1", receipt.runId);
  expect(provider.bind).toHaveBeenCalledWith("cold-1", "replacement", directory, undefined);
  expect(provider.send).toHaveBeenCalled();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  workspaceForSession.mockImplementationOnce(async (value) => {
    entered();
    await gate;
    return { workspaceId: value.session.workspaceId!, path: value.session.worktreeCwd };
  });
  const pending = engine.busyReason("cold-2");
  await started;
  const changed = await store.session("cold-2");
  await store.save(
    {
      ...changed,
      revision: changed.revision + 1,
      session: { ...changed.session, providerSessionId: "later-provider" },
    },
    {},
  );
  release();
  expect(await pending).toContain("changed before deferred provider binding");
  expect(vi.mocked(provider.bind).mock.calls.some(([id]) => id === "cold-2")).toBe(false);
  expect(await engine.busyReason("cold-2")).toBeUndefined();
  expect(provider.bind).toHaveBeenCalledWith("cold-2", "later-provider", directory, undefined);
  await store.db.prepare("UPDATE session_state SET revision=revision+1 WHERE id=?").run("cold-3");
  expect(await engine.busyReason("cold-3")).toContain("changed before deferred provider binding");
  expect(vi.mocked(provider.bind).mock.calls.some(([id]) => id === "cold-3")).toBe(false);
  await store.db
    .prepare("UPDATE session_state SET provider_session_id=? WHERE id=?")
    .run("different-provider", "cold-4");
  expect(await engine.busyReason("cold-4")).toContain("changed before deferred provider binding");
  expect(vi.mocked(provider.bind).mock.calls.some(([id]) => id === "cold-4")).toBe(false);
});
