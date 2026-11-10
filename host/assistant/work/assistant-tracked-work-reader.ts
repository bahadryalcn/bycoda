import type { HostStore } from "../../store";
import type { HostGoal } from "../../../src/features/tasks/model/hostGoals";
import type { HostTask } from "../../../src/features/tasks/model/hostTasks";
import type { CrewRun } from "../../../src/features/crews/model/crew";
import { describeVerification } from "./assistant-goal-verification";

export type TrackedKind = "goal" | "task" | "crew";
export type TrackedState =
  | "tracked"
  | "active"
  | "done"
  | "failed"
  | "waiting"
  | "stalled"
  | "cancelled"
  | "gone";
export type TrackedWork = {
  kind: TrackedKind;
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  threadId: string;
  state: TrackedState;
  stateAt: number;
  terminalAt?: number;
};
export type TrackedObservation = {
  state: Exclude<TrackedState, "tracked">;
  summary?: string;
  waitingReason?: "error" | "planApproval" | "owner";
  verification?: string;
};
export type TrackedWorkReader = (
  item: Pick<TrackedWork, "kind" | "id">,
  context: { now: number; stallMs: number },
) => Promise<TrackedObservation | undefined>;

/** Whether every running session of the work has been silent for the stall window. */
async function silent(
  store: HostStore,
  sessionIds: (string | undefined)[],
  now: number,
  stallMs: number,
) {
  let latest = 0,
    running = false;
  for (const id of new Set(sessionIds)) {
    if (!id) continue;
    try {
      const record = await store.session(id);
      if (record.status !== "running") continue;
      running = true;
      const activity = record.runActivity;
      if (!activity || activity.runId !== record.runId) return false;
      latest = Math.max(latest, activity.lastActivityAt);
    } catch {
      return false;
    }
  }
  return running && now - latest >= stallMs;
}

const row = async (store: HostStore, sql: string, id: string) => {
  const found = await store.db.prepare(sql).get(id);
  return found ? JSON.parse(String(found.value)) : undefined;
};

/** Read-only canonical status of work the assistant tracks; it never writes these records. */
export function storeTrackedWorkReader(store: HostStore): TrackedWorkReader {
  return async (item, { now, stallMs }) => {
    if (item.kind === "task") {
      const task = (await row(store, "SELECT value FROM tasks WHERE id=?", item.id)) as
        | HostTask
        | undefined;
      if (!task) return undefined;
      if (task.status === "done" || task.status === "review")
        return { state: "done", verification: describeVerification(undefined, [task]) };
      if (task.status === "blocked")
        return task.error
          ? { state: "failed", summary: task.error.slice(0, 1000) }
          : { state: "waiting", waitingReason: "error" };
      if (task.needsInput) return { state: "waiting", waitingReason: "owner" };
      return {
        state:
          task.status === "running" && (await silent(store, [task.sessionId], now, stallMs))
            ? "stalled"
            : "active",
      };
    }
    if (item.kind === "goal") {
      const goal = (await row(store, "SELECT value FROM goals WHERE id=?", item.id)) as
        | HostGoal
        | undefined;
      if (!goal) return undefined;
      const children = (
        await store.db
          .prepare("SELECT value FROM tasks WHERE json_extract(value,'$.goalId')=?")
          .all(goal.id)
      ).map((value) => JSON.parse(String(value.value)) as HostTask);
      if (goal.status === "done")
        return { state: "done", verification: describeVerification(goal, children) };
      if (goal.status === "cancelled") return { state: "cancelled" };
      if (goal.status === "blocked")
        return {
          state: "failed",
          summary: (goal.error ?? goal.planError ?? "The goal needs attention.").slice(0, 1000),
        };
      if (goal.status === "awaiting-approval")
        return { state: "waiting", waitingReason: "planApproval" };
      if (children.some((task) => task.needsInput && task.status !== "done"))
        return { state: "waiting", waitingReason: "owner" };
      return {
        state: (await silent(
          store,
          children.filter((task) => task.status === "running").map((task) => task.sessionId),
          now,
          stallMs,
        ))
          ? "stalled"
          : "active",
      };
    }
    let run: CrewRun | undefined;
    try {
      const found = await store.db
        .prepare("SELECT payload FROM crew_runs_v2 WHERE run_id=? ORDER BY ordinal DESC LIMIT 1")
        .get(item.id);
      run = found ? (JSON.parse(String(found.payload)) as CrewRun) : undefined;
    } catch {
      return undefined;
    }
    if (!run) return undefined;
    if (run.status === "finished")
      return run.error ? { state: "failed", summary: run.error.slice(0, 1000) } : { state: "done" };
    if (run.status === "paused") return { state: "waiting", waitingReason: "owner" };
    return {
      state: (await silent(store, [run.coordinatorSessionId], now, stallMs)) ? "stalled" : "active",
    };
  };
}
