import { describe, expect, it } from "vitest";
import type { HostStore } from "../store";
import { delegationBudgetScope, delegationWorkRoot } from "./work-root";

function fixture(options: { work?: unknown[]; ledger?: Record<string, unknown> } = {}) {
  const store = {
    db: {
      prepare: (sql: string) => ({
        all: async () =>
          sql.includes("sqlite_master")
            ? [{ name: "work_queue" }, { name: "task_run_budget_ledger" }]
            : (options.work ?? []).map((work) => ({ value: JSON.stringify(work) })),
        get: async (sessionId?: string, runId?: string) =>
          sql.includes("sqlite_master")
            ? { name: "task_run_budget_ledger" }
            : sessionId === "parent" && runId === "parent-turn" && options.ledger
              ? { value: JSON.stringify(options.ledger) }
              : undefined,
      }),
    },
  } as unknown as HostStore;
  return store;
}

describe("delegation originating Work allowance", () => {
  it("uses exact receipt and ignores another turn in same session", async () => {
    const store = fixture({
      work: [
        { rootWorkId: "task:wrong", receipt: { sessionId: "parent", runId: "old-turn" } },
        { rootWorkId: "task:original", receipt: { sessionId: "parent", runId: "parent-turn" } },
      ],
    });
    expect(await delegationWorkRoot(store, "parent", "parent-turn")).toBe("task:original");
  });

  it("recovers legacy task allowance from immutable accepted ledger", async () => {
    const store = fixture({
      ledger: { taskId: "original", parentTaskId: "outer", goalId: "goal" },
    });
    expect(await delegationWorkRoot(store, "parent", "parent-turn")).toBe("task:original");
    expect(await delegationBudgetScope(store, "parent", "parent-turn")).toEqual({
      taskId: "original",
      parentTaskId: "outer",
      goalId: "goal",
    });
  });

  it("preserves inherited root instead of deriving new child allowance", async () => {
    expect(
      await delegationWorkRoot(
        fixture({ ledger: { taskId: "child", rootWorkId: "task:original" } }),
        "parent",
        "parent-turn",
      ),
    ).toBe("task:original");
  });

  it("keeps ordinary interactive delegation outside unattended attribution", async () => {
    expect(await delegationWorkRoot(fixture(), "parent", "parent-turn")).toBeUndefined();
    expect(await delegationBudgetScope(fixture(), "parent", "parent-turn")).toBeUndefined();
  });

  it("keeps a Native parent outside Host Work and budget attribution", async () => {
    const store = fixture({ ledger: { taskId: "unrelated" } });
    store.session = async () => {
      throw new Error("Session not found on this machine");
    };
    expect(await delegationWorkRoot(store, "native-parent", undefined)).toBeUndefined();
    expect(await delegationBudgetScope(store, "native-parent", undefined)).toBeUndefined();
  });
});
