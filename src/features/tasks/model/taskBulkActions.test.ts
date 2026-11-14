import { describe, expect, it, vi } from "vitest";
import type { BoardTask } from "./taskClient";
import { bulkTaskKey, groupTaskBulkResults, runTaskBulkAction } from "./taskBulkActions";

const task = (id: string, patch: Partial<BoardTask> = {}): BoardTask => ({
  id,
  projectId: "project",
  machineId: "pc",
  machineName: "PC",
  cwd: "/repo",
  title: id,
  prompt: "Implement the requested fix",
  harness: "codex",
  model: "codex:test",
  modelSettings: {},
  runtimeMode: "supervised",
  maxRunMinutes: 0,
  status: "done",
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

describe("scoped bulk task operations", () => {
  it.each([
    ["start", "todo"],
    ["stop", "running"],
    ["retry", "blocked"],
  ] as const)(
    "keeps crew %s eligibility consistent with individual Host actions",
    async (action, status) => {
      const perform = vi.fn(async (_task: BoardTask) => {});
      const result = await runTaskBulkAction(
        [task("crew", { crewRunId: "run", status })],
        action,
        perform,
      );
      expect(result[0].status).toBe("succeeded");
      expect(perform).toHaveBeenCalledOnce();
    },
  );
  it("groups repeated reasons without hiding failed task identities", () => {
    const groups = groupTaskBulkResults([
      { task: task("a"), status: "skipped", reason: "Crew owns this task" },
      { task: task("b"), status: "skipped", reason: "Crew owns this task" },
      { task: task("c"), status: "failed", reason: "Offline" },
      { task: task("d"), status: "succeeded" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].tasks.map((row) => row.id)).toEqual(["a", "b"]);
    expect(groups[1]).toMatchObject({ status: "failed", reason: "Offline" });
  });
  it("deletes selected dependents before prerequisites on their host", async () => {
    const removed: string[] = [];
    await runTaskBulkAction(
      [task("a"), task("b", { dependsOn: ["a"] }), task("c", { dependsOn: ["b"] })],
      "delete",
      async (row) => {
        removed.push(row.id);
      },
    );
    expect(removed).toEqual(["c", "b", "a"]);
  });
  it("removes a captured 100-item selection once without touching unselected tasks", async () => {
    const selected = Array.from({ length: 100 }, (_, i) => task(String(i)));
    const deleted = vi.fn(async (_task: BoardTask) => {});
    const results = await runTaskBulkAction([...selected, selected[0]], "delete", deleted);
    expect(results).toHaveLength(100);
    expect(results.every((result) => result.status === "succeeded")).toBe(true);
    expect(deleted.mock.calls.map(([row]) => (row as BoardTask).id)).toEqual(
      selected.map((row) => row.id),
    );
  });
  it("protects running, unmerged and unreachable tasks while deleting eligible rows", async () => {
    const selected = [
      task("done"),
      task("active", { status: "running" }),
      task("code", { branch: "mc/work" }),
      task("offline", { stale: true }),
    ];
    const deleted = vi.fn(async (_task: BoardTask) => {});
    const results = await runTaskBulkAction(selected, "delete", deleted);
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(results.map((row) => row.status)).toEqual([
      "succeeded",
      "skipped",
      "skipped",
      "skipped",
    ]);
    expect(results.slice(1).every((row) => row.reason)).toBe(true);
  });
  it("preserves successes across partial failures and retries only failed identities", async () => {
    const selected = [task("same"), task("same", { machineId: "mac" }), task("other")];
    const first = await runTaskBulkAction(selected, "delete", async (row) => {
      if (row.machineId === "mac") throw new Error("Disconnected");
    });
    expect(new Set(selected.map(bulkTaskKey)).size).toBe(3);
    const retried = vi.fn(async (_task: BoardTask) => {});
    const retry = await runTaskBulkAction(
      first.filter((row) => row.status === "failed").map((row) => row.task),
      "delete",
      retried,
    );
    expect(retried).toHaveBeenCalledTimes(1);
    expect(retry[0].task.machineId).toBe("mac");
  });
  it("runs a machine serially and reports every item without replaying after a failure", async () => {
    let active = 0;
    const progress: number[] = [];
    const results = await runTaskBulkAction(
      [task("a"), task("b"), task("c")],
      "delete",
      async (row) => {
        expect(++active).toBe(1);
        await Promise.resolve();
        active--;
        if (row.id === "b") throw new Error("Changed on host");
      },
      (_row, completed) => progress.push(completed),
    );
    expect(progress).toEqual([1, 2, 3]);
    expect(results.map((row) => row.status)).toEqual(["succeeded", "failed", "succeeded"]);
  });
});
it("allows deletion of inactive crew tasks while preserving active work", async () => {
  const perform = vi.fn(async (_task: BoardTask) => {});
  const results = await runTaskBulkAction(
    [task("crew", { crewRunId: "run" }), task("active", { crewRunId: "run", status: "running" })],
    "delete",
    perform,
  );
  expect(results.map((row) => row.status)).toEqual(["succeeded", "skipped"]);
});
