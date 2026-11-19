import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProjectKindsSender, projectKindsSignature } from "./projectKindsSender";
import type { ModelRoutingScope } from "../../../shared/model/host-contracts/model-routing";

const RETRY = [100, 200] as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("createProjectKindsSender", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("signs equal maps identically whatever the key order", () => {
    expect(projectKindsSignature({ b: "work", a: "personal" })).toBe(
      projectKindsSignature({ a: "personal", b: "work" }),
    );
  });

  it("keeps a failed send retryable instead of treating it as sent", async () => {
    const sync = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const sender = createProjectKindsSender({
      current: () => ({ "g:/a": "work" }),
      sync,
      retryDelaysMs: RETRY,
    });
    sender.send(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(1);

    // A later non-forced send (any project-path change) must not return early as "unchanged".
    sender.send(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(2);
    // Now confirmed: the same map is skipped.
    sender.send(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("retries on its own with a bounded backoff, then stops", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const sync = vi.fn().mockRejectedValue(new Error("Host is unavailable."));
    const sender = createProjectKindsSender({
      current: () => ({ "g:/a": "work" }),
      sync,
      retryDelaysMs: RETRY,
    });
    sender.send(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(sync).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(sync).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sync).toHaveBeenCalledTimes(3);
  });

  it("stops retrying once a retry succeeds", async () => {
    const sync = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const sender = createProjectKindsSender({
      current: () => ({ "g:/a": "work" }),
      sync,
      retryDelaysMs: RETRY,
    });
    sender.send(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(sync).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("never runs two writes at once and sends the newest map after the first settles", async () => {
    let kinds: Record<string, ModelRoutingScope> = { "g:/a": "work" };
    const first = deferred<boolean>();
    const sync = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(true);
    const sender = createProjectKindsSender({
      current: () => kinds,
      sync,
      retryDelaysMs: RETRY,
    });
    sender.send(true);
    kinds = { "g:/a": "personal" };
    sender.send(false);
    sender.send(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(1);

    first.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(sync.mock.calls[1][0]).toEqual({ "g:/a": "personal" });
  });

  it("does not let a stale success hide a changed map, nor resend an unchanged one", async () => {
    let kinds: Record<string, ModelRoutingScope> = { "g:/a": "work" };
    const first = deferred<boolean>();
    const sync = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(true);
    const sender = createProjectKindsSender({ current: () => kinds, sync, retryDelaysMs: RETRY });
    sender.send(true);
    // A change event during the write whose result ends up identical must not write again.
    sender.send(false);
    first.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(1);

    kinds = { "g:/a": "personal" };
    sender.send(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("does not schedule a retry for a send that fails after dispose", async () => {
    const first = deferred<boolean>();
    const sync = vi.fn().mockReturnValue(first.promise);
    const sender = createProjectKindsSender({
      current: () => ({ "g:/a": "work" }),
      sync,
      retryDelaysMs: RETRY,
    });
    sender.send(true);
    sender.dispose();
    first.resolve(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sync).toHaveBeenCalledTimes(1);
  });
});
