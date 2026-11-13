import { randomUUID } from "node:crypto";
import { z } from "zod";

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
import { newRequestId } from "../../src/shared/lib/id/requestId";
import { truncateGraphemes } from "../../src/shared/lib/text/truncate";
import { assertTaskWorkRetired } from "../work/session-adapter";

const repairAdvisorReply = z.object({
  runId: z.string().min(1),
  status: z.enum(["queued", "running", "needsInput", "succeeded", "failed", "cancelled"]),
  result: z.string().optional(),
});

/** A real agents.* child must finish before a correction can be admitted. */
export async function consultRepairAdvisor(context: TaskContext, task: HostTask) {
  if (!context.repairDelegation)
    throw new Error("Task repair advisor delegation is unavailable on this host.");
  if (!task.repairAdvisor?.sessionId)
    throw new Error("Task repair advisor needs the retained worker or reviewer session.");
  const caller = { sessionId: task.repairAdvisor!.sessionId, projectId: task.projectId };
  const locate = async () => undefined;
  const pending = task.repairAdvisor!;
  const consultation = {
    requestId: pending.requestId,
    question:
      "Inspect these task findings and recommend the smallest in-scope correction. Read only; preserve owner gates. This task has one automatic repair.",
    context: pending.findings,
  };
  const started = repairAdvisorReply.parse(
    await (context.repairDelegation.consultTaskRepair
      ? context.repairDelegation.consultTaskRepair(task.id, consultation, caller, locate)
      : context.repairDelegation.call("agents.consult", consultation, caller, locate)),
  );
  const finished =
    started.status === "running"
      ? repairAdvisorReply.parse(
          await context.repairDelegation.call(
            "agents.wait",
            { runId: started.runId, timeoutSeconds: 60 },
            caller,
            locate,
          ),
        )
      : started;
  if (["running", "queued", "needsInput"].includes(finished.status)) return undefined;
  if (
    finished.runId !== started.runId ||
    finished.status !== "succeeded" ||
    !finished.result?.trim()
  )
    throw new Error(
      `Task repair advisor ${started.runId} has no completed advice (${finished.status}). Inspect the advisor session before retrying.`,
    );
  return `Advisor consultation ${finished.runId} (read-only advice; verify before acting):\n${truncateGraphemes(finished.result, 4000)}`;
}

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
  return repairOrBlock(context, task, task.error ?? "Verification failed.", now, {
    reviewed,
    generation,
  });
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
  takeover?: { reviewed?: HostTask; generation?: number },
  runtimeRetry?: { notice: ReturnType<typeof ownerNotice> },
): Promise<HostTask> {
  try {
    await assertTaskWorkRetired(context.store, task.id);
  } catch {
    // Preserve the failed verdict and original reason until physical retirement
    // is known. A new advisor or worker must not bypass an unknown writer.
    return context.block(task, error, now);
  }
  const canFinish = completableWithFindings(task);
  if (task.blockedTakeover) {
    const stop = {
      reason: "no_progress" as const,
      message:
        "The independent recovery agent could not complete this task. Provide the missing resource or update the instructions using the worker's concrete request.",
    };
    return canFinish
      ? await context.completeWithFindings(task, error, now, stop.reason)
      : await context.block({ ...task, repairStop: stop }, error, now);
  }
  if (taskReviewFailureCount(task) >= MAX_TASK_REVIEW_FAILURES && !task.repairStop)
    task = { ...task, repairStop: { reason: "limit", message: TASK_INPUT_REQUIRED } };
  if (task.reviewOnly && !task.repairStop)
    task = { ...task, repairStop: { reason: "no_progress", message: TASK_INPUT_REQUIRED } };
  const attempts = task.repairAttempts ?? 0;
  if (task.reviewOnly) return await context.block(task, error, now);
  if (task.repairStop)
    return canFinish
      ? await context.completeWithFindings(task, error, now, task.repairStop.reason)
      : await context.block(task, error, now);
  // Every reviewed task, crew assignments included, corrects in place within
  // the repair limit. Blocking on the first FAIL left a dead card per review.
  const exhausted = attempts >= MAX_REPAIR_ATTEMPTS;
  if (exhausted) {
    if (canFinish) return await context.completeWithFindings(task, error, now, "limit");
    return await context.block(
      {
        ...task,
        repairStop: {
          reason: "limit" as const,
          message:
            "Automatic correction limit reached. Inspect the attempt history and remaining findings before retrying.",
        },
      },
      error,
      now,
    );
  }
  const fingerprint = JSON.stringify([
    task.prompt,
    task.title,
    task.projectId,
    task.sessionId,
    task.harness,
    task.model,
    task.modelSettings,
    task.providerAccountId,
    task.runtimeMode,
    task.worktreeCwd,
    task.reviewNotes,
    task.repairAttempts,
  ]);
  if (task.repairAdvisor && task.repairAdvisor.fingerprint !== fingerprint)
    return context.block(
      { ...task, repairAdvisor: undefined },
      "Task instructions changed during advisor consultation. Restart explicitly.",
      now,
    );
  const original = await context.taskValue(task.id);
  const failed = { ...task, error };
  const feedback = task.repairAdvisor?.feedback ?? (await context.retryFeedback(failed));
  if (context.closing || !(await context.goalExecutionAllowed(task.goalId))) return task;
  const budget = await context.budgetReason(task, true);
  if (budget) return await context.budgetBlock(task, budget, now);
  if (!task.repairAdvisor) {
    const findings = truncateGraphemes(
      [
        feedback,
        ...(task.reviewNotes ?? [])
          .filter((note) => note.kind === "finding" && note.resolvedAt === undefined)
          .map((note) => `${note.category}: ${note.finding}`),
        task.prompt,
      ]
        .filter(Boolean)
        .join("\n\n"),
      12_000,
    );
    const saved = await context.transaction(async () => {
      if (!(await context.unchangedTask(task.id, original))) return undefined;
      const saved = await context.write(
        {
          ...task,
          status: "queued",
          repairAdvisor: {
            requestId: `task-repair:${randomUUID()}`,
            sessionId: task.sessionId ?? task.verification?.review?.sessionId ?? "",
            findings,
            feedback: feedback ?? error,
            error,
            fingerprint,
            ...(runtimeRetry ? { runtimeRetryNotice: runtimeRetry.notice } : {}),
            ...(takeover ? { takeover: true } : {}),
          },
          error: undefined,
          needsInput: undefined,
          updatedAt: now,
        },
        undefined,
        takeover?.reviewed,
        takeover?.generation,
      );
      if (takeover) {
        // Admission above checked the owner's snapshot. Our durable advisor write
        // advances the generation; subsequent admission must fence that exact row.
        takeover = {
          reviewed: saved,
          generation: Number(
            (
              await context.store.db
                .prepare("SELECT generation FROM task_admission_generation WHERE id=?")
                .get(task.id)
            )?.generation ?? 0,
          ),
        };
      }
      return saved;
    });
    if (!saved) return (await context.find(task.id)) ?? task;
    task = saved;
  }
  const expected = await context.taskValue(task.id);
  let advice: string | undefined;
  try {
    advice = await consultRepairAdvisor(context, task);
  } catch (advisorError) {
    return await context.transaction(async () => {
      if (!(await context.unchangedTask(task.id, expected)))
        return (await context.find(task.id)) ?? task;
      return context.block(
        {
          ...task,
          repairStop: { reason: "external", message: errorMessage(advisorError) },
        },
        errorMessage(advisorError),
        context.now(),
      );
    });
  }
  if (!advice) return (await context.find(task.id)) ?? task;
  return await context.transaction(async () => {
    if (!(await context.unchangedTask(task.id, expected)))
      return (await context.find(task.id)) ?? task;
    if (context.closing || !(await context.goalExecutionAllowed(task.goalId))) return task;
    const budget = await context.budgetReason(task, true);
    if (budget) return context.budgetBlock(task, budget, context.now());
    return context.write(
      {
        ...task,
        ...(task.repairAdvisor?.takeover
          ? {
              blockedTakeover: { at: now, previousSessionId: task.sessionId, blocker: error },
              review: true,
              reviewOnly: undefined,
            }
          : {}),
        status: "queued",
        retryFeedback: [
          truncateGraphemes(feedback ?? error, RETRY_FEEDBACK_LIMIT - advice.length - 2),
          advice,
        ].join("\n\n"),
        repairAttempts: attempts + 1,
        repairAdvisor: undefined,
        ...(task.repairAdvisor?.runtimeRetryNotice
          ? {
              ownerNotices: [
                ...(task.ownerNotices ?? []),
                { ...task.repairAdvisor.runtimeRetryNotice, kind: "auto_continued" as const },
              ].slice(-OWNER_NOTICE_LIMIT),
            }
          : {}),
        repairNote: error,
        sessionId: undefined,
        runId: undefined,
        startedAt: undefined,
        completedAt: undefined,
        error: undefined,
        reviewer: undefined,
        verification: undefined,
        needsInput: undefined,
        updatedAt: context.now(),
      },
      undefined,
      takeover?.reviewed,
      takeover?.generation,
    );
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
  const open = (task.verification?.acceptance?.criteria ?? []).filter(
    (entry) => entry.verdict !== "verified",
  );
  if (open.length)
    parts.push(
      "Acceptance criteria not yet verified (criterion numbers as in the task; inspect current files before reusing evidence):",
      ...open.slice(0, 6).map(
        (entry) =>
          `- #${entry.criterionIndex} ${entry.verdict}: ${[
            entry.note,
            ...entry.evidence.slice(0, 2),
          ]
            .filter(Boolean)
            .map((text) => String(text).slice(0, 200))
            .join(" | ")}`,
      ),
    );
  if (review?.verdict === "fail") {
    const structured = (task.reviewNotes ?? []).filter(
      (note) => note.kind === "finding" && note.resolvedAt === undefined,
    );
    // Structured findings travel once, as review notes; copy the reviewer's
    // own words only when they have nothing else to act on.
    if (structured.length) return parts.join("\n\n").slice(0, RETRY_FEEDBACK_LIMIT);
    if (!parts[0].includes(review.note)) parts.push(`Reviewer finding: ${review.note}`);
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
  wait?: import("../../src/shared/model/host-contracts/work").WorkWait;
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
          work: {
            kind: task.blockedTakeover
              ? "task.recovery"
              : task.repairAttempts
                ? "task.repair"
                : "task.worker",
            id: task.id,
            occurrence: JSON.stringify([
              task.createdAt,
              task.sessionId,
              task.runId,
              task.ownerNotices?.length ?? 0,
            ]),
          },
          ...(task.isolate === false ? { workspaceMode: "current" as const } : {}),
          author: { kind: "task", id: task.id, name: task.title, reason: "kickoff" },
          prompt: workerPrompt(task, (await context.store.project(task.projectId)).cwd),
        },
        () => context.goalExecutionAllowed(task.goalId),
      );
    }
    const project = await context.store.project(task.projectId);
    if (!(await context.goalExecutionAllowed(task.goalId))) return { deferred: true };
    return await launchSessionRun(
      context.store,
      context.engine,
      {
        ...task,
        resumeSessionId: task.sessionId,
        work: {
          kind: task.blockedTakeover
            ? "task.recovery"
            : task.repairAttempts
              ? "task.repair"
              : "task.worker",
          id: task.id,
          occurrence: JSON.stringify([
            task.createdAt,
            task.sessionId,
            task.runId,
            task.ownerNotices?.length ?? 0,
          ]),
        },
        author: { kind: "task", id: task.id, name: task.title, reason: "recovery" },
        prompt: [
          `${session.usageLimit ? "The provider usage limit has reset." : "The host stopped before this task finished."} Continue this task from the existing conversation and working copy. Inspect the current changes and the last tool results first; keep completed work and do not start over. Completion still requires the original task's checks and review.`,
          "",
          workerPrompt(task, project.cwd),
        ].join("\n"),
      },
      () => context.goalExecutionAllowed(task.goalId),
    );
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
  await repairOrBlock(
    context,
    {
      ...task,
      retryFeedback: [task.retryFeedback, note]
        .filter(Boolean)
        .join("\n\n")
        .slice(-RETRY_FEEDBACK_LIMIT),
    },
    error,
    now,
    undefined,
    {
      notice: ownerNotice(
        "auto_continued",
        `Retried automatically after a runtime error (${attempt}/${MAX_RUNTIME_RETRIES}).`,
        now,
        `${RUNTIME_RETRY_NOTICE}${randomUUID()}`,
      ),
    },
  );
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
        commandId: newRequestId(),
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
