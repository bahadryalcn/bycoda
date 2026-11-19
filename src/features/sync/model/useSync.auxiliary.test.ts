// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  loopArgs: [] as unknown[][],
  drain: undefined as Promise<boolean> | undefined,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, isTauri: () => true }));
vi.mock("../../connections/model/connections", () => ({
  cachedRemoteCapabilities: () => ["sync"],
  loadRemoteCapabilities: async () => ["sync"],
  remoteRequest: vi.fn(),
}));
vi.mock("./syncClient", async (original) => ({
  ...(await original<typeof import("./syncClient")>()),
  startSyncLoop: (...args: unknown[]) => {
    mocks.loopArgs = [args];
    return { nudge: vi.fn(), recover: vi.fn(), stop: async () => true };
  },
}));
vi.mock("./syncWindowOwner", () => ({
  createSyncWindowOwner: () => ({
    isOwner: () => true,
    stop: (drain?: Promise<boolean>) => {
      mocks.drain = drain;
    },
  }),
}));

import { CYCLE_INTERVAL_MS, SYNC_STOP_DRAIN_MS } from "./syncClient";
import { startAppSync } from "./useSync";

const machine = { id: "pc", name: "PC", environmentId: "pc-env", endpoint: "" };
let stop: (() => void) | undefined;
let refreshOutcomes: Array<"fail" | "ok">;
beforeEach(() => {
  vi.useFakeTimers();
  mocks.drain = undefined;
  refreshOutcomes = [];
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "remote_machines") {
      if (refreshOutcomes.shift() === "fail") throw new Error("host not up");
      return [machine];
    }
    if (command === "local_host_connect") return machine;
    return undefined;
  });
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.clearAllMocks();
});
const flush = () => vi.advanceTimersByTimeAsync(0);
const beginCycle = () =>
  mocks.loopArgs[0]![5] as (machineId: string, operationId: string) => Promise<void>;
const listMachineIds = () => mocks.loopArgs[0]![0] as () => string[];

it("releases ownership after a refresh failure that overlapped no native cycle", async () => {
  refreshOutcomes = ["fail"];
  stop = startAppSync();
  await vi.advanceTimersByTimeAsync(CYCLE_INTERVAL_MS);
  stop();
  stop = undefined;
  await expect(mocks.drain).resolves.toBe(true);
});

it("keeps the last known machines when a refresh fails", async () => {
  stop = startAppSync();
  await vi.advanceTimersByTimeAsync(CYCLE_INTERVAL_MS);
  expect(listMachineIds()()).toEqual(["pc"]);
  refreshOutcomes = ["fail"];
  await vi.advanceTimersByTimeAsync(CYCLE_INTERVAL_MS);
  expect(listMachineIds()()).toEqual(["pc"]);
});

it("holds ownership while the latest refresh failure overlapped a started native cycle", async () => {
  let reject!: (error: Error) => void;
  mocks.invoke.mockImplementation((command: string) =>
    command === "remote_machines"
      ? new Promise((_, fail) => {
          reject = fail;
        })
      : Promise.resolve(machine),
  );
  stop = startAppSync();
  await vi.advanceTimersByTimeAsync(CYCLE_INTERVAL_MS);
  await beginCycle()("pc", "op-1");
  reject(new Error("host not up"));
  await flush();
  stop();
  stop = undefined;
  await expect(mocks.drain).resolves.toBe(false);
});

it("clears the uncertainty when a later refresh succeeds", async () => {
  let reject!: (error: Error) => void;
  mocks.invoke.mockImplementationOnce(() => Promise.resolve(machine)); // local_host_connect
  mocks.invoke.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  stop = startAppSync();
  await vi.advanceTimersByTimeAsync(CYCLE_INTERVAL_MS);
  await beginCycle()("pc", "op-1");
  reject(new Error("host not up"));
  await flush();
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "remote_machines" ? [machine] : machine,
  );
  await vi.advanceTimersByTimeAsync(CYCLE_INTERVAL_MS);
  stop();
  stop = undefined;
  await expect(mocks.drain).resolves.toBe(true);
});

it("bounds shutdown when a machine refresh never answers and keeps ownership held", async () => {
  mocks.invoke.mockImplementation((command: string) =>
    command === "remote_machines" ? new Promise(() => undefined) : Promise.resolve(machine),
  );
  stop = startAppSync();
  await vi.advanceTimersByTimeAsync(CYCLE_INTERVAL_MS);
  stop();
  stop = undefined;
  let result: boolean | undefined;
  void mocks.drain!.then((settled) => {
    result = settled;
  });
  await vi.advanceTimersByTimeAsync(SYNC_STOP_DRAIN_MS - 1);
  expect(result).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(result).toBe(false);
});
