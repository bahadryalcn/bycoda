import { describe, expect, it, vi } from "vitest";
import type { HostEngine } from "../engine";
import type { SessionRunEngine } from "../sessions/sessionRuns";
import type { HostStore } from "../store";
import { retireReviewedPlanner } from "./planner-retirement";

function fixture(storageFails = false) {
  const records: Array<{ key: string; value: Record<string, unknown> }> = [];
  const run = vi.fn(async (key: string, value: string) => {
    if (storageFails) throw new Error("Storage failed");
    records.push({ key, value: JSON.parse(value) as Record<string, unknown> });
  });
  const store = {
    db: {
      runRecoveryBookkeeping: async (work: () => Promise<unknown>) => work(),
      prepare: () => ({ run }),
    },
  } as unknown as HostStore;
  const command = vi.fn().mockRejectedValue(new Error("Cancellation rejected"));
  const engine = { command } as unknown as SessionRunEngine;
  return { store, engine, command, records };
}

describe("reviewed planner retirement", () => {
  it("records retirement only after the exact accepted run settles", async () => {
    const f = fixture();
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(
      retireReviewedPlanner(
        f.store,
        f.engine,
        wait as HostEngine["waitForRun"],
        "goal",
        {
          sessionId: "session",
          runId: "run",
        },
        new Error("Admission lost"),
      ),
    ).rejects.toThrow("cancellation retired");
    expect(wait).toHaveBeenCalledExactlyOnceWith("session", "run");
    expect(f.records.at(-1)).toMatchObject({
      key: "goal-planner-retirement:goal:run",
      value: { state: "retired", sessionId: "session", runId: "run" },
    });
  });

  it("records uncertainty if exact run retirement cannot be proven", async () => {
    const f = fixture();
    const wait = vi.fn().mockRejectedValue(new Error("Run unknown"));
    await expect(
      retireReviewedPlanner(
        f.store,
        f.engine,
        wait as HostEngine["waitForRun"],
        "goal",
        {
          sessionId: "session",
          runId: "run",
        },
        new Error("Admission lost"),
      ),
    ).rejects.toThrow("cancellation unknown");
    expect(wait).toHaveBeenCalledExactlyOnceWith("session", "run");
    expect(f.records.at(-1)?.value).toMatchObject({
      state: "uncertain",
      cleanupError: "Cancellation rejected",
    });
  });

  it("reports missing receipt when bookkeeping fails even if the run retired", async () => {
    const f = fixture(true);
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(
      retireReviewedPlanner(
        f.store,
        f.engine,
        wait as HostEngine["waitForRun"],
        "goal",
        {
          sessionId: "session",
          runId: "run",
        },
        new Error("Admission lost"),
      ),
    ).rejects.toThrow("not persisted");
    expect(f.command).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledExactlyOnceWith("session", "run");
    expect(f.records).toEqual([]);
  });
});
