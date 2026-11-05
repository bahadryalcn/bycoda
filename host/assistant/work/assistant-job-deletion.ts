import { createHash, randomUUID } from "node:crypto";
import type { HostStore } from "../../store";
import type { HostTasks } from "../../tasks/tasks";
import type { HostGoals } from "../../goals/goals";
import { parseHostTask, type HostTask } from "../../../src/features/tasks/model/hostTasks";
import { parseHostGoal, type HostGoal } from "../../../src/features/tasks/model/hostGoals";
import { hasUnmergedBranch, orderTasksForDeletion } from "../../../src/features/tasks/model/taskRules";
import type {
  AssistantJob,
  AssistantJobDeleteReview,
} from "../../../src/shared/model/host-contracts/assistant";
import { assertAssistantGoalProjects } from "./assistant-job-scope";
import { assistantJobProjectIds } from "../../../src/shared/model/assistantProjects";

type Source = {
  sessionId: string;
  runId: string;
  projectId: string;
  executionCwd: string;
  authorityGeneration?: number;
};
type Selection = {
  goal: HostGoal;
  goalValue: string;
  tasks: { task: HostTask; value: string }[];
  sources: Source[];
  identity: string;
};
type Deletion = {
  jobId: string;
  operationId: string;
  state: "stopping" | "attention" | "deleted" | "restored" | "aborted";
  reviewToken: string;
  selection: Selection;
  quiescentIdentity?: string;
  stopped?: Selection;
  createdAt: number;
  deletedAt?: number;
  message: string;
  stopIssued: boolean;
  abortedAt?: number;
};
export type AssistantJobDeletionScope = { taskIds: string[]; sessionIds: string[] };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const DAY = 86400000;
export class HostAssistantJobDeletion {
  readonly ready: Promise<void>;
  constructor(
    private readonly store: HostStore,
    private readonly goals: HostGoals,
    private readonly tasks: HostTasks,
  ) {
    this.ready = (async () => {
      await Promise.all([store.ready, goals.ready, tasks.ready]);
      await store.db.scope(() =>
        store.db.exec(
          "CREATE TABLE IF NOT EXISTS assistant_job_deletions(job_id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS assistant_job_deletion_history(operation_id TEXT PRIMARY KEY,job_id TEXT NOT NULL,value TEXT NOT NULL)",
        ),
      );
    })();
  }
  private async record(id: string): Promise<Deletion | undefined> {
    await this.ready;
    const row = await this.store.db
      .prepare("SELECT value FROM assistant_job_deletions WHERE job_id=?")
      .get(id);
    return row ? JSON.parse(row.value) : undefined;
  }
  private put(value: Deletion) {
    return this.store.db
      .prepare(
        "INSERT INTO assistant_job_deletions(job_id,value) VALUES(?,?) ON CONFLICT(job_id) DO UPDATE SET value=excluded.value",
      )
      .run(value.jobId, JSON.stringify(value));
  }
  private archive(value: Deletion, resolution?: { state: "aborted"; at: number }) {
    return this.store.db
      .prepare(
        "INSERT OR IGNORE INTO assistant_job_deletion_history(operation_id,job_id,value) VALUES(?,?,?)",
      )
      .run(
        value.operationId,
        value.jobId,
        JSON.stringify({ ...value, ...(resolution ? { ownerResolution: resolution } : {}) }),
      );
  }
  private async selection(job: AssistantJob): Promise<Selection> {
    if (job.kind === "quick" || job.goalId !== `assistant-${job.id}`)
      throw new Error("Only a project job's exact canonical goal can delete its tasks.");
    const row = await this.store.db.prepare("SELECT value FROM goals WHERE id=?").get(job.goalId);
    if (!row)
      throw new Error(
        "The canonical goal is unavailable; delete only the job or inspect its source.",
      );
    const goal = JSON.parse(row.value) as HostGoal;
    assertAssistantGoalProjects(job, goal);
    for (const id of assistantJobProjectIds(job)) await this.store.project(id);
    const rows = await this.store.db
      .prepare("SELECT id,value FROM tasks WHERE json_extract(value,'$.goalId')=? ORDER BY id")
      .all(goal.id);
    if (
      rows.length > 1000 ||
      JSON.stringify(rows.map((row) => row.id).sort()) !==
        JSON.stringify([...new Set(goal.taskIds)].sort()) ||
      new Set(goal.taskIds).size !== goal.taskIds.length
    )
      throw new Error("The goal's actual task set changed or is incomplete. Nothing was deleted.");
    const selected = rows.map((row) => ({
      task: JSON.parse(row.value) as HostTask,
      value: String(row.value),
    }));
    for (const { task } of selected) {
      parseHostTask(task);
      if (task.goalId !== goal.id || !goal.projectIds.includes(task.projectId))
        throw new Error("A selected task moved outside its canonical goal/project.");
    }
    const sources: Source[] = [];
    const add = async (
      sessionId: string | undefined,
      runId: string | undefined,
      projectId: string,
    ) => {
      if (!sessionId) return;
      const record = await this.store.session(sessionId);
      if (!runId || record.runId !== runId || record.projectId !== projectId)
        throw new Error(
          "A selected run is unknown or replaced. The replacement will not be stopped.",
        );
      if (!sources.some((source) => source.sessionId === sessionId && source.runId === runId))
        sources.push({
          sessionId,
          runId,
          projectId,
          executionCwd: record.session.worktreeCwd ?? record.session.cwd,
          authorityGeneration: record.authorityGeneration,
        });
    };
    await add(goal.plannerSessionId, goal.plannerRunId, goal.leadProjectId);
    await add(goal.finalAcceptance?.sessionId, goal.finalAcceptance?.runId, goal.leadProjectId);
    for (const { task } of selected) {
      await add(task.sessionId, task.runId, task.projectId);
      await add(task.reviewer?.sessionId, task.reviewer?.runId, task.projectId);
    }
    const identity = hash({
      goal: parseHostGoal(goal),
      plan: goal.plan,
      taskIds: goal.taskIds,
      planner: [goal.plannerSessionId, goal.plannerRunId],
      final: [goal.finalAcceptance?.sessionId, goal.finalAcceptance?.runId],
      tasks: selected.map(({ task }) => ({
        input: parseHostTask(task),
        sessionId: task.sessionId,
        runId: task.runId,
        workspaceGenerationId: task.workspaceGenerationId,
      })),
    });
    return { goal, goalValue: String(row.value), tasks: selected, sources, identity };
  }
  private token(job: AssistantJob, selection: Selection) {
    return hash({
      jobId: job.id,
      jobVersion: job.version,
      goal: selection.goalValue,
      tasks: selection.tasks.map((item) => item.value),
    });
  }
  async review(job: AssistantJob): Promise<AssistantJobDeleteReview> {
    await this.ready;
    return this.store.transaction(async () => {
      const selection = await this.selection(job);
      return {
        jobId: job.id,
        jobVersion: job.version,
        sourceToken: this.token(job, selection),
        goalId: selection.goal.id,
        projectIds: assistantJobProjectIds(job),
        tasks: selection.tasks.map(({ task }) => ({
          id: task.id,
          title: task.title.slice(0, 300),
          projectId: task.projectId,
          status: task.status,
          updatedAt: task.updatedAt,
        })),
      };
    }, "critical");
  }
  async pending(id: string): Promise<boolean> {
    const value = await this.record(id);
    return !!value && ["stopping", "attention"].includes(value.state);
  }
  async deletedTaskCount(id: string): Promise<number | undefined> {
    const value = await this.record(id);
    return value?.state === "deleted" ? value.stopped?.tasks.length : undefined;
  }
  private async retired(selection: Selection): Promise<boolean> {
    for (const source of selection.sources)
      if (!(await this.tasks.assistantDeletionRunRetired(source))) return false;
    return true;
  }
  private async waitRetired(selection: Selection): Promise<void> {
    const deadline = Date.now() + 10000;
    while (!(await this.retired(selection))) {
      if (Date.now() >= deadline)
        throw new Error(
          "The original children are still retiring. Keep the deletion hold and inspect their Stop receipts before retrying.",
        );
      const version = this.store.changes.version;
      await this.store.changes.wait(Math.min(deadline, Date.now() + 250), () => false, version);
    }
  }
  async delete(
    job: AssistantJob,
    token: string,
    at: number,
    commit: (scope: AssistantJobDeletionScope) => Promise<AssistantJob>,
  ): Promise<AssistantJob> {
    await this.ready;
    let record: Deletion | undefined, current!: Selection;
    await this.store.transaction(async () => {
      const row = await this.store.db
        .prepare("SELECT version,deleted_at FROM assistant_jobs WHERE id=?")
        .get(job.id);
      if (!row || row.deleted_at !== null || row.version !== job.version)
        throw new Error("The reviewed assistant job changed before Stop.");
      record = await this.record(job.id);
      if (record?.state === "deleted")
        throw new Error("This job's task deletion already committed; inspect Recently deleted.");
      current = await this.selection(job);
      if (this.token(job, current) !== token)
        throw new Error(
          "The reviewed job/goal/tasks changed. Refresh the exact deletion review before stopping work.",
        );
      if (record && ["stopping", "attention"].includes(record.state)) {
        if ((record.quiescentIdentity ?? record.selection.identity) !== current.identity)
          throw new Error(
            "The original deletion scope changed. Keep job and tasks after inspecting the original Stop; a replacement will not be cancelled.",
          );
      } else {
        if (record) await this.archive(record);
        record = {
          jobId: job.id,
          operationId: randomUUID(),
          state: "stopping",
          reviewToken: token,
          selection: current,
          createdAt: at,
          message: "The owner reviewed this exact goal/task deletion scope.",
          stopIssued: false,
        };
        await this.put(record);
        await this.tasks.setAssistantDeletionHold(current.goal.id, record.operationId, true);
      }
    }, "critical");
    if (!record) throw new Error("The durable deletion intent was not created.");
    try {
      if (!record.stopIssued) {
        record = { ...record, stopIssued: true };
        await this.store.transaction(() => this.put(record!), "critical");
        if (!["done", "cancelled"].includes(current.goal.status))
          await this.goals.cancel(current.goal.id);
        else
          for (const { task } of current.tasks)
            await this.tasks.cancel(task.id, "Stopped for owner-reviewed job deletion.");
      }
      await this.waitRetired(record.selection);
      let stopped = await this.selection(job);
      if (stopped.identity !== (record.quiescentIdentity ?? record.selection.identity))
        throw new Error(
          "The selected goal plan, task set or execution source changed during Stop. Nothing was deleted.",
        );
      await this.store.transaction(async () => {
        for (const { task, value } of stopped.tasks)
          await this.tasks.markAssistantDeletionQuiescent(task.id, value);
        await this.goals.markAssistantDeletionQuiescent(stopped.goal.id, stopped.goalValue);
        record = { ...record!, quiescentIdentity: (await this.selection(job)).identity };
        await this.put(record);
      }, "critical");
      stopped = await this.selection(job);
      await this.tasks.assertAssistantDeletionStopped(stopped.tasks.map((item) => item.task.id));
      for (const { task } of stopped.tasks)
        if (hasUnmergedBranch(task))
          throw new Error(
            "Unmerged work is protected. Keep the tasks or handle their work individually before deleting task metadata.",
          );
      const exact = stopped;
      return await this.store.transaction(async () => {
        const final = await this.selection(job);
        if (
          final.goalValue !== exact.goalValue ||
          JSON.stringify(final.tasks.map((item) => item.value)) !==
            JSON.stringify(exact.tasks.map((item) => item.value)) ||
          !(await this.retired(record!.selection))
        )
          throw new Error("The stopped deletion source changed before its atomic commit.");
        await this.tasks.assertAssistantDeletionStopped(final.tasks.map((item) => item.task.id));
        const backup = {
          ...record!,
          state: "deleted" as const,
          stopped: final,
          deletedAt: at,
          message:
            "Job, goal and exact task metadata were deleted atomically; sessions and all working files were retained.",
        };
        await this.put(backup);
        for (const task of orderTasksForDeletion(final.tasks.map((item) => item.task)))
          await this.tasks.delete(task.id, false, task.updatedAt);
        await this.goals.deleteStoppedAssistantGoal(final.goal.id, final.goalValue);
        const result = await commit({
          taskIds: final.tasks.map((item) => item.task.id),
          sessionIds: [
            ...new Set([
              ...job.sessionIds,
              ...record!.selection.sources.map((source) => source.sessionId),
            ]),
          ],
        });
        await this.tasks.setAssistantDeletionHold(final.goal.id, record!.operationId, false);
        return result;
      }, "critical");
    } catch (error) {
      const committed = await this.store.db.runRecoveryBookkeeping(() => this.record(job.id));
      if (committed?.state === "deleted" && committed.operationId === record.operationId) {
        const row = await this.store.db.runRecoveryBookkeeping(() =>
          this.store.db
            .prepare("SELECT value,deleted_at FROM assistant_jobs WHERE id=?")
            .get(job.id),
        );
        if (row?.deleted_at !== null && row?.value) return JSON.parse(row.value) as AssistantJob;
        throw error;
      }
      await this.store.db.runRecoveryBookkeeping(() =>
        this.store.transaction(
          () =>
            this.put({
              ...record!,
              state: "attention",
              message: `Deletion is held for owner review. No replacement will be cancelled. ${String(error).slice(0, 1000)}`,
            }),
          "critical",
        ),
      );
      throw error;
    }
  }
  async abort(
    job: AssistantJob,
    at: number,
    commit: (state: { retirementUnknown: boolean }) => Promise<AssistantJob>,
  ): Promise<AssistantJob> {
    const record = await this.record(job.id);
    if (!record || !["stopping", "attention", "aborted"].includes(record.state))
      throw new Error("There is no pending task deletion to keep.");
    if (record.state === "aborted") return job;
    for (const source of record.selection.sources)
      await this.tasks.assertAssistantDeletionSourceStable(source);
    let retirementUnknown = true;
    try {
      retirementUnknown = !(await this.retired(record.selection));
    } catch {
      /* Keep can release metadata admission without certifying execution retirement. */
    }
    return this.store.transaction(async () => {
      const current = await this.selection(job);
      if (current.identity !== (record.quiescentIdentity ?? record.selection.identity))
        throw new Error(
          "The original deletion source changed. Inspect the preserved intent before clearing its hold.",
        );
      for (const { task, value } of current.tasks)
        await this.tasks.markAssistantDeletionQuiescent(task.id, value);
      await this.goals.markAssistantDeletionQuiescent(current.goal.id, current.goalValue);
      const result = await commit({ retirementUnknown });
      await this.archive(record, { state: "aborted", at });
      await this.put({
        ...record,
        state: "aborted",
        abortedAt: at,
        message: retirementUnknown
          ? "The owner kept paused metadata and released only its deletion hold. Original execution retirement remains unknown; no new provider action was issued."
          : "The owner kept the job and task metadata after original-run retirement. A separate restart decision is required.",
      });
      await this.tasks.setAssistantDeletionHold(current.goal.id, record.operationId, false);
      return result;
    }, "critical");
  }
  async restore(job: AssistantJob, at: number, commit: () => Promise<void>): Promise<boolean> {
    const record = await this.record(job.id);
    if (!record || record.state !== "deleted") return false;
    if (record.deletedAt === undefined || at - record.deletedAt >= 7 * DAY || !record.stopped)
      throw new Error("The task restore period has expired.");
    const snapshot = record.stopped;
    await this.store.transaction(async () => {
      if (await this.store.db.prepare("SELECT 1 FROM goals WHERE id=?").get(snapshot.goal.id))
        throw new Error("The original goal ID is occupied. Nothing was restored.");
      for (const { task } of snapshot.tasks)
        if (await this.store.db.prepare("SELECT 1 FROM tasks WHERE id=?").get(task.id))
          throw new Error("An original task ID is occupied. Nothing was restored.");
      for (const id of snapshot.goal.projectIds) await this.store.project(id);
      await this.goals.restoreAssistantDeletedGoal(snapshot.goal);
      for (const { task } of snapshot.tasks)
        await this.tasks.restoreAssistantDeletedTask(task, snapshot.goal.id);
      await commit();
      await this.put({
        ...record,
        state: "restored",
        message:
          "The exact goal/task metadata was restored quiescent. No session, worker, merge or delivery was started.",
      });
    }, "critical");
    return true;
  }
  async purge(id: string): Promise<void> {
    const record = await this.record(id);
    if (record && ["stopping", "attention"].includes(record.state))
      throw new Error("Resolve the pending deletion hold before purging its intent.");
    await this.store.db.prepare("DELETE FROM assistant_job_deletions WHERE job_id=?").run(id);
    await this.store.db
      .prepare("DELETE FROM assistant_job_deletion_history WHERE job_id=?")
      .run(id);
  }
}
