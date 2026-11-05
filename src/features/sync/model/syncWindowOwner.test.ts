import { afterEach, beforeEach, expect, it, vi } from "vitest";
const environment = vi.hoisted(() => ({ native: false }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => environment.native }));
import { createSyncWindowOwner } from "./syncWindowOwner";
import { isTauri } from "@tauri-apps/api/core";

beforeEach(() => { vi.stubGlobal("navigator", {}); });
afterEach(() => { environment.native = false; vi.useRealTimers(); vi.unstubAllGlobals(); });

it("runs one background owner and transfers ownership after its window closes", async () => {
  vi.useFakeTimers();
  let held = false;
  const locks = {
    request: vi.fn(
      async (_name: string, _options: LockOptions, work: (lock: Lock | null) => unknown) => {
        if (held) return work(null);
        held = true;
        try {
          return await work({ name: "bycoda-library-sync", mode: "exclusive" });
        } finally {
          held = false;
        }
      },
    ),
  } as unknown as LockManager;
  const firstReady = vi.fn();
  const secondReady = vi.fn();
  const first = createSyncWindowOwner(firstReady, locks);
  const second = createSyncWindowOwner(secondReady, locks);
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(first.isOwner()).toBe(true);
    expect(second.isOwner()).toBe(false);
    expect(firstReady).toHaveBeenCalledTimes(1);
    expect(secondReady).not.toHaveBeenCalled();
    first.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(second.isOwner()).toBe(true);
    expect(secondReady).toHaveBeenCalledTimes(1);
  } finally {
    first.stop();
    second.stop();
  }
  await vi.advanceTimersByTimeAsync(10_000);
  expect(held).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it("preserves background functionality when Web Locks are unavailable or denied", async () => {
  const unavailable = createSyncWindowOwner(vi.fn(), undefined);
  expect(unavailable.isOwner()).toBe(true);
  unavailable.stop();
  const acquired = vi.fn();
  const denied = createSyncWindowOwner(acquired, {
    request: async () => {
      throw new Error("Denied");
    },
  } as unknown as LockManager);
  await Promise.resolve();
  await Promise.resolve();
  expect(denied.isOwner()).toBe(true);
  expect(acquired).toHaveBeenCalledTimes(1);
  denied.stop();
});

it("does not grant native sync ownership when the lock service is unavailable", async () => {
  environment.native = true;
  expect(isTauri()).toBe(true);
  const acquired = vi.fn();
  const unavailable = createSyncWindowOwner(acquired, undefined);
  expect(unavailable.isOwner()).toBe(false);
  const denied = createSyncWindowOwner(acquired, {
    request: async () => { throw new Error("Denied"); },
  } as unknown as LockManager);
  await Promise.resolve();
  await Promise.resolve();
  expect(denied.isOwner()).toBe(false);
  expect(acquired).not.toHaveBeenCalled();
  unavailable.stop();
  denied.stop();
});
