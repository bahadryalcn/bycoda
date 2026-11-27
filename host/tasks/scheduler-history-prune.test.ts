import { describe, expect, it, vi } from "vitest";
import { work } from "./scheduler";
import type { TaskContext } from "./context";

// Regression for #359: an idle tick must not open a write transaction just to find nothing to prune.
function taskContext(cutoffRow: { sequence: number } | undefined) {
  const transaction = vi.fn(async (fn: () => unknown) => fn());
  const scope = vi.fn(async (fn: () => unknown) => fn());
  const get = vi.fn(async () => cutoffRow);
  const context = {
    now: () => 1_000,
    store: {
      db: { scope, prepare: vi.fn(() => ({ get, run: vi.fn() })) },
      transaction,
    },
    schedulerSnapshot: vi.fn(async () => new Map()),
    limits: { settings: vi.fn(async () => ({ maxRunningTasks: 1 })) },
  } as unknown as TaskContext;
  return { context, transaction, scope, get };
}

describe("task history pruning on the scheduler tick", () => {
  it("continues the scheduler tick without a write transaction when no history is due", async () => {
    const { context, transaction, scope } = taskContext(undefined);

    await work(context);

    expect(scope).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
    expect(context.schedulerSnapshot).toHaveBeenCalledOnce();
  });

  it("opens the write transaction and re-checks the cutoff when history is due", async () => {
    const { context, transaction } = taskContext({ sequence: 5 });

    await work(context);

    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
