import { expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { ProviderProcessLifecycle } from "./provider-process-lifecycle";

it("retains a closed original with unknown private retirement while an unrelated session drains", async () => {
  const original = spawn(process.execPath, ["-e", "process.exit(0)"], {
    stdio: "pipe",
    windowsHide: true,
  });
  const lifecycle = new ProviderProcessLifecycle();
  let unknown!: (reason: Error) => void;
  const proof = new Promise<void>((_resolve, reject) => {
    unknown = reject;
  });
  lifecycle.register("unknown", original, proof);
  await new Promise<void>((resolve) => original.once("close", () => resolve()));
  let drained = false;
  const drain = lifecycle.drainSession("unknown").finally(() => {
    drained = true;
  });
  void drain.catch(() => {});
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(drained).toBe(false);
  await expect(lifecycle.drainSession("unrelated")).resolves.toBeUndefined();
  unknown(new Error("private guardian receipt missing"));
  await expect(drain).rejects.toThrow("did not complete successfully");
  await expect(lifecycle.drainSession("unknown")).rejects.toThrow("did not complete successfully");
  const lateStop = vi.fn(async () => {});
  await expect(lifecycle.retire(original, lateStop)).rejects.toThrow(
    "private guardian receipt missing",
  );
  expect(lateStop).not.toHaveBeenCalled();
});

it("waits for actual close after a matching private proof arrives first", async () => {
  const original = spawn(process.execPath, ["-e", "process.stdin.resume();"], {
    stdio: "pipe",
    windowsHide: true,
  });
  const lifecycle = new ProviderProcessLifecycle();
  lifecycle.register("proved", original, Promise.resolve());
  let drained = false;
  const draining = lifecycle.drainSession("proved").then(() => {
    drained = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(drained).toBe(false);
  original.stdin.end();
  await draining;
  expect(drained).toBe(true);
});

it("does not issue a late OS retirement request after the original real child already closed", async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
    stdio: "pipe",
    windowsHide: true,
  });
  const lifecycle = new ProviderProcessLifecycle();
  lifecycle.register("already-closed", child);
  await new Promise<void>((resolve) => child.once("close", () => resolve()));
  const stop = vi.fn(async () => {
    throw new Error("A closed construction must not signal a reused PID.");
  });
  await lifecycle.retire(child, stop);
  await lifecycle.drainAll();
  expect(stop).not.toHaveBeenCalled();
});

it.each(["rejection", "synchronous throw"] as const)(
  "retains a failed retirement %s until the original real child closes and reports its failure",
  async (kind) => {
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      stdio: "pipe",
      windowsHide: true,
    });
    const lifecycle = new ProviderProcessLifecycle();
    lifecycle.register("original", child);
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    const failure = new Error(`fixture stop ${kind}`);
    let retirement: Promise<void> | undefined;
    let draining: Promise<void> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      const stop = vi.fn(() => {
        if (kind === "synchronous throw") throw failure;
        return Promise.reject(failure);
      });
      retirement = lifecycle.retire(child, stop);
      expect(lifecycle.retire(child, stop)).toBe(retirement);
      let retired = false;
      const retirementFailure = retirement.then(
        () => {
          retired = true;
          return undefined;
        },
        (error: unknown) => {
          retired = true;
          return error;
        },
      );
      draining = lifecycle.drainAll();
      let drained = false;
      const drainFailure = draining.then(
        () => {
          drained = true;
          return undefined;
        },
        (error: unknown) => {
          drained = true;
          return error;
        },
      );
      // A real ChildProcess error event is observable, but is not close proof.
      child.emit("error", new Error("fixture nonterminal process error"));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(stop).toHaveBeenCalledOnce();
      expect(retired).toBe(false);
      expect(drained).toBe(false);
      expect(child.exitCode).toBeNull();
      expect(child.signalCode).toBeNull();
      child.kill();
      await closed;
      expect(await retirementFailure).toBe(failure);
      const error = await drainFailure;
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toContain(failure);
      expect(retired).toBe(true);
      expect(drained).toBe(true);
    } finally {
      child.kill();
      await closed;
      await retirement?.catch(() => {});
      await draining?.catch(() => {});
    }
  },
);
