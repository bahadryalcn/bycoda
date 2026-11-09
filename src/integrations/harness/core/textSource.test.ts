import { describe, expect, it, vi } from "vitest";
import { runTextOperation } from "./textSource";

describe("utility operation completion evidence", () => {
  it("reports success only after the original utility operation settles", async () => {
    const completed = vi.fn();
    const release = Promise.withResolvers<string>();
    const pending = runTextOperation(
      { operation: {}, onUtilityCompleted: completed },
      () => release.promise,
    );
    expect(completed).not.toHaveBeenCalled();
    release.resolve("");
    await expect(pending).resolves.toBe("");
    expect(completed).toHaveBeenCalledOnce();
  });

  it("does not report failed or timed-out operations as completed", async () => {
    const completed = vi.fn();
    await expect(
      runTextOperation({ operation: {}, onUtilityCompleted: completed }, async () => {
        throw new Error("unknown completion");
      }),
    ).rejects.toThrow("unknown completion");
    expect(completed).not.toHaveBeenCalled();
  });

  it("does not hide a failed completion observer", async () => {
    await expect(
      runTextOperation(
        {
          operation: {},
          onUtilityCompleted: () => {
            throw new Error("receipt unavailable");
          },
        },
        async () => "value",
      ),
    ).rejects.toThrow("receipt unavailable");
  });
  it("pairs failure with its exact started invocation even after an earlier completion", async () => {
    const started = vi.fn();
    const completed = vi.fn();
    const failed = vi.fn();
    const context = {
      operation: {},
      onUtilityStarted: started,
      onUtilityCompleted: completed,
      onUtilityFailed: failed,
    };
    await runTextOperation(context, async () => null);
    await expect(runTextOperation(context, async () => "unreachable")).rejects.toThrow();
    expect(started).toHaveBeenCalledTimes(2);
    expect(completed).toHaveBeenCalledExactlyOnceWith(started.mock.calls[0][0]);
    expect(failed).toHaveBeenCalledExactlyOnceWith(started.mock.calls[1][0]);
    expect(started.mock.calls[0][0]).not.toBe(started.mock.calls[1][0]);
  });
});
