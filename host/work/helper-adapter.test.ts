import { afterEach, expect, it, vi } from "vitest";
import { cleanups, setup } from "../engine-support/engine.test-support";
import { HostLimits } from "../limits";
import { bindSessionWork } from "./session-adapter";
import { runAssistantHelper } from "./helper-adapter";
import type { ProviderRetirementObserver } from "../../src/integrations/harness/core/providerRetirement";
import type { WorkTarget } from "../../src/shared/model/host-contracts/work";

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const target: WorkTarget = {
  model: { harness: "codex", model: "codex:test", modelSettings: {} },
  runtimeMode: "supervised",
  permissionRevision: "owner-operation",
  execution: { kind: "helper", helperId: "chief" },
};
const input = { role: "chief", operationId: "owner-operation", prompt: "Read facts", target };

it("settles one exact isolated helper receipt in the shared queue and reuses its durable result", async () => {
  const { store, engine } = await setup();
  const runtime = bindSessionWork(store, engine);
  const run = vi.fn(async (_signal?: AbortSignal, retirement?: ProviderRetirementObserver) => {
    await retirement?.onRetired?.({
      original: retirement.retirementIdentity!,
      cleanupSuccess: true,
    });
    return { text: "Done", tokens: 45 };
  });
  expect(await runAssistantHelper(store, input, run)).toEqual({ text: "Done", tokens: 45 });
  expect(await runAssistantHelper(store, input, run)).toEqual({ text: "Done", tokens: 45 });
  expect(run).toHaveBeenCalledOnce();
  const record = (await runtime.work.list())[0]!;
  expect(record).toMatchObject({
    state: "completed",
    reserved: false,
    target: { execution: { kind: "helper" } },
    receipt: { sessionId: expect.stringMatching(/^assistant-helper:/) },
  });
  const row = await store.db.prepare("SELECT value FROM task_run_budget_ledger").get();
  expect(JSON.parse(String(row!.value))).toMatchObject({
    workId: record.id,
    tokens: 45,
    receiptKind: "helper",
    costUsd: null,
    settledAt: expect.any(Number),
  });
});

it("retains ambiguous helper dispatch and never invokes its provider again", async () => {
  const { store, engine } = await setup();
  const runtime = bindSessionWork(store, engine);
  const run = vi.fn(async () => {
    throw new Error("provider disconnected");
  });
  await expect(runAssistantHelper(store, input, run)).rejects.toThrow("provider disconnected");
  await expect(runAssistantHelper(store, input, run)).rejects.toThrow("unknown");
  expect(run).toHaveBeenCalledOnce();
  expect((await runtime.work.list())[0]).toMatchObject({ state: "unknown", reserved: true });
});

it("honors shared capacity before invoking a helper provider", async () => {
  const { store, engine } = await setup();
  const limits = new HostLimits(store);
  await limits.save({ ...(await limits.settings()), maxRunningTasks: 1 });
  const runtime = bindSessionWork(store, engine, limits);
  const occupied = await runtime.work.submit({
    source: { kind: "automation", id: "other", occurrence: "one" },
    payload: {},
  });
  await store.db
    .prepare("UPDATE work_queue SET value=? WHERE id=?")
    .run(JSON.stringify({ ...occupied, reserved: true, dispatchStarted: true }), occupied.id);
  const run = vi.fn(async (_signal?: AbortSignal, retirement?: ProviderRetirementObserver) => {
    await retirement?.onRetired?.({
      original: retirement.retirementIdentity!,
      cleanupSuccess: true,
    });
    return { text: "Admitted later" };
  });
  const result = runAssistantHelper(store, input, run);
  await vi.waitFor(async () => {
    expect(
      (await runtime.work.list()).find((record) => record.source.kind === "assistant"),
    ).toMatchObject({ state: "waiting", reserved: false, wait: { code: "capacity" } });
  });
  expect(run).not.toHaveBeenCalled();
  await store.db.prepare("UPDATE work_queue SET value=? WHERE id=?").run(
    JSON.stringify({
      ...occupied,
      state: "completed",
      reserved: false,
      outcome: { status: "cancelled" },
    }),
    occupied.id,
  );
  await runtime.work.tick();
  expect(await result).toEqual({ text: "Admitted later" });
  expect(run).toHaveBeenCalledOnce();
});

it("cancels a queued helper before capacity returns and never sends it", async () => {
  const { store, engine } = await setup();
  const limits = new HostLimits(store);
  await limits.save({ ...(await limits.settings()), maxRunningTasks: 1 });
  const runtime = bindSessionWork(store, engine, limits);
  const occupied = await runtime.work.submit({
    source: { kind: "automation", id: "other", occurrence: "one" },
    payload: {},
  });
  await store.db
    .prepare("UPDATE work_queue SET value=? WHERE id=?")
    .run(JSON.stringify({ ...occupied, reserved: true, dispatchStarted: true }), occupied.id);
  const controller = new AbortController();
  const run = vi.fn(async () => ({ text: "Must not run" }));
  const result = runAssistantHelper(store, { ...input, signal: controller.signal }, run);
  const rejection = expect(result).rejects.toThrow("cancelled");
  await vi.waitFor(async () => {
    expect(
      (await runtime.work.list()).find((record) => record.source.kind === "assistant"),
    ).toMatchObject({ state: "waiting", wait: { code: "capacity" } });
  });
  controller.abort();
  await rejection;
  await store.db.prepare("UPDATE work_queue SET value=? WHERE id=?").run(
    JSON.stringify({
      ...occupied,
      state: "completed",
      reserved: false,
      outcome: { status: "cancelled" },
    }),
    occupied.id,
  );
  await runtime.work.tick();
  expect(run).not.toHaveBeenCalled();
});

it("keeps aborted dispatch reserved until its exact original physical retirement, then never replays", async () => {
  const { store, engine } = await setup();
  const runtime = bindSessionWork(store, engine);
  const controller = new AbortController();
  let observer: ProviderRetirementObserver | undefined;
  let fail!: (error: Error) => void;
  const run = vi.fn((_signal?: AbortSignal, retirement?: ProviderRetirementObserver) => {
    observer = retirement;
    return new Promise<{ text: string }>((_resolve, reject) => {
      fail = reject;
    });
  });
  const result = runAssistantHelper(store, { ...input, signal: controller.signal }, run);
  const rejection = expect(result).rejects.toThrow("cancelled");
  await vi.waitFor(() => expect(observer).toBeDefined());
  controller.abort();
  await rejection;
  fail(new Error("provider cancelled"));
  await runtime.work.reconcile();
  expect((await runtime.work.list())[0]).toMatchObject({ reserved: true });
  await observer!.onRetired!({ original: Symbol("different invocation"), cleanupSuccess: true });
  expect((await runtime.work.list())[0]).toMatchObject({ reserved: true });
  await observer!.onRetired!({ original: observer!.retirementIdentity!, cleanupSuccess: true });
  await vi.waitFor(async () =>
    expect((await runtime.work.list())[0]).toMatchObject({
      state: "completed",
      reserved: false,
      outcome: { status: "cancelled" },
    }),
  );
  await expect(runAssistantHelper(store, input, run)).rejects.toThrow("provider cancelled");
  expect(run).toHaveBeenCalledOnce();
});

it("settles failed domain work only after successful cleanup, retaining cleanup failures", async () => {
  for (const cleanupSuccess of [true, false]) {
    const { store, engine } = await setup();
    const runtime = bindSessionWork(store, engine);
    const run = vi.fn(async (_signal?: AbortSignal, retirement?: ProviderRetirementObserver) => {
      await retirement!.onRetired!({ original: retirement!.retirementIdentity!, cleanupSuccess });
      throw new Error("domain failure");
    });
    await expect(runAssistantHelper(store, input, run)).rejects.toThrow("domain failure");
    await runtime.work.reconcile();
    expect((await runtime.work.list())[0]).toMatchObject(
      cleanupSuccess
        ? { state: "completed", reserved: false, outcome: { status: "failed" } }
        : { state: "unknown", reserved: true },
    );
    await expect(runAssistantHelper(store, input, run)).rejects.toThrow(
      cleanupSuccess ? "domain failure" : "unknown",
    );
    expect(run).toHaveBeenCalledOnce();
  }
});

it("releases exact proven local no-dispatch failure with zero provider usage", async () => {
  const { store, engine } = await setup();
  const runtime = bindSessionWork(store, engine);
  const run = vi.fn(async (_signal?: AbortSignal, retirement?: ProviderRetirementObserver) => {
    await retirement!.onRetired!({
      original: retirement!.retirementIdentity!,
      dispatch: "not-entered",
      cleanupSuccess: true,
    });
    throw new Error("provider not connected");
  });
  await expect(runAssistantHelper(store, input, run)).rejects.toThrow("not connected");
  expect((await runtime.work.list())[0]).toMatchObject({
    state: "completed",
    reserved: false,
    outcome: { status: "failed" },
  });
  const row = await store.db.prepare("SELECT value FROM task_run_budget_ledger").get();
  expect(JSON.parse(String(row!.value))).toMatchObject({ tokens: 0, costUsd: 0 });
  await expect(runAssistantHelper(store, input, run)).rejects.toThrow("not connected");
  expect(run).toHaveBeenCalledOnce();
});
