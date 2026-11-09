import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";
import { HostEngine, type ManagedTurnHistoryAdapter } from "../engine";
import type { HostSession } from "../../src/features/connections/model/protocol";
import {
  assertShellOwnershipAvailable,
  hasShellPhysicalOwner,
  reserveShellOwnership,
} from "./shell-ownership";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const run of cleanup.splice(0).reverse()) await run();
});
async function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "shell-ownership-"));
  const database = join(cwd, "host.db");
  const store = new HostStore(database);
  await store.ready;
  cleanup.push(async () => {
    await store.close();
    rmSync(cwd, { recursive: true, force: true });
  });
  return { cwd, database, store };
}
it("retains exact original operation and PID evidence after failed termination and rejects replacement", async () => {
  const { store, cwd } = await fixture();
  const original = await reserveShellOwnership(
    store,
    cwd,
    "task",
    "task-one",
    "long command",
    "activity-one",
  );
  await original.observe({ pid: 42, hostPid: 84, spawnObservedAt: 123, helperPid: 43 });
  await original.unknown("taskkill failed");
  await expect(original.complete()).rejects.toThrow("remains unverified");
  await expect(reserveShellOwnership(store, cwd, "task", "task-two", "retry")).rejects.toThrow(
    original.id,
  );
  expect(await hasShellPhysicalOwner(store, "task", "task-one")).toBe(true);
  const rows = await store.db
    .prepare("SELECT value FROM metadata WHERE key=?")
    .all(`shell-physical-owner.v1:${original.id}`);
  expect(JSON.parse(String(rows[0].value))).toMatchObject({
    id: original.id,
    ownerId: "task-one",
    command: "long command",
    workspaceActivityId: "activity-one",
    physicalIdentity: { pid: 42, helperPid: 43, spawnObservedAt: 123 },
    failure: "taskkill failed",
  });
});
it("restart treats an unacknowledged original owner as unknown instead of retiring it", async () => {
  const { store, cwd } = await fixture();
  const original = await reserveShellOwnership(store, cwd, "session", "session-one", "command");
  await original.observe({ pid: 42, hostPid: 84, spawnObservedAt: 123 });
  vi.resetModules();
  const restarted = await import("./shell-ownership");
  await expect(restarted.assertShellOwnershipAvailable(store, cwd)).rejects.toThrow(original.id);
  expect(await restarted.hasShellPhysicalOwner(store, "session", "session-one")).toBe(true);
});
it("verified completion releases only its original receipt", async () => {
  const { store, cwd } = await fixture();
  const original = await reserveShellOwnership(store, cwd, "task", "task-one", "command");
  await original.complete();
  expect(await hasShellPhysicalOwner(store, "task", "task-one")).toBe(false);
  await expect(assertShellOwnershipAvailable(store, cwd)).resolves.toBeUndefined();
});
it("missing session rows cannot retire their original physical activity and unrelated owners remain independent", async () => {
  const { store, cwd } = await fixture();
  const original = await reserveShellOwnership(
    store,
    cwd,
    "session",
    "deleted-session",
    "original command",
  );
  await original.unknown("taskkill failed");
  expect(
    await store.db.prepare("SELECT id FROM sessions WHERE id=?").get("deleted-session"),
  ).toBeUndefined();
  expect(await hasShellPhysicalOwner(store, "session", "deleted-session")).toBe(true);
  expect(await hasShellPhysicalOwner(store, "session", "unrelated-session")).toBe(false);
  await expect(
    assertShellOwnershipAvailable(store, join(cwd, "unrelated-workspace")),
  ).resolves.toBeUndefined();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function engineFixture() {
  const { store, cwd } = await fixture();
  const engine = new HostEngine(store, {
    codex: {
      send: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      bind: vi.fn(),
      approve: vi.fn(),
      answer: vi.fn(),
    },
  });
  cleanup.push(() => engine.close());
  await engine.ready;
  const project = await store.addProject(cwd, "Fixture");
  const receipt = await engine.command({
    type: "create",
    commandId: "create",
    projectId: project.id,
    workspaceMode: "current",
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  const value = await store.session(receipt.sessionId);
  const admit = (adapter: ManagedTurnHistoryAdapter) => {
    engine.setManagedTurnHistoryAdapter(adapter);
    return (
      engine as unknown as {
        executionActivity(value: HostSession, kind: "provider"): Promise<unknown>;
      }
    ).executionActivity(value, "provider");
  };
  return { store, cwd, admit };
}
it.each([false, true])(
  "rechecks an authoritative workspace owner after delayed resolution (rewind %s)",
  async (rewind) => {
    const { store, cwd, admit } = await engineFixture();
    const entered = deferred<void>();
    const workspace = deferred<{ workspaceId: string; path: string }>();
    const startActivity = vi.fn(async () => async () => {});
    const pending = admit({
      exactGitRewindEnabled: () => rewind,
      workspaceForSession: () => {
        entered.resolve();
        return workspace.promise;
      },
      assertWritable: vi.fn(async () => {}),
      startActivity,
      history: { begin: vi.fn(), end: vi.fn(), get: vi.fn(), list: vi.fn() },
    });
    await entered.promise;
    const actualCwd = join(cwd, "authoritative-worktree");
    const original = await reserveShellOwnership(store, actualCwd, "task", "original", "command");
    await original.unknown("taskkill failed");
    const rejected = expect(pending).rejects.toThrow(original.id);
    workspace.resolve({ workspaceId: "managed", path: actualCwd });
    await rejected;
    expect(startActivity).not.toHaveBeenCalled();
    expect(await hasShellPhysicalOwner(store, "task", "original")).toBe(true);
  },
);
it("rechecks physical ownership after the final rewind-preference wait", async () => {
  const { store, cwd, admit } = await engineFixture();
  const entered = deferred<void>();
  const preference = deferred<boolean>();
  const actualCwd = join(cwd, "authoritative-worktree");
  let reads = 0;
  const startActivity = vi.fn(async () => async () => {});
  const pending = admit({
    exactGitRewindEnabled: () => {
      if (++reads === 1) return false;
      entered.resolve();
      return preference.promise;
    },
    workspaceForSession: async () => ({ workspaceId: "managed", path: actualCwd }),
    assertWritable: vi.fn(async () => {}),
    startActivity,
    history: { begin: vi.fn(), end: vi.fn(), get: vi.fn(), list: vi.fn() },
  });
  await entered.promise;
  const original = await reserveShellOwnership(store, actualCwd, "task", "original", "command");
  await original.unknown("taskkill failed");
  const rejected = expect(pending).rejects.toThrow(original.id);
  preference.resolve(false);
  await rejected;
  expect(startActivity).not.toHaveBeenCalled();
  expect(await hasShellPhysicalOwner(store, "task", "original")).toBe(true);
});
