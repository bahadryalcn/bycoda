import { describe, expect, it, vi } from "vitest";
import { WS_LIMITS } from "../../src/shared/model/host-contracts";
import { createHostReadDispatcher, HostDispatchError } from "./dispatch";
import { HostReadWorkBudget } from "./read-budget";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("Host backend read admission", () => {
  it("lets a burst of one device's authorization checks share one control slot", async () => {
    const budget = new HostReadWorkBudget({ ...WS_LIMITS, maxControlJobsPerDevice: 8 });
    const check = deferred<boolean>();
    const action = vi.fn(() => check.promise);
    const burst = Array.from({ length: 20 }, () => budget.runShared("phone", action));
    check.resolve(true);
    await expect(Promise.all(burst)).resolves.toEqual(Array(20).fill(true));
    expect(action).toHaveBeenCalledOnce();
    // A later request runs a fresh check instead of reusing the settled one.
    await expect(budget.runShared("phone", async () => false)).resolves.toBe(false);
  });
  it("does not let an old stalled check answer for new requests", async () => {
    const budget = new HostReadWorkBudget({ ...WS_LIMITS, maxControlJobsPerDevice: 2 });
    const stalled = deferred<boolean>();
    void budget.runShared("phone", () => stalled.promise);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2_000);
    try {
      await expect(budget.runShared("phone", async () => false)).resolves.toBe(false);
    } finally {
      clock.mockRestore();
      stalled.resolve(true);
    }
  });

  it("holds detached work per principal and globally until backend settlement", async () => {
    const budget = new HostReadWorkBudget({
      ...WS_LIMITS,
      maxReadJobs: 2,
      maxReadJobsPerDevice: 1,
    });
    const first = deferred<number>();
    const second = deferred<number>();
    const a = budget.run("a", () => first.promise);
    const b = budget.run("b", () => second.promise);
    await expect(budget.run("a", async () => 3)).rejects.toMatchObject({
      code: "overloaded",
      details: { category: "overload", retryable: true, delivery: "not-sent" },
    });
    await expect(budget.run("c", async () => 3)).rejects.toMatchObject({ code: "overloaded" });
    first.resolve(1);
    expect(await a).toBe(1);
    expect(await budget.run("c", async () => 3)).toBe(3);
    second.resolve(2);
    expect(await b).toBe(2);
  });

  it("reserves independent control admission when ordinary reads are full", async () => {
    const budget = new HostReadWorkBudget({
      ...WS_LIMITS,
      maxReadJobs: 1,
      maxReadJobsPerDevice: 1,
    });
    const blocked = deferred<number>();
    const work = budget.run("device", () => blocked.promise);
    expect(await budget.run("device", async () => "authorized-status", "control")).toBe(
      "authorized-status",
    );
    await expect(budget.run("device", async () => 2)).rejects.toBeInstanceOf(HostDispatchError);
    blocked.resolve(1);
    await work;
  });

  it("releases capacity after synchronous or asynchronous failure", async () => {
    const budget = new HostReadWorkBudget({ ...WS_LIMITS, maxReadJobs: 1 });
    await expect(
      budget.run("device", () => {
        throw new Error("start failed");
      }),
    ).rejects.toThrow("start failed");
    await expect(
      budget.run("device", async () => {
        throw new Error("read failed");
      }),
    ).rejects.toThrow("read failed");
    expect(await budget.run("device", async () => 1)).toBe(1);
  });

  it("tracks the actual service even after the dispatcher releases a cancelled wait", async () => {
    const budget = new HostReadWorkBudget({ ...WS_LIMITS, maxReadJobs: 1 });
    const started = deferred<void>();
    const finish = deferred<unknown>();
    const dispatcher = createHostReadDispatcher({
      environmentId: "environment",
      environment: { describe: async () => ({}) },
      projects: {
        list: async () => {
          started.resolve();
          return finish.promise;
        },
      },
    });
    const controller = new AbortController();
    const work = dispatcher.dispatch(
      "projects.list",
      {},
      {
        environmentId: "environment",
        principal: { kind: "device", id: "device" },
        authorized: () => true,
        signal: controller.signal,
        trackWork: (action) => budget.run("device", action),
      },
    );
    const cancelled = expect(work).rejects.toMatchObject({ code: "cancelled" });
    await started.promise;
    controller.abort();
    await cancelled;
    await expect(budget.run("device", async () => [])).rejects.toMatchObject({
      code: "overloaded",
    });
    finish.resolve([]);
    await finish.promise;
    await Promise.resolve();
    expect(await budget.run("device", async () => [])).toEqual([]);
  });
  it("shares one lease with a tracked child until physical settlement and rejects late work", async () => {
    const budget = new HostReadWorkBudget({
      ...WS_LIMITS,
      maxControlJobs: 1,
      maxControlJobsPerDevice: 1,
    });
    const child = deferred<number>();
    let track!: <T>(work: () => Promise<T>) => Promise<T>;
    const outer = budget.runScoped(
      "device",
      async (run) => {
        track = run;
        void run(() => child.promise);
        return "response";
      },
      "control",
    );
    await Promise.resolve();
    await expect(budget.run("device", async () => 1, "control")).rejects.toMatchObject({
      code: "overloaded",
    });
    const late = vi.fn(async () => 2);
    await expect(track(late)).rejects.toMatchObject({ code: "cancelled" });
    expect(late).not.toHaveBeenCalled();
    child.resolve(3);
    expect(await outer).toBe("response");
    expect(await budget.run("device", async () => 4, "control")).toBe(4);
  });
});
