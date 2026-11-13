import { MAX_REPAIR_ATTEMPTS } from "./constants";
import {
  resolveRunModel,
  reviewerModelInput,
  routingRun,
  routingWait,
  routingWaitDue,
} from "./model-routing";
import { deferredAssistantTurn } from "../assistant/core/assistant-turn-policy";
import {
  readAssistantRecovery,
  writeAssistantRecovery,
} from "../assistant/work/assistant-worker-recovery";
import { createHash, randomUUID } from "node:crypto";
import { shouldFingerprintFailedCheck } from "./fingerprint";
import {
  canTakeOverBlockedTask,
  TASK_INPUT_REQUIRED,
  taskRequiresInstructions,
  hasUnmergedBranch,
  NO_VERDICT,
  type HostTask,
  type TaskVerification,
} from "../../src/features/tasks/model/hostTasks";
import { readTaskInstructions } from "../../src/features/tasks/model/taskInstructions";
import { withHostGitMutation } from "../git/git-mutations";
import {
  HOST_INTERRUPTED,
  STOPPED_BY_USER,
  cancelSessionRun,
  errorMessage,
  launchSessionRun,
  sessionRunState,
} from "../sessions/sessionRuns";
import { runHostShell } from "../execution/shell";
import { hasShellPhysicalOwner, reserveShellOwnership } from "../execution/shell-ownership";
import { VERIFY_OUTPUT_LIMIT } from "./constants";
import { UnresolvedMerge } from "./errors";
import { reviewPrompt } from "./prompts";
import { reviewerVerdict } from "./review-outcomes";
import { MAX_RUNTIME_RETRIES } from "./constants";
import { isTransientRunFailure } from "./review-outcomes";
import { runtimeRetryCount } from "./review-outcomes";
import { waitForUsageLimit } from "./usage-limit";
import type { TaskContext } from "./context";
import {
  conflictStopGeneration,
  fenceConflictChildren,
  releaseConflictStop,
} from "./conflict-recovery";
import { assertTaskWorkRetired } from "../work/session-adapter";
export async function acceptCrewTask(context: TaskContext, id: string): Promise<HostTask> {
  await context.ready;

  const task = await context.find(id);
  if (!task?.crewRunId || task.status !== "review" || task.verification?.review?.verdict !== "pass")
    throw new Error("Independent review must pass before acceptance");
  const fingerprint = await context.workspaceFingerprint(task);
  const latest = await context.find(id);
  if (!latest || latest.updatedAt !== task.updatedAt || latest.status !== "review")
    throw new Error("Task changed while accepting it");
  if (!fingerprint || fingerprint !== task.crewReviewFingerprint) {
    const reason =
      "The working copy changed or its review snapshot cannot be verified. Recheck the independent review before accepting.";
    await context.block(
      {
        ...latest,
        verification: {
          ...latest.verification,
          review: { ...latest.verification!.review!, verdict: "fail", note: reason },
        },
      },
      reason,
      context.now(),
    );
    throw new Error(reason);
  }
  // Only this acceptance path may complete a crew assignment. Ordinary board
  // moves must not bypass the reviewed snapshot or coordinator checks.
  return await context.write({ ...latest, status: "done", updatedAt: context.now() });
}

export async function recheckReview(context: TaskContext, id: string): Promise<HostTask> {
  await context.ready;

  const expected = await context.taskValue(id);
  const task = await context.find(id);
  if (
    !task ||
    task.status !== "blocked" ||
    task.verification?.review?.verdict !== "fail" ||
    !task.sessionId
  )
    throw new Error(
      "Only a blocked task with a failed review and existing worker can be rechecked.",
    );
  if (canTakeOverBlockedTask(task)) throw new Error("Automatic AI takeover is pending.");
  if (taskRequiresInstructions(task)) throw new Error(TASK_INPUT_REQUIRED);
  await assertTaskWorkRetired(context.store, task.id);
  const next = await context.transaction(async () => {
    if (!(await context.unchangedTask(task.id, expected)))
      throw new Error("Task changed before review recheck. Read it again.");
    fenceConflictChildren(id);
    const conflictFence = conflictStopGeneration(id);
    const saved = await context.write({
      ...task,
      workInvocationId: randomUUID(),
      conflictRecovery: undefined,
      conflictParent: undefined,
      crewWorkWait: undefined,
      repairAdvisor: undefined,
      status: "verifying",
      reviewOnly: true,
      awaitingOwnerRestart: undefined,
      repairStop: undefined,
      error: undefined,
      needsInput: undefined,
      reviewer: undefined,
      verification: undefined,
      completedAt: undefined,
      updatedAt: context.now(),
    });
    context.store.afterCommit(() => releaseConflictStop(id, conflictFence));
    return saved;
  });
  await context.verify(next);
  return next;
}

export async function recoverGoalReview(
  context: TaskContext,
  id: string,
  goalId: string,
): Promise<HostTask | undefined> {
  await context.ready;

  const task = await context.find(id);
  const review = task?.verification?.review;
  if (
    !task ||
    task.goalId !== goalId ||
    task.status !== "blocked" ||
    task.repairAttempts !== undefined ||
    canTakeOverBlockedTask(task) ||
    taskRequiresInstructions(task) ||
    review?.verdict !== "fail" ||
    review.note === NO_VERDICT ||
    task.error !== `Review failed: ${review.note}`
  )
    return task;
  try {
    const session = await context.store.session(review.sessionId);
    const verdict = reviewerVerdict(session.session.blocks);
    const last = session.session.blocks.at(-1);
    if (
      session.status !== "idle" ||
      last?.role === "system" ||
      verdict.verdict !== "fail" ||
      verdict.note !== review.note
    )
      return task;
    return await context.repairOrBlock(task, task.error, context.now());
  } catch {
    return task;
  }
}

export async function settleCrew(context: TaskContext, task: HostTask, now: number): Promise<void> {
  if (!context.crewRunner) return;
  try {
    const run = await context.crewRunner.state(task);
    if (run.status === "finished") {
      await context.verify(
        await context.write({
          ...task,
          status: "verifying",
          updatedAt: now,
          needsInput: undefined,
          error: undefined,
          verification: undefined,
        }),
      );
    } else if (await context.budgetReason(task)) {
      await context.crewRunner.stop(task);
      const latest = await context.find(task.id);
      if (latest?.status === "running" && latest.crewExecutionId === task.crewExecutionId)
        await context.block(latest, "The crew task exceeded its time limit.", now);
    } else {
      const needsInput = run.status === "paused" || !!run.error;
      if (Boolean(task.needsInput) !== needsInput || task.error !== run.error)
        await context.write({
          ...task,
          needsInput: needsInput || undefined,
          error: run.error,
          updatedAt: now,
        });
    }
  } catch (error) {
    await context.block(task, errorMessage(error), now);
  }
}

export async function settle(context: TaskContext, task: HostTask, now: number): Promise<void> {
  if (context.continuingSessions.has(task.id)) return;
  const expected = await context.taskValue(task.id);
  const current = await context.unchangedTask(task.id, expected);
  if (
    !current ||
    current.status !== "running" ||
    current.runId !== task.runId ||
    current.sessionId !== task.sessionId
  )
    return;
  const outcome = await sessionRunState(
    context.store,
    { ...task, startedAt: task.startedAt ?? task.createdAt },
    0,
    now,
  );
  if (context.continuingSessions.has(task.id)) return;
  if (outcome.state === "running") {
    if (outcome.needsInput && (await context.continueUnansweredQuestion(task, now))) return;
    const runStall =
      !outcome.needsInput &&
      task.sessionId &&
      task.runId &&
      outcome.lastActivityAt !== undefined &&
      now - outcome.lastActivityAt >= 15 * 60_000
        ? {
            sessionId: task.sessionId,
            runId: task.runId,
            lastActivityAt: outcome.lastActivityAt,
            detectedAt:
              task.runStall?.runId === task.runId &&
              task.runStall.lastActivityAt === outcome.lastActivityAt
                ? task.runStall.detectedAt
                : now,
          }
        : undefined;
    if (
      outcome.needsInput !== Boolean(task.needsInput) ||
      JSON.stringify(task.runStall) !== JSON.stringify(runStall)
    )
      await context.store.transaction(async () => {
        const fresh = await context.unchangedTask(task.id, expected);
        if (!fresh) return;
        await context.write({
          ...fresh,
          needsInput: outcome.needsInput || undefined,
          runStall,
          updatedAt: now,
        });
      });
  } else if (outcome.state === "overLimit") {
    // The reason is saved first: the turn settles asynchronously, and a
    // later tick blocks the task with it.
    await context.write({ ...task, error: outcome.error });
    await cancelSessionRun(context.engine, task);
  } else if (outcome.status === "succeeded") {
    await context.limits.recordRun(task, now);
    if (
      context.continuingSessions.has(task.id) ||
      (await context.find(task.id))?.runId !== task.runId
    )
      return;
    await context.verify(
      await context.write({
        ...task,
        status: "verifying",
        needsInput: undefined,
        verification: undefined,
        updatedAt: now,
      }),
    );
  } else {
    await context.limits.recordRun(task, now);
    if (await deferredAssistantTurn(context.store, task.sessionId, task.runId, task.id)) {
      await context.store.transaction(async () => {
        const fresh = await context.unchangedTask(task.id, expected);
        if (!fresh || fresh.status !== "running") return;
        const recovery = await readAssistantRecovery(context.store, task.id);
        if (recovery && recovery.state !== "running") {
          await context.block(
            fresh,
            "Inspect the automatic recovery before restarting its deferred worker.",
            now,
          );
          return;
        }
        if (recovery) {
          if (
            recovery.launchedSessionId !== fresh.sessionId ||
            recovery.launchedRunId !== fresh.runId
          )
            return;
          await writeAssistantRecovery(context.store, {
            ...recovery,
            state: "queued",
            launchRequestId: `assistant-recovery-deferred-${randomUUID()}`,
            launchedSessionId: undefined,
            launchedRunId: undefined,
            launchedAuthorityGeneration: undefined,
            updatedAt: now,
          });
        }
        await context.write({
          ...fresh,
          status: "queued",
          sessionId: undefined,
          runId: undefined,
          startedAt: undefined,
          error: undefined,
          needsInput: undefined,
          updatedAt: now,
        });
      });
      return;
    }
    // A usage limit is a wait for the reset, not a failure of the task.
    if (
      outcome.usageLimit &&
      outcome.status === "failed" &&
      (await waitForUsageLimit(context, task, outcome.usageLimit, now))
    )
      return;
    const recovery = await readAssistantRecovery(context.store, task.id);
    if (
      recovery &&
      ["running", "unknown", "escalated"].includes(recovery.state) &&
      recovery.launchedSessionId === task.sessionId &&
      recovery.launchedRunId === task.runId
    ) {
      const message =
        "The task's one automatic worker recovery did not finish successfully. Owner review is required.";
      await context.assistantRecoveryFailed?.(task, message);
      await context.block(task, message, now);
      return;
    }
    if (outcome.error === HOST_INTERRUPTED && (await context.canResumeAfterHostStop(task))) {
      await context.requeueInterrupted(task, now);
      return;
    }
    if (
      outcome.status === "failed" &&
      !task.crewRunId &&
      isTransientRunFailure(task, outcome.error) &&
      runtimeRetryCount(task) < MAX_RUNTIME_RETRIES &&
      (task.repairAttempts ?? 0) < MAX_REPAIR_ATTEMPTS
    ) {
      await context.retryTransientFailure(task, outcome.error!, now);
      return;
    }
    await context.block(
      task,
      outcome.status === "cancelled" ? STOPPED_BY_USER : (outcome.error ?? "The run failed."),
      now,
    );
  }
}

/** Another task's worker is still writing in this task's shared checkout. Its
 * edits would void the snapshot an acceptance review is bound to, so the checks
 * wait for the next tick instead of spending a review that cannot settle. */
export async function sharedCheckoutWriterActive(
  context: TaskContext,
  task: HostTask,
): Promise<boolean> {
  if (task.crewRunId || task.worktreeCwd) return false;
  if (!readTaskInstructions(task.prompt)?.acceptance.length) return false;
  // shortcut: compares tasks of one project; upgrade to checkout paths if two
  // projects ever share a folder.
  return (await context.list(task.projectId, false)).some(
    (other) => other.id !== task.id && other.status === "running" && !other.worktreeCwd,
  );
}

export async function verify(context: TaskContext, task: HostTask): Promise<void> {
  if (context.closing) return;
  if (!routingWaitDue(task, context.now())) return;
  if (!(await context.goalExecutionAllowed(task.goalId))) return;
  if (await sharedCheckoutWriterActive(context, task)) return;
  const { id } = task;
  if (context.jobs.has(id)) return;
  const controller = new AbortController();
  let expected = await context.taskValue(id);
  if (context.closing) return;
  context.jobControllers.set(id, controller);
  /** The task, while this job still owns its verification. */
  const current = async () => {
    const latest = context.jobs.get(id) === job ? await context.find(id) : undefined;
    return latest?.status === "verifying" ? latest : undefined;
  };
  const run = async () => {
    // Lets the job be registered before it first asks whether it owns the task.
    await Promise.resolve();
    if (
      controller.signal.aborted ||
      !(await current()) ||
      !(await context.unchangedTask(id, expected))
    )
      return;
    const project = await context.store.project(task.projectId);
    const cwd = task.worktreeCwd ?? project.cwd;
    if (hasUnmergedBranch(task))
      await withHostGitMutation(cwd, async () => {
        if (
          controller.signal.aborted ||
          !(await current()) ||
          !(await context.unchangedTask(id, expected))
        )
          return;
        await context.requireFinalized(task, cwd);
        expected = await context.taskValue(id);
      });
    // The repository lease can wait behind another operation. Stop must still
    // prevent a new check command or reviewer from starting after that wait.
    if (
      controller.signal.aborted ||
      !(await current()) ||
      !(await context.unchangedTask(id, expected))
    )
      return;
    const verification: TaskVerification = {};
    if (task.verifyCommand) {
      const physicalOwner = await reserveShellOwnership(
        context.store,
        cwd,
        "task",
        id,
        task.verifyCommand,
        task.workspaceActivityId,
      );
      const result = await runHostShell(
        cwd,
        task.verifyCommand,
        context.verifyTimeoutMs,
        undefined,
        controller.signal,
        async (message) => {
          const latest = await context.find(id);
          if (latest?.status === "blocked")
            await context.write({
              ...latest,
              error: `The verification command tree could not be stopped. ${message} Inspect host diagnostics before retrying.`,
              updatedAt: context.now(),
            });
        },
        (identity) => physicalOwner.observe(identity),
      );
      if (result.terminationFailed) {
        await physicalOwner.unknown(result.terminationFailed);
        const latest = await context.find(id);
        if (latest)
          await context.write({
            ...latest,
            status: "blocked",
            error: result.terminationFailed,
            verification: {
              command: {
                exitCode: null,
                output: result.output.slice(-VERIFY_OUTPUT_LIMIT),
                timedOut: result.timedOut,
              },
            },
            updatedAt: context.now(),
          });
        return;
      }
      await physicalOwner.complete();
      if (controller.signal.aborted) return;
      verification.command = {
        exitCode: result.exitCode,
        output: result.output.slice(-VERIFY_OUTPUT_LIMIT),
        timedOut: result.timedOut,
      };
      if (result.timedOut || result.exitCode !== 0) {
        if (!(await current())) return;
        const workspace = !shouldFingerprintFailedCheck(result)
          ? undefined
          : readTaskInstructions(task.prompt)?.acceptance.length
            ? await context.acceptanceFingerprint(task)
            : await context.workspaceFingerprint(task);
        const checkFailureFingerprint =
          workspace &&
          createHash("sha256")
            .update(
              JSON.stringify({
                command: task.verifyCommand,
                result: verification.command,
                workspace,
              }),
            )
            .digest("hex");
        const latest = await current();
        if (latest)
          await (
            result.timedOut || result.exitCode === null
              ? context.block.bind(context)
              : context.repairOrBlock.bind(context)
          )(
            {
              ...latest,
              verification,
              checkFailureFingerprint,
              ...(checkFailureFingerprint &&
              checkFailureFingerprint === latest.checkFailureFingerprint
                ? {
                    repairStop: {
                      reason: "no_progress" as const,
                      message:
                        "The check failed again with unchanged output and working-copy contents. Inspect the retained work and choose a different correction.",
                    },
                  }
                : {}),
            },
            result.timedOut
              ? "The check command timed out."
              : result.exitCode === null
                ? "The check command could not run."
                : `The check command failed (exit code ${result.exitCode}).`,
            context.now(),
          );
        return;
      }
    }
    if (task.review === false) {
      const diffStat = await context.diffStat(task);
      const latest = await current();
      if (latest) await context.enterReview({ ...latest, verification, diffStat });
      return;
    }
    const latest = await current();
    if (!latest) return;
    const reviewBudget = await context.budgetReason(latest, true);
    if (reviewBudget) {
      await context.budgetBlock(latest, reviewBudget, context.now());
      return;
    }
    const now = context.now();
    const acceptanceRequired = Boolean(readTaskInstructions(task.prompt)?.acceptance.length);
    const crewReviewFingerprint = task.crewRunId
      ? await context.workspaceFingerprint(task)
      : undefined;
    const acceptanceFingerprint = acceptanceRequired
      ? await context.acceptanceFingerprint(task, crewReviewFingerprint)
      : undefined;
    if ((await current())?.updatedAt !== latest.updatedAt) return;
    if (task.crewRunId && !crewReviewFingerprint) {
      await context.block(
        latest,
        "Cannot snapshot this crew assignment for independent review.",
        now,
      );
      return;
    }
    const finalReviewBudget = await context.budgetReason(latest, true);
    if (finalReviewBudget) {
      await context.budgetBlock(latest, finalReviewBudget, context.now());
      return;
    }
    if (latest.reviewer?.sessionId || !routingWaitDue(latest, now)) return;
    const routingExpected = await context.taskValue(id);
    const persistRouting = (row: HostTask) =>
      context.transaction(async () =>
        (await current()) && (await context.unchangedTask(id, routingExpected))
          ? context.write(row)
          : undefined,
      );
    const reviewInput = reviewerModelInput(latest);
    const resolution = await resolveRunModel(
      context.store,
      "task.reviewer",
      reviewInput.target,
      reviewInput.choice,
    );
    if (!(await current()) || !(await context.unchangedTask(id, routingExpected))) return;
    if (!resolution.ok && resolution.reason === "noEligibleEntry") {
      const wait = routingWait(resolution);
      const waiting = { ...latest, modelRoutingWait: wait, error: wait.reason, updatedAt: now };
      if (JSON.stringify(routingRun(latest).modelRoutingWait) !== JSON.stringify(wait))
        await persistRouting(waiting);
      return;
    }
    const reviewerTarget = resolution.ok ? resolution.target : reviewInput.target;
    const pendingReview = {
      ...latest,
      reviewerTarget,
      modelRoutingWait: undefined,
      error: undefined,
    };
    const routedReview = await persistRouting(pendingReview);
    if (!routedReview) return;
    const started = await launchSessionRun(
      context.store,
      context.engine,
      {
        ...task,
        title: `Review: ${task.title}`.slice(0, 200),
        work: {
          kind: "task.reviewer",
          id: task.id,
          occurrence: JSON.stringify([
            task.sessionId,
            task.runId,
            task.repairAttempts ?? 0,
            acceptanceFingerprint,
            ...(task.workInvocationId ? [task.workInvocationId] : []),
          ]),
        },
        author: { kind: "task", id: task.id, name: task.title, reason: "review" },
        ...(task.isolate === false ? { workspaceMode: "current" as const } : {}),
        ...reviewerTarget,
        prompt: `${task.reviewerConfig?.instructions ?? ""}\n${reviewPrompt({ ...task, verification })}`,
      },
      async () => !controller.signal.aborted && (await context.goalExecutionAllowed(task.goalId)),
    );
    if (started.deferred) return;
    const reviewing = {
      ...routedReview,
      ...(crewReviewFingerprint ? { crewReviewFingerprint } : {}),
      verification,
      reviewer: {
        sessionId: started.sessionId,
        runId: started.runId,
        startedAt: now,
        ...(acceptanceRequired
          ? { acceptanceRequired: true, workspaceFingerprint: acceptanceFingerprint }
          : {}),
      },
    };
    if (started.error !== undefined)
      await context.block(reviewing, `Could not start the reviewer: ${started.error}`, now);
    else await context.write({ ...reviewing, updatedAt: now });
  };
  // Authorize enrollment now, then keep accepted background verification system-owned.
  await context.store.db.checkAuthorization();
  const job: Promise<void> = context.store.db.outsideScope(() =>
    run()
      .catch(async (error) => {
        const latest = await current();
        if (latest) {
          if (error instanceof UnresolvedMerge && latest.mergeRepair)
            await context.repairOrBlock(
              { ...latest, retryFeedback: error.message },
              error.message,
              context.now(),
            );
          else await context.block(latest, errorMessage(error), context.now());
        }
      })
      .catch((error) => console.error("Could not verify a task:", errorMessage(error)))
      .finally(async () => {
        const latest = await context.find(id);
        if (
          latest?.workspaceActivityId &&
          latest.status === "blocked" &&
          !(await hasShellPhysicalOwner(context.store, "task", id))
        ) {
          const run = latest.reviewer ?? latest;
          if (
            (
              await sessionRunState(
                context.store,
                { ...run, startedAt: run.startedAt ?? latest.createdAt },
                0,
                context.now(),
              )
            ).state === "finished"
          ) {
            await context.stopWorkspaceActivity(latest);
            await context.write({ ...latest, workspaceActivityId: undefined });
          }
        }
        if (context.jobs.get(id) === job) {
          context.jobs.delete(id);
          context.jobControllers.delete(id);
        }
      }),
  );
  context.jobs.set(id, job);
}
