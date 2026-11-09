import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDiffWorker } from "./diffWorker";
afterEach(() => vi.unstubAllGlobals());
it("falls back when Worker is absent", async () => {
  vi.stubGlobal("Worker", undefined);
  const fallback = vi.fn(() => "local");
  expect(await runDiffWorker(() => Promise.resolve("worker"), fallback)).toBe("local");
  expect(fallback).toHaveBeenCalledOnce();
});
it("falls back if WebView/CSP rejects worker construction", async () => {
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        throw new Error("blocked");
      }
    },
  );
  expect(
    await runDiffWorker(
      () => Promise.resolve("worker"),
      () => "local",
    ),
  ).toBe("local");
});

describe("worker recovery", () => {
  type Fake = { terminated: boolean; terminate(): void; addEventListener(): void };
  let workers: Fake[];

  async function load() {
    vi.resetModules();
    workers = [];
    vi.doMock("comlink", () => ({ wrap: (w: Fake) => ({ worker: w }) }));
    vi.stubGlobal(
      "Worker",
      class implements Fake {
        terminated = false;
        constructor() {
          workers.push(this);
        }
        terminate() {
          this.terminated = true;
        }
        addEventListener() {}
      },
    );
    return import("./diffWorker");
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("comlink");
  });

  it("scales the deadline with the input size", async () => {
    const { diffWorkerDeadline } = await load();
    expect(diffWorkerDeadline(0)).toBe(10_000);
    expect(diffWorkerDeadline(1024 * 100)).toBeGreaterThan(diffWorkerDeadline(1024));
    expect(diffWorkerDeadline(1e12)).toBe(120_000);
  });

  it("does not count queue time against a request and keeps others alive after a timeout", async () => {
    const { runDiffWorker } = await load();
    const slow = runDiffWorker(
      () => new Promise<string>(() => {}),
      () => "slow-local",
    );
    const waiting = runDiffWorker(
      () => Promise.resolve("worker-ok"),
      () => "waiting-local",
    );
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await slow).toBe("slow-local");
    expect(await waiting).toBe("worker-ok");
    expect(workers[0]?.terminated).toBe(true);
    expect(workers).toHaveLength(2);
  });

  it("gives up on the worker only after repeated consecutive failures", async () => {
    const { runDiffWorker } = await load();
    const failing = () => Promise.reject(new Error("boom"));
    for (let i = 0; i < 3; i += 1) {
      expect(await runDiffWorker(failing, () => "local")).toBe("local");
    }
    const invoke = vi.fn(() => Promise.resolve("worker"));
    expect(await runDiffWorker(invoke, () => "local")).toBe("local");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("resets the failure budget after a success", async () => {
    const { runDiffWorker } = await load();
    const failing = () => Promise.reject(new Error("boom"));
    for (let i = 0; i < 2; i += 1) await runDiffWorker(failing, () => "local");
    expect(
      await runDiffWorker(
        () => Promise.resolve("worker"),
        () => "local",
      ),
    ).toBe("worker");
    for (let i = 0; i < 2; i += 1) await runDiffWorker(failing, () => "local");
    expect(
      await runDiffWorker(
        () => Promise.resolve("worker"),
        () => "local",
      ),
    ).toBe("worker");
  });
});
