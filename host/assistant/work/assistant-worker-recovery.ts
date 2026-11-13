import { createHash } from "node:crypto";
import type { HostStore } from "../../store";
import type { HostTasks } from "../../tasks/tasks";
import type { HostTask } from "../../../src/features/tasks/model/hostTasks";
import type { AssistantJob } from "../../../src/shared/model/host-contracts/assistant";
import { assistantJobProjectIds } from "../../../src/shared/model/assistantProjects";
import { assertAssistantGoalProjects } from "./assistant-job-scope";

export type AssistantRecoverySource = {
  taskId: string;
  jobId: string;
  goalId: string;
  sessionId: string;
  runId: string;
  projectId: string;
  executionCwd: string;
  authorityGeneration?: number;
  taskValue: string;
  identity: string;
};
export type AssistantRecoveryResult = {
  taskId: string;
  state: "queued" | "unknown" | "escalated";
  message: string;
};
export type AssistantRecoveryRecord = {
  taskId: string;
  operationId: string;
  source: AssistantRecoverySource;
  state:
    | "cancelling"
    | "retrying"
    | "queued"
    | "running"
    | "completed"
    | "unknown"
    | "escalated"
    | "ownerResolved";
  startedAt: number;
  updatedAt: number;
  message: string;
  launchRequestId: string;
  launchStarted?: boolean;
  queuedTaskValue?: string;
  launchedSessionId?: string;
  launchedRunId?: string;
  launchedAuthorityGeneration?: number;
  ownerResolution?: { at: number; priorState: string; priorMessage: string };
};
export const assistantRecoveryIdentity = (task: HostTask) =>
  JSON.stringify({
    id: task.id,
    goalId: task.goalId,
    projectId: task.projectId,
    harness: task.harness,
    model: task.model,
    providerAccountId: task.providerAccountId,
    modelSettings: task.modelSettings,
    runtimeMode: task.runtimeMode,
    prompt: task.prompt,
    branch: task.branch,
    worktreeCwd: task.worktreeCwd,
    workspaceId: task.workspaceId,
    workspaceGenerationId: task.workspaceGenerationId,
    createdAt: task.createdAt,
  });
const recoveryTables = new WeakMap<HostStore, boolean>();
export async function initializeAssistantRecovery(store: HostStore) {
  await store.ready;
  await store.db.exec(
    "CREATE TABLE IF NOT EXISTS assistant_worker_recovery(task_id TEXT PRIMARY KEY,value TEXT NOT NULL)",
  );
  recoveryTables.set(store, true);
}
export async function readAssistantRecovery(
  store: HostStore,
  taskId: string,
): Promise<AssistantRecoveryRecord | undefined> {
  let exists = recoveryTables.get(store);
  if (exists === undefined) {
    exists = !!(await store.db
      .prepare("SELECT 1 FROM sqlite_master WHERE name='assistant_worker_recovery'")
      .get());
    recoveryTables.set(store, exists);
  }
  if (!exists) return;
  const row = await store.db
    .prepare("SELECT value FROM assistant_worker_recovery WHERE task_id=?")
    .get(taskId);
  return row ? JSON.parse(row.value) : undefined;
}
export async function writeAssistantRecovery(store: HostStore, record: AssistantRecoveryRecord) {
  await store.db
    .prepare(
      "INSERT INTO assistant_worker_recovery(task_id,value) VALUES(?,?) ON CONFLICT(task_id) DO UPDATE SET value=excluded.value",
    )
    .run(record.taskId, JSON.stringify(record));
}
export function assistantRecoveryHoldsTask(
  record: AssistantRecoveryRecord | undefined,
  task: HostTask,
) {
  if (record?.state === "escalated" && task.status === "queued") return true;
  if (
    !record ||
    !["cancelling", "retrying", "unknown"].includes(record.state) ||
    ["done", "review", "todo"].includes(task.status)
  )
    return false;
  return (
    (task.sessionId === (record.launchedSessionId ?? record.source.sessionId) &&
      task.runId === (record.launchedRunId ?? record.source.runId)) ||
    (!task.sessionId && task.status === "queued")
  );
}
type RecoveryInput = {
  jobId: string;
  sessionId: string;
  requestId: string;
  source: { projectId: string; executionCwd: string; authorityGeneration?: number; runId?: string };
  signal: AbortSignal;
  recheck: () => Promise<void>;
};
export interface AssistantWorkerRecoveryPorts {
  effect?<T>(record: AssistantRecoveryRecord, effect: () => Promise<T>): Promise<T>;
  allowed(jobId?: string): Promise<boolean>;
  reserve?(input: {
    jobId: string;
    requestId: string;
    estimatedTokens: number;
    phase: "handoff";
  }): Promise<void>;
  onState(record: AssistantRecoveryRecord): Promise<void>;
  now?(): number;
}
/** One retry belongs to a canonical Task lineage, never to a fresh request ID. */
export class HostAssistantWorkerRecovery {
  readonly ready: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly store: HostStore,
    private readonly tasks: HostTasks,
    private readonly ports: AssistantWorkerRecoveryPorts,
  ) {
    this.ready = (async () => {
      await initializeAssistantRecovery(store);
      for (const row of await store.db
        .prepare("SELECT value FROM assistant_worker_recovery")
        .all()) {
        const record = JSON.parse(row.value) as AssistantRecoveryRecord;
        const task = await tasks.get(record.taskId);
        if (
          record.state === "running" &&
          task &&
          ["done", "review"].includes(task.status) &&
          task.sessionId === record.launchedSessionId &&
          task.runId === record.launchedRunId
        ) {
          await writeAssistantRecovery(store, {
            ...record,
            state: "completed",
            updatedAt: this.now(),
            message: "The recovered worker reached its canonical completion/review state.",
          });
          continue;
        }
        if (
          ["cancelling", "retrying", "running"].includes(record.state) ||
          (record.state === "queued" && record.launchStarted)
        )
          await this.set({
            ...record,
            state: "unknown",
            message:
              "Worker recovery was interrupted. Inspect the original run, then use the task's explicit Retry after it has retired.",
          });
        else if (["unknown", "escalated"].includes(record.state)) await this.ports.onState(record);
      }
    })();
    tasks.assistantRecoveryAdmission = (task, stage) => this.admitLaunch(task, stage);
    tasks.assistantRecoveryFailed = async (task, message) => {
      const record = await readAssistantRecovery(store, task.id);
      if (record) await this.set({ ...record, state: "escalated", message });
    };
  }
  private now() {
    return this.ports.now?.() ?? Date.now();
  }
  private async set(record: AssistantRecoveryRecord) {
    record = { ...record, updatedAt: this.now() };
    await this.store.transaction(() => writeAssistantRecovery(this.store, record), "critical");
    await this.ports.onState(record);
    return record;
  }
  async recover(input: RecoveryInput): Promise<AssistantRecoveryResult> {
    const task = this.tail.then(() => this.recoverOnce(input));
    this.tail = task.catch(() => undefined);
    return task;
  }
  private async recoverOnce(input: RecoveryInput): Promise<AssistantRecoveryResult> {
    await this.ready;
    input.signal.throwIfAborted();
    await input.recheck();
    if (!(await this.ports.allowed(input.jobId)))
      throw new Error("Chief worker recovery is paused.");
    const source = await this.tasks.captureAssistantRecovery(input),
      old = await readAssistantRecovery(this.store, source.taskId);
    if (old) {
      if (old.state === "unknown" || ["cancelling", "retrying"].includes(old.state))
        return { taskId: old.taskId, state: "unknown", message: old.message };
      const record = await this.set({
        ...old,
        state: "escalated",
        message:
          "This task already used its one automatic recovery. Owner review is required; the current worker was not cancelled.",
      });
      return { taskId: record.taskId, state: "escalated", message: record.message };
    }
    const operationId = `assistant-worker-recovery-${createHash("sha256").update(`${source.goalId}:${source.taskId}`).digest("hex")}`;
    let record: AssistantRecoveryRecord = {
      taskId: source.taskId,
      operationId,
      source,
      state: "cancelling",
      startedAt: this.now(),
      updatedAt: this.now(),
      message: "Stopping the exact stalled worker before one bounded retry.",
      launchRequestId: `${operationId}-launch`,
    };
    await this.store.transaction(async () => {
      if (await readAssistantRecovery(this.store, source.taskId))
        throw new Error("Worker recovery already has a durable receipt.");
      await writeAssistantRecovery(this.store, record);
    }, "critical");
    try {
      const task = JSON.parse(source.taskValue) as HostTask;
      await this.ports.reserve?.({
        jobId: source.jobId,
        requestId: `${operationId}:handoff`,
        estimatedTokens: Math.max(1000, Math.ceil(task.prompt.length / 3) + 8000),
        phase: "handoff",
      });
      const recover = () =>
        this.tasks.recoverAssistantWorker({
          source,
          operationId,
          signal: input.signal,
          recheck: async () => {
            input.signal.throwIfAborted();
            await input.recheck();
            if (!(await this.ports.allowed(source.jobId)))
              throw new Error("Chief recovery authority changed.");
          },
          phase: async () => {
            record = await this.set({
              ...record,
              state: "retrying",
              message: "The original worker retired. Queueing its retained task once.",
            });
          },
        });
      const queued = await (this.ports.effect ? this.ports.effect(record, recover) : recover());
      record = await this.set({
        ...record,
        state: "queued",
        queuedTaskValue: JSON.stringify(queued),
        message:
          "The stalled worker retired and its same task was queued once with retained work. Normal scheduler and approval gates still apply.",
      });
      return { taskId: record.taskId, state: "queued", message: record.message };
    } catch (error) {
      record = await this.set({
        ...record,
        state: "unknown",
        message: `Automatic worker recovery needs owner inspection. No replay will be issued: ${String(error).slice(0, 600)}`,
      });
      return { taskId: record.taskId, state: "unknown", message: record.message };
    }
  }
  private async admitLaunch(
    task: HostTask,
    stage?: { sessionId: string; runId?: string; phase: "command" | "provider" },
  ) {
    await this.ready;
    const record = await readAssistantRecovery(this.store, task.id);
    if (!record || record.state === "ownerResolved") return;
    if (
      record.state !== "queued" &&
      !(
        record.state === "running" &&
        stage &&
        stage.sessionId === record.launchedSessionId &&
        stage.runId === record.launchedRunId
      )
    )
      throw new Error(
        "Inspect the unresolved assistant worker recovery before retrying this task.",
      );
    try {
      if (
        !(await this.ports.allowed(record.source.jobId)) ||
        assistantRecoveryIdentity(task) !== record.source.identity
      )
        throw new Error("The saved Chief authority or task execution source changed.");
      const row = await this.store.db
          .prepare("SELECT value FROM assistant_jobs WHERE id=? AND deleted_at IS NULL")
          .get(record.source.jobId),
        goalRow = await this.store.db
          .prepare("SELECT value FROM goals WHERE id=?")
          .get(record.source.goalId);
      if (!row || !goalRow) throw new Error("The original assistant job or goal is unavailable.");
      const job = JSON.parse(row.value) as AssistantJob,
        goal = JSON.parse(goalRow.value);
      assertAssistantGoalProjects(job, goal);
      if (
        task.goalId !== goal.id ||
        !goal.taskIds.includes(task.id) ||
        !assistantJobProjectIds(job).includes(task.projectId) ||
        ["paused", "cancelled", "done", "failed"].includes(job.status) ||
        ["cancelled", "done"].includes(goal.status)
      )
        throw new Error("The original canonical task is no longer active for this job.");
      if (stage?.phase === "provider" && stage.runId && !record.launchStarted)
        await this.store.transaction(
          () =>
            writeAssistantRecovery(this.store, {
              ...record,
              launchStarted: true,
              updatedAt: this.now(),
            }),
          "critical",
        );
    } catch (error) {
      await this.set({
        ...record,
        state: "unknown",
        message: `The queued automatic retry was fenced before dispatch: ${String(error).slice(0, 600)}`,
      });
      throw error;
    }
  }
}
