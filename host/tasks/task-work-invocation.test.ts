import { afterEach, expect, it, vi } from "vitest";
import { cleanups, setup } from "../engine-support/engine.test-support";
import { HostTasks } from "./service";
import { reserveShellOwnership } from "../execution/shell-ownership";
import { TaskPayloadSchema } from "../../src/shared/model/host-contracts/tasks";
import * as sessionRuns from "../sessions/sessionRuns";
import { move } from "./task-actions";
import type { TaskContext } from "./context";

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const f = await setup();
  const tasks = new HostTasks(f.store, f.engine);
  await tasks.ready;
  const input = (overrides: Record<string, unknown> = {}) => ({
    id: "main",
    projectId: f.project.id,
    title: "Report",
    prompt: "Write report",
    harness: "codex",
    model: "codex:test",
    modelSettings: {},
    runtimeMode: "supervised",
    maxRunMinutes: 0,
    isolate: false,
    review: false,
    ...overrides,
  });
  const task = async () => (await tasks.get("main"))!;
  return { ...f, tasks, input, task };
}

it("projects a shared Work wait without turning capacity into a task error", async () => {
  const f = await fixture();
  await f.tasks.save(f.input());
  const launch = vi.spyOn(sessionRuns, "launchSessionRun").mockResolvedValue({
    sessionId: "",
    deferred: true,
    wait: { code: "capacity", message: "Waiting for the shared model slot." },
  });
  try {
    await f.tasks.startTask("main");
    await f.tasks.tick();
    await f.tasks.idle();
    const waiting = await f.task();
    expect(waiting.status).toBe("queued");
    expect(waiting.modelRoutingWait?.reason).toBe("Waiting for the shared model slot.");
    expect(waiting.error).toBeUndefined();
    expect(waiting.prompt).toBe("Write report");
  } finally {
    launch.mockRestore();
  }
});

it("rotates Host-owned Work invocation only for owner configuration edits", async () => {
  const f = await fixture();
  const first = await f.tasks.save(f.input({ workInvocationId: "owner-forged" }));
  expect(first.workInvocationId).toBeTruthy();
  expect(first.workInvocationId).not.toBe("owner-forged");
  const payload = TaskPayloadSchema.parse({ ...first, expectedConfiguration: first });
  expect(payload.workInvocationId).toBe(first.workInvocationId);
  expect((await f.tasks.save(payload)).workInvocationId).toBe(first.workInvocationId);
  // Prompt edits deliberately wait for owner restart. Change a configuration
  // field that remains schedulable so this test reaches real provider admission.
  const changed = await f.tasks.save(
    f.input({ title: "Revised report", workInvocationId: "forged-again" }),
  );
  expect(changed).toMatchObject({
    status: "queued",
    title: "Revised report",
    prompt: first.prompt,
  });
  expect(changed.awaitingOwnerRestart).toBeUndefined();
  expect(changed.workInvocationId).not.toBe(first.workInvocationId);
  expect(changed.workInvocationId).not.toBe("forged-again");
  await f.tasks.tick();
  await f.waitForTurnStart();
  await f.tasks.tick();
  expect((await f.task()).workInvocationId).toBe(changed.workInvocationId);
  expect(f.turns).toHaveLength(1);
});

it("refuses a new owner invocation while exact Work retirement is unknown", async () => {
  const f = await fixture();
  await f.tasks.save(f.input());
  await f.tasks.tick();
  await f.waitForTurnStart();
  const first = await f.task();
  await f.tasks.move(first.id, "blocked");
  await f.engine.waitForRun(first.sessionId!, first.runId);
  const retirement = vi
    .spyOn(f.engine, "waitForRun")
    .mockRejectedValue(new Error("Retirement unknown"));
  try {
    await expect(f.tasks.save(f.input({ prompt: "New owner instructions" }))).rejects.toThrow(
      "not proven stopped",
    );
    await expect(f.tasks.move(first.id, "queued")).rejects.toThrow("not proven stopped");
    expect((await f.task()).workInvocationId).toBe(first.workInvocationId);
    expect((await f.task()).sessionId).toBe(first.sessionId);
  } finally {
    retirement.mockRestore();
  }
});

it("keeps the original failed verification owner fenced across retry and board restart", async () => {
  const f = await fixture();
  await f.tasks.save(f.input());
  const task = await f.task();
  await f.store.db
    .prepare("UPDATE tasks SET value=json_set(value,'$.status','blocked') WHERE id=?")
    .run(task.id);
  const original = await reserveShellOwnership(
    f.store,
    f.project.cwd,
    "task",
    task.id,
    "original verification",
  );
  await original.observe({ pid: 42, hostPid: 84, spawnObservedAt: 123 });
  await original.unknown("taskkill failed");
  await expect(f.tasks.move(task.id, "queued")).rejects.toThrow("not proven stopped");
  await expect(f.tasks.startTask(task.id)).rejects.toThrow("not proven stopped");
  const restarted = new HostTasks(f.store, f.engine);
  await restarted.ready;
  await expect(restarted.startTask(task.id)).rejects.toThrow("not proven stopped");
  await expect(restarted.move(task.id, "queued")).rejects.toThrow("not proven stopped");
  await expect(restarted.delete(task.id, true)).rejects.toThrow("not proven stopped");
  const row = await f.store.db
    .prepare("SELECT value FROM metadata WHERE key=?")
    .get(`shell-physical-owner.v1:${original.id}`);
  expect(JSON.parse(String(row!.value))).toMatchObject({
    id: original.id,
    command: "original verification",
    physicalIdentity: { pid: 42 },
  });
});

it("clears stale parent recovery only when owner configuration creates a new invocation", async () => {
  const f = await fixture();
  const initial = await f.tasks.save(f.input());
  const stale = {
    ...initial,
    status: "blocked",
    repairAttempts: 1,
    conflictRecovery: {
      childId: "old-child",
      sourceHead: "source",
      targetHead: "target",
      targetDirectory: "target-path",
      targetBranch: "main",
    },
    crewWorkWait: { reason: "capacity", unstarted: true },
    repairAdvisor: {
      requestId: "old-advice",
      sessionId: "old-session",
      findings: "conflict",
      feedback: "conflict",
      error: "conflict",
      fingerprint: "old",
    },
  };
  await f.store.db
    .prepare("UPDATE tasks SET value=? WHERE id=?")
    .run(JSON.stringify(stale), initial.id);
  const changed = await f.tasks.save(f.input({ title: "New owner request" }));
  expect(changed.workInvocationId).not.toBe(initial.workInvocationId);
  expect(changed.conflictRecovery).toBeUndefined();
  expect(changed.crewWorkWait).toBeUndefined();
  expect(changed.repairAdvisor).toBeUndefined();
  expect(changed.repairAttempts).toBe(1);
});

it("releases a cancelled conflict child binding only on an explicit owner retry", async () => {
  const f = await fixture();
  const initial = await f.tasks.save(f.input({ id: "child" }));
  const stale = {
    ...initial,
    status: "blocked",
    conflictParent: {
      id: "old-parent",
      createdAt: 7,
      workInvocationId: "old-parent-run",
      sourceHead: "source",
      targetHead: "target",
      targetDirectory: "target-path",
      targetBranch: "main",
    },
  };
  await f.store.db
    .prepare("UPDATE tasks SET value=? WHERE id=?")
    .run(JSON.stringify(stale), initial.id);
  expect((await f.tasks.get(initial.id))?.conflictParent).toEqual(stale.conflictParent);
  const retried = await f.tasks.move(initial.id, "queued");
  expect(retried.workInvocationId).not.toBe(initial.workInvocationId);
  expect(retried.conflictParent).toBeUndefined();
  expect(retried.status).toBe("queued");
});

it("does not abort a later owner controller for a stale guarded Stop", async () => {
  const controller = new AbortController();
  const context = {
    ready: Promise.resolve(),
    delivering: new Set(),
    automaticDeliveryControllers: new Map([["child", controller]]),
    jobControllers: new Map(),
    transaction: async (work: () => Promise<unknown>) => work(),
    find: async () => ({ id: "child", status: "running", createdAt: 1, workInvocationId: "later" }),
    store: { db: { prepare: () => ({ get: async () => ({ generation: 8 }) }) } },
  } as unknown as TaskContext;
  await expect(move(context, "child", "blocked", undefined, 7)).rejects.toThrow("Task changed");
  expect(controller.signal.aborted).toBe(false);
});

it("fences an explicit owner Stop before asynchronous readiness", async () => {
  const controller = new AbortController();
  const ready = Promise.withResolvers<void>();
  const context = {
    ready: ready.promise,
    delivering: new Set(),
    automaticDeliveryControllers: new Map([["explicit-stop-fence-test", controller]]),
    transaction: async () => {
      throw new Error("fixture stop");
    },
  } as unknown as TaskContext;
  const stopping = move(context, "explicit-stop-fence-test", "blocked");
  expect(controller.signal.aborted).toBe(true);
  ready.resolve();
  await expect(stopping).rejects.toThrow("fixture stop");
});
