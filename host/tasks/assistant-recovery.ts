import {
  assistantRecoveryIdentity,
  readAssistantRecovery,
  writeAssistantRecovery,
  type AssistantRecoverySource,
} from "../assistant/work/assistant-worker-recovery";
import { assistantJobSessionBelongs } from "../assistant/work/assistant-job-scope";
import type { AssistantJob } from "../../src/shared/model/host-contracts/assistant";

import { type HostTask } from "../../src/features/tasks/model/hostTasks";
import { sessionRunState } from "../sessions/sessionRuns";
import { RETRY_FEEDBACK_LIMIT } from "./constants";
import { OWNER_NOTICE_LIMIT } from "./constants";
import { ownerNotice } from "./review-outcomes";
import type { TaskContext } from "./context";
export async function captureAssistantRecovery(
  context: TaskContext,
  input: {
    jobId: string;
    sessionId: string;
    source: {
      projectId: string;
      executionCwd: string;
      authorityGeneration?: number;
      runId?: string;
    };
  },
): Promise<AssistantRecoverySource> {
  await context.ready;
  const matches = (await context.list(input.source.projectId)).filter(
    (task) =>
      task.goalId === `assistant-${input.jobId}` &&
      task.sessionId === input.sessionId &&
      task.runId === input.source.runId &&
      task.status === "running",
  );
  if (matches.length !== 1)
    throw new Error("Recovery supports only this assistant job's exact current worker.");
  const task = matches[0],
    record = await context.store.session(input.sessionId),
    row = await context.store.db
      .prepare("SELECT value FROM assistant_jobs WHERE id=? AND deleted_at IS NULL")
      .get(input.jobId);
  if (
    task.maxRunMinutes > 0 &&
    (
      await sessionRunState(
        context.store,
        { ...task, startedAt: task.startedAt ?? task.createdAt },
        task.maxRunMinutes,
        context.now(),
      )
    ).state === "overLimit"
  )
    throw new Error("The original worker reached its time limit; recovery cannot bypass it.");
  if (
    !row ||
    !(await assistantJobSessionBelongs(
      context.store,
      JSON.parse(row.value) as AssistantJob,
      input.sessionId,
      record.projectId,
    )) ||
    !input.source.runId ||
    record.status !== "running" ||
    record.runId !== input.source.runId ||
    record.authorityGeneration !== input.source.authorityGeneration ||
    (record.session.worktreeCwd ?? record.session.cwd) !== input.source.executionCwd
  )
    throw new Error("The original recovery worker source changed or already finished.");
  if (
    task.crewRunId ||
    task.crewDefinitionId ||
    task.reviewer ||
    task.needsInput ||
    task.error ||
    task.artifactDeliveryPending ||
    record.session.pendingQuestion ||
    record.session.pendingSwitch ||
    record.session.queuedMessages?.length ||
    record.session.blocks.some(
      (block) => block.draft || (!!block.approval && !block.approval.decided),
    )
  )
    throw new Error(
      "Preserve owner questions, approvals, drafts, reviewer and delivery ownership before worker recovery.",
    );
  const profile = await context.store.db
      .prepare("SELECT value FROM assistant_profile WHERE id='profile'")
      .get(),
    stall = profile ? Number(JSON.parse(profile.value).stallMinutes) : 15,
    activity = record.runActivity;
  if (
    !activity ||
    activity.runId !== record.runId ||
    !Number.isSafeInteger(activity.lastActivityAt) ||
    activity.lastActivityAt < 0 ||
    activity.lastActivityAt > context.now() ||
    context.now() - activity.lastActivityAt < Math.max(5, stall) * 60000
  )
    throw new Error(
      "The current worker has no confirmed stalled activity; let its canonical task settle first.",
    );
  return {
    taskId: task.id,
    jobId: input.jobId,
    goalId: task.goalId!,
    sessionId: input.sessionId,
    runId: input.source.runId,
    projectId: task.projectId,
    executionCwd: input.source.executionCwd,
    authorityGeneration: input.source.authorityGeneration,
    taskValue: (await context.taskValue(task.id))!,
    identity: assistantRecoveryIdentity(task),
  };
}

export async function waitAssistantRetirement(
  context: TaskContext,
  sessionId: string,
  runId: string,
  signal: AbortSignal,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort!: () => void;
  try {
    await Promise.race([
      context.waitRecoveryRun!(sessionId, runId),
      new Promise<never>((_, reject) => {
        abort = () =>
          reject(new Error("Worker retirement was interrupted; its outcome remains unknown."));
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        timer = setTimeout(
          () => reject(new Error("Original worker retirement remains unconfirmed.")),
          20000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

export async function recoverAssistantWorker(
  context: TaskContext,
  input: {
    source: AssistantRecoverySource;
    operationId: string;
    signal: AbortSignal;
    recheck: () => Promise<void>;
    phase: () => Promise<void>;
  },
): Promise<HostTask> {
  await context.ready;
  const source = input.source;
  if (
    !context.admitCommand ||
    !context.waitRecoveryRun ||
    !context.retireRecoveryWriter ||
    context.continuingSessions.has(source.taskId)
  )
    throw new Error("Guarded recovery is unavailable or already pending.");
  context.continuingSessions.add(source.taskId);
  let expected = source.taskValue;
  const check = async () => {
    input.signal.throwIfAborted();
    await input.recheck();
    const task = await context.unchangedTask(source.taskId, expected);
    if (
      context.closing ||
      !task ||
      !["running", "blocked"].includes(task.status) ||
      task.goalId !== source.goalId ||
      context.pausedGoals.has(source.goalId) ||
      assistantRecoveryIdentity(task) !== source.identity
    )
      throw new Error("The canonical recovery task was stopped, paused or changed.");
    if (
      task.maxRunMinutes > 0 &&
      (
        await sessionRunState(
          context.store,
          { ...task, startedAt: task.startedAt ?? task.createdAt },
          task.maxRunMinutes,
          context.now(),
        )
      ).state === "overLimit"
    )
      throw new Error("The original worker reached its time limit; recovery cannot bypass it.");
    const reason = await context.budgetReason(task, true);
    if (reason) throw new Error(reason);
    const record = await context.store.session(source.sessionId),
      session = record.session;
    if (
      record.runId !== source.runId ||
      record.projectId !== source.projectId ||
      record.authorityGeneration !== source.authorityGeneration ||
      (session.worktreeCwd ?? session.cwd) !== source.executionCwd ||
      session.harness !== task.harness ||
      session.model !== task.model ||
      session.runtimeMode !== task.runtimeMode ||
      (session.providerAccountId ?? "default") !== (task.providerAccountId ?? "default") ||
      JSON.stringify(session.modelSettings) !== JSON.stringify(task.modelSettings) ||
      session.pendingQuestion ||
      session.pendingSwitch ||
      session.queuedMessages?.length ||
      session.blocks.some((block) => block.draft || (!!block.approval && !block.approval.decided))
    )
      throw new Error("The original worker source or pending owner input changed.");
    input.signal.throwIfAborted();
  };
  try {
    await check();
    await context.admitCommand(
      {
        check: async (stage) => {
          await check();
          if (
            stage.sessionId !== source.sessionId ||
            (stage.phase === "provider" && stage.runId !== source.runId)
          )
            throw new Error("A replacement worker cannot be cancelled.");
        },
      },
      () =>
        context.engine.command({
          type: "cancel",
          commandId: `${input.operationId}-cancel`,
          sessionId: source.sessionId,
          runId: source.runId,
          authorityGeneration: source.authorityGeneration,
        }),
    );
    await context.waitAssistantRetirement(source.sessionId, source.runId, input.signal);
    await check();
    return await context.retireRecoveryWriter!(
      source.sessionId,
      async () => {
        await check();
        const task = (await context.find(source.taskId))!;
        await context.block(
          task,
          "The assistant retired a stalled worker for one bounded recovery.",
          context.now(),
        );
        expected = (await context.taskValue(task.id))!;
        await input.phase();
        await check();
        context.assistantRecoveryQueue.add(task.id);
        try {
          const queued = await context.move(task.id, "queued");
          return await context.write({
            ...queued,
            ownerNotices: [
              ...(task.ownerNotices ?? []),
              ownerNotice(
                "auto_continued",
                "The assistant stopped this stalled worker and queued its retained task once. Earlier worker history remains available.",
                context.now(),
                input.operationId,
              ),
            ].slice(-OWNER_NOTICE_LIMIT),
            retryFeedback: [
              queued.retryFeedback,
              "Continue the retained work from the previous stalled worker; inspect its transcript and existing checkout before changing anything.",
            ]
              .filter(Boolean)
              .join("\n\n")
              .slice(-RETRY_FEEDBACK_LIMIT),
            updatedAt: context.now(),
          });
        } finally {
          context.assistantRecoveryQueue.delete(task.id);
        }
      },
      check,
    );
  } finally {
    context.continuingSessions.delete(source.taskId);
  }
}

export async function resolveAssistantRecoveryForOwner(
  context: TaskContext,
  task: HostTask,
): Promise<void> {
  if (context.assistantRecoveryQueue.has(task.id)) return;
  const record = await readAssistantRecovery(context.store, task.id);
  if (!record || ["ownerResolved", "completed"].includes(record.state)) return;
  const targetSession = record.launchedSessionId ?? record.source.sessionId,
    targetRun = record.launchedRunId ?? record.source.runId;
  if (task.sessionId && (task.sessionId !== targetSession || task.runId !== targetRun)) return;
  const source = {
      ...record!.source,
      ...(record!.launchedSessionId
        ? {
            sessionId: record!.launchedSessionId,
            runId: record!.launchedRunId!,
            authorityGeneration: record!.launchedAuthorityGeneration,
          }
        : {}),
    },
    expected = await context.taskValue(task.id);
  const check = async () => {
    const current = await context.store.session(source.sessionId);
    if (
      context.closing ||
      !context.activeRecoveryRun ||
      !context.retireRecoveryWriter ||
      context.activeRecoveryRun(source.sessionId) ||
      current.runId !== source.runId ||
      current.projectId !== source.projectId ||
      current.authorityGeneration !== source.authorityGeneration ||
      (current.session.worktreeCwd ?? current.session.cwd) !== source.executionCwd ||
      !(await context.unchangedTask(task.id, expected))
    )
      throw new Error(
        "Inspect and stop the exact original recovery worker before using Retry. Its replacement cannot be retired through this receipt.",
      );
  };
  await check();
  await context.retireRecoveryWriter!(
    source.sessionId,
    async () => {
      await check();
      await context.store.transaction(
        () =>
          writeAssistantRecovery(context.store, {
            ...record!,
            state: "ownerResolved",
            updatedAt: context.now(),
            ownerResolution: {
              at: context.now(),
              priorState: record!.state,
              priorMessage: record!.message,
            },
            message:
              "The owner inspected the recovery and explicitly retried after original provider retirement.",
          }),
        "critical",
      );
    },
    check,
  );
}
