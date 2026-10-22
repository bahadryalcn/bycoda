import { describe, expect, it, vi } from "vitest";
import { retainAsyncSubscription } from "./asyncSubscription";

describe("async subscription lifecycle", () => {
  it("releases a registration that resolves after cleanup", async () => {
    let resolve!: (release: () => void) => void;
    const registration = new Promise<() => void>((done) => {
      resolve = done;
    });
    const release = vi.fn();
    const dispose = retainAsyncSubscription(registration, vi.fn());
    dispose();
    resolve(release);
    await registration;
    expect(release).toHaveBeenCalledOnce();
  });
  it("cleans up exactly once and reports registration failures", async () => {
    const release = vi.fn();
    const report = vi.fn();
    const registration = Promise.resolve(release);
    const dispose = retainAsyncSubscription(registration, report);
    await registration;
    dispose();
    dispose();
    expect(release).toHaveBeenCalledOnce();
    const failure = new Error("registration failed");
    retainAsyncSubscription(Promise.reject(failure), report);
    await Promise.resolve();
    await Promise.resolve();
    expect(report).toHaveBeenCalledWith(failure);
  });
});
