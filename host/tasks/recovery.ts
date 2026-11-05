import { randomUUID } from "node:crypto";

import {
  MAX_TASK_REVIEW_FAILURES,
  TASK_INPUT_REQUIRED,
  taskReviewFailureCount,
  taskRequiresInstructions,
  hasUnmergedBranch,
  NO_VERDICT,
  parseReviewVerdict,
  type HostTask,
} from "../../src/features/tasks/model/hostTasks";
import { hasPendingApproval } from "../../src/features/sessions/model/session";
import {
  HOST_INTERRUPTED,
  errorMessage,
  launchSessionRun,
  sessionRunState,
} from "../sessions/sessionRuns";
import { hasShellPhysicalOwner } from "../execution/shell-ownership";
import { RETRY_FEEDBACK_LIMIT } from "./constants";
import { MAX_REPAIR_ATTEMPTS } from "./constants";
import { workerPrompt } from "./prompts";
import { OWNER_NOTICE_LIMIT } from "./constants";
import { MAX_RUNTIME_RETRIES } from "./constants";
import { MAX_QUESTION_CONTINUATIONS } from "./constants";
import { RUNTIME_RETRY_NOTICE } from "./constants";
import { QUESTION_NOTICE } from "./constants";
import { ownerNotice } from "./review-outcomes";
import { completableWithFindings } from "./review-outcomes";
import { completionNotices } from "./review-outcomes";
import { runtimeRetryCount } from "./review-outcomes";
import { questionContinuationCount } from "./review-outcomes";
import type { TaskContext } from "./context";
export async function takeoverGoalActive(context: TaskContext, task: HostTask): Promise<boolean> {
  if (!task.goalId) return true;
  if (context.pausedGoals.has(task.goalId)) return false;
  if (
    !(await context.store.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='goals'")
      .get())
  )
    return true;
  const row = await context.store.db.prepare("SELECT value FROM goals WHERE id=?").get(task.goalId);
  return !row || JSON.parse(String(row.value)).status !== "cancelled";
}

export async function queueTakeover(
  context: TaskContext,
  task: HostTask,
  now: number,
  reviewed?: HostTask,
  generation?: number,
): Promise<HostTask> {
  return await context.write(
    {
      ...task,
      status: "queued",
      blockedTakeover: {
        at: now,
        previousSessionId: task.sessionId,
        blocker: task.error ?? "Verification failed.",
      },
      retryFeedback: await context.retryFeedback(task),
      review: true,
      sessionId: undefined,
      runId: undefined,
      reviewer: undefined,
      verification: undefined,
      reviewOnly: undefined,
      repairStop: undefined,
      error: undefined,
      needsInput: undefined,
      completedAt: undefined,
      updatedAt: now,
    },
    undefined,
    reviewed,
    generation,
  );
}

export async function block(
  context: TaskContext,
  task: HostTask,
  error: string,
  now: number,
  retainReviewer = false,
): Promise<HostTask> {
  if (
    task.workspaceActivityId &&
    context.managed &&
    !context.jobs.has(task.id) &&
    !(await hasShellPhysicalOwner(context.store, "task", task.id))
  ) {
    const run = task.reviewer ?? task;
    if (
      (
        await sessionRunState(
          context.store,
          { ...run, startedAt: run.startedAt ?? task.createdAt },
          0,
          now,
        )
      ).state === "finished"
    ) {
      await context.stopWorkspaceActivity(task);
      task = { ...task, workspaceActivityId: undefined };
    }
  }
  return await context.write({
    ...task,
    status: "blocked",
    error,
    needsInput: taskRequiresInstructions({ ...task, status: "blocked", error }) || undefined,
    reviewer: retainReviewer ? task.reviewer : undefined,
    completedAt: now,
    updatedAt: now,
  });
}

export async function repairOrBlock(
  context: TaskContext,
  task: HostTask,
  error: string,
  now: number,
): Promise<HostTask> {
  const canFinish = completableWithFindings(task);
  if (task.blockedTakeover && !task.continueUntilDone) {
    const stop = {
      reason: "no_progress" as const,
      message:
        "The independent recovery agent could not complete this task. Provide the missing resource or update the instructions using the worker's concrete request.",
    };
    return canFinish
      ? await context.completeWithFindings(task, error, now, stop.reason)
      : await context.block({ ...task, repairStop: stop }, error, now);
  }
  if (
    !task.continueUntilDone &&
    taskReviewFailureCount(task) >= MAX_TASK_REVIEW_FAILURES &&
    !task.repairStop
  )
    task = { ...task, repairStop: { reason: "limit", message: TASK_INPUT_REQUIRED } };
  if (task.reviewOnly && !task.repairStop)
    task = { ...task, repairStop: { reason: "no_progress", message: TASK_INPUT_REQUIRED } };
  const attempts = task.repairAttempts ?? 0;
  if (task.reviewOnly) return await context.block(task, error, now);
  if (task.repairStop)
    return canFinish
      ? await context.completeWithFindings(task, error, now, task.repairStop.reason)
      : await context.block(task, error, now);
  // Crew assignments keep their coordinator-owned correction policy.
  const corrects =
    !task.crewRunId ||
    task.continueUntilDone ||
    task.autoMerge ||
    task.goalId ||
    task.source === "goal" ||
    task.source === "steward";
  const exhausted = !task.continueUntilDone && attempts >= MAX_REPAIR_ATTEMPTS;
  if (!corrects || exhausted) {
    if (exhausted && canFinish)
      return await context.completeWithFindings(task, error, now, "limit");
    return await context.block(
      {
        ...task,
        ...(exhausted
          ? {
              repairStop: {
                reason: "limit" as const,
                message:
                  "Automatic correction limit reached. Inspect the attempt history and remaining findings before retrying.",
              },
            }
          : {}),
      },
      error,
      now,
    );
  }
  const failed = { ...task, error };
  return await context.write({
    ...task,
    status: "queued",
    retryFeedback: await context.retryFeedback(failed),
    repairAttempts: attempts + 1,
    repairNote: error,
    sessionId: undefined,
    runId: undefined,
    startedAt: undefined,
    completedAt: undefined,
    error: undefined,
    reviewer: undefined,
    verification: undefined,
    needsInput: undefined,
    updatedAt: now,
  });
}

export async function completeWithFindings(
  context: TaskContext,
  task: HostTask,
  error: string,
  now: number,
  reason: "external" | "no_progress" | "limit",
): Promise<HostTask> {
  const notices = completionNotices(task, error, now, reason);
  const diffStat = await context.diffStat(task);
  return await context.enterReview({
    ...task,
    error: undefined,
    repairStop: undefined,
    repairNote: error,
    completedWithFindings: true,
    ownerNotices: [...(task.ownerNotices ?? []), ...notices].slice(-OWNER_NOTICE_LIMIT),
    ...(hasUnmergedBranch(task) || task.workspaceId ? { deliveryApprovalRequired: true } : {}),
    ...(task.autoMerge || task.deliveryRequested
      ? {
          autoMerge: undefined,
          deliveryRequested: undefined,
          deliveryState: task.merged ? ("merged" as const) : ("awaitingOwner" as const),
        }
      : {}),
    diffStat,
  });
}

export async function canResumeAfterHostStop(
  context: TaskContext,
  run: {
    sessionId?: string;
    runId?: string;
    error?: string;
  },
): Promise<boolean> {
  if (run.error && run.error !== HOST_INTERRUPTED) return false;
  try {
    const session = await context.store.session(run.sessionId ?? "");
    if (session.status !== "interrupted") return false;
    if (run.runId && session.runId !== run.runId) return false;
    const last = session.session.blocks.at(-1);
    const note = last?.role === "system" ? last.text.trim() : "";
    return (
      note === "Host stopped. This turn was interrupted." ||
      note === "Host restarted. This turn was interrupted; inspect its work before continuing."
    );
  } catch {
    return false;
  }
}

export async function requeueInterrupted(
  context: TaskContext,
  task: HostTask,
  now: number,
): Promise<HostTask> {
  // Retain the session, branch, working copy and any previous check feedback.
  // The ordinary scheduler still enforces dependencies, concurrency and limits.
  return await context.write({
    ...task,
    status: "queued",
    error: undefined,
    completedAt: undefined,
    needsInput: undefined,
    updatedAt: now,
  });
}

export async function retryFeedback(
  context: TaskContext,
  task: HostTask,
): Promise<string | undefined> {
  const { command, review } = task.verification ?? {};
  const failedCommand = command && (command.timedOut || command.exitCode !== 0);
  if (review?.verdict !== "fail" && !failedCommand) return task.retryFeedback;
  const parts = [task.error ?? "Previous verification failed."];
  if (failedCommand) {
    parts.push(`Check command: ${task.verifyCommand ?? ""}`, command.output);
  }
  const acceptance = task.verification?.acceptance;
  if (acceptance) {
    parts.push(
      "Recorded acceptance evidence from the previous result. Inspect current files before reusing it:",
      JSON.stringify({
        checkedAt: acceptance.checkedAt,
        sessionId: acceptance.sessionId,
        criteria: [...acceptance.criteria]
          .sort((a, b) => Number(a.verdict === "verified") - Number(b.verdict === "verified"))
          .slice(0, 4)
          .map((entry) => ({
            criterionIndex: entry.criterionIndex,
            criterion: entry.criterion.slice(0, 200),
            verdict: entry.verdict,
            evidence: entry.evidence.slice(0, 2).map((reference) => reference.slice(0, 200)),
            note: entry.note?.slice(0, 200),
          })),
        omittedCriteria: Math.max(0, acceptance.criteria.length - 4),
      }),
    );
  }
  if (review?.verdict === "fail") {
    parts.push(`Reviewer finding: ${review.note}`);
    const structured = (task.reviewNotes ?? []).filter(
      (note) => note.kind === "finding" && note.resolvedAt === undefined,
    );
    if (structured.length && structured.every((note) => !note.details))
      return parts.join("\n\n").slice(0, RETRY_FEEDBACK_LIMIT);
    try {
      const blocks = (await context.store.session(review.sessionId)).session.blocks;
      const lastUser = blocks.findLastIndex((block) => block.role === "user");
      const replies = blocks
        .slice(lastUser + 1)
        .filter((block) => block.role === "assistant" && block.text.trim());
      const verdictReply = replies.findLast(
        (block) => parseReviewVerdict(block.text).note !== NO_VERDICT,
      );
      const details = verdictReply?.text ?? replies.at(-1)?.text;
      if (details) parts.push(details);
    } catch {
      // An unavailable review session must not prevent retrying its finding.
    }
  }
  return parts.join("\n\n").slice(0, RETRY_FEEDBACK_LIMIT);
}

export async function resumeInterrupted(
  context: TaskContext,
  task: HostTask,
): Promise<{
  sessionId?: string;
  runId?: string;
  error?: string;
  deferred?: boolean;
}> {
  try {
    const session = (await context.store.session(task.sessionId!)).session;
    // A queued recovery can be edited, or its worktree recreated elsewhere.
    // Never resume a conversation configured for a different folder or model.
    if (
      session.cwd !== (task.worktreeCwd ?? (await context.store.project(task.projectId)).cwd) ||
      session.harness !== task.harness ||
      (session.providerAccountId ?? "default") !== (task.providerAccountId ?? "default") ||
      session.model !== task.model ||
      session.runtimeMode !== task.runtimeMode ||
      JSON.stringify(session.modelSettings) !== JSON.stringify(task.modelSettings)
    ) {
      return await launchSessionRun(
        context.store,
        context.engine,
        {
          ...task,
          ...(task.isolate === false ? { workspaceMode: "current" as const } : {}),
          author: { kind: "task", id: task.id, name: task.title, reason: "kickoff" },
          prompt: workerPrompt(task, (await context.store.project(task.projectId)).cwd),
        },
        () => context.goalExecutionAllowed(task.goalId),
      );
    }
    const project = await context.store.project(task.projectId);
    if (!(await context.goalExecutionAllowed(task.goalId))) return { deferred: true };
    const receipt = await context.taskMessage(task, "recovery", () =>
      context.engine.command({
        type: "send",
        commandId: randomUUID(),
        sessionId: task.sessionId!,
        text: [
          "The host stopped before this task finished. Continue this task from the existing conversation and working copy. Inspect the current changes and the last tool results first; keep completed work and do not start over. Completion still requires the original task's checks and review.",
          "",
          workerPrompt(task, project.cwd),
        ].join("\n"),
      }),
    );
    return {
      sessionId: task.sessionId,
      runId: receipt.runId,
    };
  } catch (error) {
    return { sessionId: task.sessionId, error: errorMessage(error) };
  }
}

export async function retryTransientFailure(
  context: TaskContext,
  task: HostTask,
  error: string,
  now: number,
): Promise<void> {
  const attempt = runtimeRetryCount(task) + 1;
  const note = `The previous run stopped with a runtime error (${error.slice(0, 500)}). Continue the same task from the existing work in the checkout; do not restart finished parts.`;
  await context.write({
    ...task,
    status: "queued",
    retryFeedback: [task.retryFeedback, note]
      .filter(Boolean)
      .join("\n\n")
      .slice(-RETRY_FEEDBACK_LIMIT),
    ownerNotices: [
      ...(task.ownerNotices ?? []),
      ownerNotice(
        "auto_continued",
        `Retried automatically after a runtime error (${attempt}/${MAX_RUNTIME_RETRIES}).`,
        now,
        `${RUNTIME_RETRY_NOTICE}${randomUUID()}`,
      ),
    ].slice(-OWNER_NOTICE_LIMIT),
    sessionId: undefined,
    runId: undefined,
    startedAt: undefined,
    completedAt: undefined,
    error: undefined,
    reviewer: undefined,
    verification: undefined,
    needsInput: undefined,
    updatedAt: now,
  });
}

export async function continueUnansweredQuestion(
  context: TaskContext,
  task: HostTask,
  now: number,
): Promise<boolean> {
  if (task.crewRunId || questionContinuationCount(task) >= MAX_QUESTION_CONTINUATIONS) return false;
  try {
    // Delegated assistant questions retain the exact occurrence for Chief or
    // owner review. Revoking delegation must never fall back to auto-skip.
    if (task.goalId?.startsWith("assistant-")) {
      const table = await context.store.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='assistant_jobs'")
        .get();
      if (
        table &&
        (await context.store.db
          .prepare("SELECT id FROM assistant_jobs WHERE id=?")
          .get(task.goalId.slice("assistant-".length)))
      )
        return false;
    }
    const session = await context.store.session(task.sessionId ?? "");
    const question = session.session.pendingQuestion;
    if (
      session.status !== "running" ||
      session.runId !== task.runId ||
      !question?.questions.length ||
      hasPendingApproval(session.session.blocks) ||
      ["sending", "queued", "unknown"].includes(question.delivery ?? "") ||
      (question.dismissAction !== undefined && question.dismissAction !== "skip")
    )
      return false;
    const asked = question.questions
      .map((entry) => entry.prompt)
      .join(" ")
      .trim();
    await context.taskMessage(task, "question-continuation", () =>
      context.engine.command({
        type: "answer",
        commandId: randomUUID(),
        sessionId: task.sessionId!,
        runId: session.runId,
        requestId: question.requestId,
        reply: { kind: "skipped" },
      }),
    );
    await context.write({
      ...task,
      needsInput: undefined,
      ownerNotices: [
        ...(task.ownerNotices ?? []),
        ownerNotice(
          "info",
          `The worker asked "${asked.slice(0, 160) || "a question"}" and continued with its own judgment.`,
          now,
          `${QUESTION_NOTICE}${randomUUID()}`,
        ),
      ].slice(-OWNER_NOTICE_LIMIT),
      updatedAt: now,
    });
    return true;
  } catch {
    return false;
  }
}
