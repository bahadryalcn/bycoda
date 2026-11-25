import type { HostStore } from "../../store";
import { summaryText } from "../../../src/shared/model/taskStopSummary";
import {
  projectAutomationRun,
  projectGoal,
  projectJob,
  projectTask,
  type WorkProjection,
} from "../../../src/shared/model/workProjection";
import type { AssistantJob } from "../../../src/shared/model/host-contracts/assistant";
import type { HostAutomationRun } from "../../../src/features/automations/model/hostAutomations";
import type { HostGoal } from "../../../src/features/tasks/model/hostGoals";
import type { HostTask } from "../../../src/features/tasks/model/hostTasks";
import type { CrewRun } from "../../../src/features/crews/model/crew";
import { confirmedSilence } from "../../execution/confirmed-silence";
import { describeVerification } from "./assistant-goal-verification";

export type TrackedKind = "goal" | "task" | "crew" | "job" | "automation";
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
  // The quietest running session decides: any recent output keeps the work active.
  let quietest = Infinity,
    running = false;
  for (const id of new Set(sessionIds)) {
    if (!id) continue;
    try {
      const record = await store.session(id);
      if (record.status !== "running") continue;
      running = true;
      const activity = record.runActivity;
      if (!activity || activity.runId !== record.runId) return false;
      quietest = Math.min(quietest, confirmedSilence(store, activity.lastActivityAt, now));
    } catch {
      return false;
    }
  }
  return running && quietest >= stallMs;
}

/**
 * What the Room and voice report for work in a phase. The one mapping from the status projection
 * to a tracked state: a goal or job reads the same as a task would.
 */
async function observationOf(
  { phase, stop }: WorkProjection,
  options: {
    verification?: string;
    /** An owner-stopped task is reported as failed; a goal, job or occurrence as cancelled. */
    cancelledIsFailure?: boolean;
    planApproval?: boolean;
    /** Summary of a stop that records no reason. */
    fallback?: string;
    quiet: () => Promise<boolean>;
  },
): Promise<TrackedObservation> {
  // Review is owner work after the agents finished: the Room reports the task as done.
  if (phase === "done" || phase === "review")
    return { state: "done", verification: options.verification };
  if (phase === "cancelled" && !options.cancelledIsFailure) return { state: "cancelled" };
  if (phase === "stopped" || phase === "cancelled") {
    const text =
      options.fallback && stop?.code === "unrecorded" && !stop.reason
        ? options.fallback
        : stop
          ? summaryText(stop)
          : "";
    return { state: "failed", summary: text.slice(0, 1000) };
  }
  if (phase === "input")
    return {
      state: "waiting",
      waitingReason: options.planApproval ? "planApproval" : "owner",
    };
  return { state: phase === "running" && (await options.quiet()) ? "stalled" : "active" };
}

const row = async (store: HostStore, sql: string, id: string) => {
  const found = await store.db.prepare(sql).get(id);
  return found ? JSON.parse(String(found.value)) : undefined;
};

/** Read-only canonical status of work the assistant tracks; it never writes these records. */
export function storeTrackedWorkReader(store: HostStore): TrackedWorkReader {
  const reader: TrackedWorkReader = async (item, { now, stallMs }) => {
    if (item.kind === "task") {
      const task = (await row(store, "SELECT value FROM tasks WHERE id=?", item.id)) as
        | HostTask
        | undefined;
      if (!task) return undefined;
      return observationOf(projectTask(task), {
        verification: describeVerification(undefined, [task]),
        cancelledIsFailure: true,
        quiet: () => silent(store, [task.sessionId], now, stallMs),
      });
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
      return observationOf(projectGoal(goal, children), {
        verification: describeVerification(goal, children),
        planApproval: goal.status === "awaiting-approval",
        fallback: "The goal needs attention.",
        quiet: () =>
          silent(
            store,
            children.filter((task) => task.status === "running").map((task) => task.sessionId),
            now,
            stallMs,
          ),
      });
    }
    if (item.kind === "job") {
      const job = (await row(
        store,
        "SELECT value FROM assistant_jobs WHERE id=? AND deleted_at IS NULL",
        item.id,
      )) as AssistantJob | undefined;
      if (!job) return undefined;
      return observationOf(projectJob(job), {
        quiet: () => silent(store, job.sessionIds, now, stallMs),
      });
    }
    if (item.kind === "automation") {
      const run = (await row(store, "SELECT value FROM automation_runs WHERE id=?", item.id)) as
        | HostAutomationRun
        | undefined;
      if (!run) return undefined;
      // An occurrence that started a task reads as that task; only one without a task is its own.
      if (run.taskId) return reader({ kind: "task", id: run.taskId }, { now, stallMs });
      return observationOf(projectAutomationRun(run), {
        quiet: () => silent(store, [run.sessionId], now, stallMs),
      });
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
  return reader;
}
