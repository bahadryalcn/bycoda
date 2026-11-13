import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkRecord } from "../../src/shared/model/host-contracts/work";
import type { RegisteredWorkExecutor } from "./session-adapter";
import { HostStore } from "../store";
const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  complete: vi.fn(async () => undefined),
  settle: vi.fn(async (_store: unknown, _receipt: unknown, _measurement: unknown) => undefined),
}));
vi.mock("./session-adapter", () => ({ registerSessionWorkExecutor: mocks.register }));
vi.mock("./helper-usage", () => ({
  registerHelperUsage: vi.fn(async () => undefined),
  settleHelperUsage: mocks.settle,
}));
import { registerRoomAutomationExecutor } from "./projectless";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.clearAllMocks();
});

function roomWork(): WorkRecord {
  return {
    id: "work",
    requestId: "request",
    rootWorkId: "automation:automation",
    projectId: "",
    state: "running",
    reserved: true,
    createdAt: 1,
    updatedAt: 1,
    dispatchStarted: true,
    stopRequested: false,
    source: { kind: "automation", id: "automation", occurrence: "occurrence" },
    payload: { prompt: "Read public page" },
    target: {
      model: { harness: "codex", model: "model", modelSettings: {} },
      runtimeMode: "supervised",
      permissionRevision: "request",
      execution: { kind: "room", threadId: "room" },
    },
  };
}

it.each(["failed", "cancelled"] as const)(
  "settles a physically retired %s invocation without delivering or inventing usage",
  async (status) => {
    const directory = await mkdtemp(join(tmpdir(), "room-work-outcome-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const store = new HostStore(join(directory, "host.db"));
    cleanups.push(() => store.close());
    await store.ready;
    mocks.register.mockReturnValue({ complete: mocks.complete });
    const execute = vi.fn(async () => ({
      text: "Do not deliver",
      outcome: { status, message: "Exact retired outcome" },
    }));
    const deliver = vi.fn(async () => undefined);
    const ports = {
      globalRoomBinding: async () => ({ id: "room" }),
      execute,
      deliver,
      stop: async () => undefined,
    };
    registerRoomAutomationExecutor(store, ports);
    const executor = mocks.register.mock.lastCall![2] as RegisteredWorkExecutor;
    const work = roomWork();
    await executor.launch(work, async () => undefined);
    await vi.waitFor(() => expect(mocks.complete).toHaveBeenCalledTimes(1));
    const row = await store.db
      .prepare("SELECT value FROM room_work_invocations WHERE work_id='work'")
      .get();
    expect(JSON.parse(row!.value)).toMatchObject({
      state: "completed",
      result: { outcome: { status } },
      outcome: { status },
    });
    expect(deliver).not.toHaveBeenCalled();
    expect(mocks.settle.mock.calls[0]![2]).toMatchObject({ tokens: undefined, costUsd: undefined });
    registerRoomAutomationExecutor(store, ports);
    const restarted = mocks.register.mock.lastCall![2] as RegisteredWorkExecutor;
    expect(await restarted.observe(work)).toMatchObject({
      state: "completed",
      outcome: { status },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  },
);

it("holds missing or failed cleanup as unknown across restart without another provider invocation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "room-work-unretired-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(() => store.close());
  await store.ready;
  mocks.register.mockReturnValue({ complete: mocks.complete });
  const execute = vi.fn(async () => {
    throw new Error("Original cleanup failed");
  });
  const deliver = vi.fn(async () => undefined);
  const ports = {
    globalRoomBinding: async () => ({ id: "room" }),
    execute,
    deliver,
    stop: async () => undefined,
  };
  registerRoomAutomationExecutor(store, ports);
  const executor = mocks.register.mock.lastCall![2] as RegisteredWorkExecutor;
  const work = roomWork();
  await executor.launch(work, async () => undefined);
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  expect(await executor.observe(work)).toEqual({ state: "unknown" });
  registerRoomAutomationExecutor(store, ports);
  const restarted = mocks.register.mock.lastCall![2] as RegisteredWorkExecutor;
  expect(await restarted.observe(work)).toEqual({ state: "unknown" });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(deliver).not.toHaveBeenCalled();
  expect(mocks.settle).not.toHaveBeenCalled();
  expect(mocks.complete).not.toHaveBeenCalled();
});

it("recovers persisted output without another provider invocation after delivery loses acknowledgement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "room-work-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(() => store.close());
  await store.ready;
  mocks.register.mockReturnValue({ complete: mocks.complete });
  const execute = vi.fn(async () => ({ text: "Exact retained answer", tokens: 42 }));
  const deliver = vi
    .fn()
    .mockRejectedValueOnce(new Error("Lost acknowledgement"))
    .mockResolvedValue(undefined);
  const ports = {
    globalRoomBinding: async () => ({ id: "room" }),
    execute,
    deliver,
    stop: async () => undefined,
  };
  const work: WorkRecord = {
    id: "work",
    requestId: "request",
    rootWorkId: "automation:automation",
    projectId: "",
    state: "running",
    reserved: true,
    createdAt: 1,
    updatedAt: 1,
    dispatchStarted: true,
    stopRequested: false,
    source: { kind: "automation", id: "automation", occurrence: "occurrence" },
    payload: { prompt: "Read public page" },
    target: {
      model: { harness: "codex", model: "model", modelSettings: {} },
      runtimeMode: "supervised",
      permissionRevision: "request",
      execution: { kind: "room", threadId: "room" },
    },
  };
  registerRoomAutomationExecutor(store, ports);
  const first = mocks.register.mock.lastCall![2] as RegisteredWorkExecutor;
  await first.launch(work, async () => undefined);
  await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));
  await vi.waitFor(async () => {
    const row = await store.db
      .prepare("SELECT value FROM room_work_invocations WHERE work_id='work'")
      .get();
    expect(JSON.parse(row!.value).result).toMatchObject({
      text: "Exact retained answer",
      tokens: 42,
    });
  });
  registerRoomAutomationExecutor(store, ports);
  const restarted = mocks.register.mock.lastCall![2] as RegisteredWorkExecutor;
  expect(await restarted.observe(work)).toMatchObject({
    state: "completed",
    outcome: { status: "succeeded" },
  });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(deliver).toHaveBeenCalledTimes(2);
  expect(deliver.mock.calls[1]!.slice(0, 3)).toEqual([
    "room",
    "occurrence",
    "Exact retained answer",
  ]);
});
