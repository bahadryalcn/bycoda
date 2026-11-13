import { afterEach, expect, it, vi } from "vitest";
import { cleanups, setup } from "../engine-support/engine.test-support";
import {
  bindSessionWork,
  markSessionWorkCoverage,
  type RegisteredWorkExecutor,
} from "./session-adapter";

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it("qualifies coverage only after every background executor is registered and retains its first boundary", async () => {
  const f = await setup();
  const runtime = bindSessionWork(f.store, f.engine);
  await expect(markSessionWorkCoverage(f.store, 10)).rejects.toThrow("coverage executor");
  const executor: RegisteredWorkExecutor = {
    resolve: async () => {
      throw new Error("Not dispatched by this qualification test");
    },
    launch: async () => {
      throw new Error("Not dispatched by this qualification test");
    },
    observe: async () => ({ state: "unknown" }),
    stop: async () => {},
  };
  for (const key of ["assistant-text", "assistant-session", "room-automation"])
    runtime.registerExecutor(key, executor);
  await markSessionWorkCoverage(f.store, 10);
  await markSessionWorkCoverage(f.store, 20);
  const saved = await f.store.db
    .prepare("SELECT value FROM host_settings WHERE key='workCoverageSince'")
    .get();
  expect(Number(saved?.value)).toBe(10);
});

it("serializes shared queue maintenance and prevents dispatch after shutdown", async () => {
  const f = await setup();
  const runtime = bindSessionWork(f.store, f.engine);
  const retirement = Promise.withResolvers<void>();
  const reconcile = vi.spyOn(runtime.work, "reconcile").mockReturnValue(retirement.promise);
  const tick = vi.spyOn(runtime.work, "tick").mockResolvedValue(undefined);
  vi.useFakeTimers();
  try {
    runtime.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(tick).not.toHaveBeenCalled();
    runtime.stop();
    retirement.resolve();
    await vi.advanceTimersByTimeAsync(3000);
    expect(tick).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledTimes(1);
  } finally {
    runtime.stop();
    retirement.resolve();
  }
});
