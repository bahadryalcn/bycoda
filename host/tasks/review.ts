import { deferredAssistantTurn } from "../assistant/core/assistant-turn-policy";
import { randomUUID } from "node:crypto";

import {
  taskReviewFailureCount,
  hasUnmergedBranch,
  NO_VERDICT,
  type HostTask,
  type TaskVerification,
} from "../../src/features/tasks/model/hostTasks";
import { readTaskInstructions } from "../../src/features/tasks/model/taskInstructions";
import {
  acceptanceReviewInstructions,
  hasTaskAcceptanceReport,
  parseTaskAcceptance,
} from "../../src/features/tasks/model/taskAcceptance";
import {
  addReviewNotes,
  resolveReviewFindings,
  resolveReviewedNotes,
  reviewFindings,
  reviewRepairStop,
} from "../../src/features/tasks/model/taskReviewNotes";
import {
  HOST_INTERRUPTED,
  STOPPED_BY_USER,
  cancelSessionRun,
  errorMessage,
  launchSessionRun,
  sessionRunState,
} from "../sessions/sessionRuns";
import { reviewerVerdict } from "./review-outcomes";
import { reviewerReply } from "./review-outcomes";
import { ownerNotice, reviewRerunCount } from "./review-outcomes";
import { MAX_REVIEW_RERUNS, OWNER_NOTICE_LIMIT, REVIEW_RERUN_NOTICE } from "./constants";
import type { TaskContext } from "./context";
export async function settleVerification(
  context: TaskContext,
  task: HostTask,
  now: number,
): Promise<void> {
  if (context.jobs.has(task.id)) return;
  if (!task.reviewer) {
    // The host stopped during the checks; they start over.
    await context.verify(task);
    return;
  }
  if (task.reviewer.verdictRepairPending || task.reviewer.recoveryPending) {
    await context.resumeReviewer(task, now);
    return;
  }
  const outcome = await sessionRunState(context.store, task.reviewer, task.maxRunMinutes, now);
  if (outcome.state === "running") {
    if (outcome.needsInput !== Boolean(task.needsInput))
      await context.write({
        ...task,
        needsInput: outcome.needsInput || undefined,
        updatedAt: now,
      });
    return;
  }
  if (outcome.state === "overLimit") {
    await context.write({
      ...task,
      reviewer: { ...task.reviewer, error: outcome.error },
    });
    await cancelSessionRun(context.engine, task.reviewer);
    return;
  }
  await context.limits.recordRun(task.reviewer, now);
  if (
    await deferredAssistantTurn(
      context.store,
      task.reviewer.sessionId,
      task.reviewer.runId,
      task.id,
    )
  ) {
    await context.store.transaction(async () => {
      const latest = await context.find(task.id);
      if (
        latest?.status === "verifying" &&
        latest.reviewer?.sessionId === task.reviewer!.sessionId &&
        latest.reviewer?.runId === task.reviewer!.runId &&
        latest.updatedAt === task.updatedAt &&
        !latest.awaitingOwnerRestart &&
        !(latest.goalId && context.isAssistantDeletionHeld(latest.goalId))
      )
        await context.write({
          ...latest,
          reviewer: undefined,
          needsInput: undefined,
          error: undefined,
          updatedAt: now,
        });
    }, "critical");
    return;
  }
  if (outcome.error === HOST_INTERRUPTED && (await context.canResumeAfterHostStop(task.reviewer))) {
    // Retain the read-only review and its inspected evidence. A host stop
    // is not a failed verdict and must not spend a correction attempt.
    const next = await context.write({
      ...task,
      reviewer: { ...task.reviewer, recoveryPending: true },
      needsInput: undefined,
      updatedAt: now,
    });
    await context.resumeReviewer(next, now);
    return;
  }
  if (outcome.status === "cancelled") {
    await context.block(task, STOPPED_BY_USER, now);
    return;
  }
  const sessionId = task.reviewer.sessionId ?? "";
  let review =
    outcome.status === "succeeded"
      ? reviewerVerdict((await context.store.session(sessionId)).session.blocks)
      : {
          verdict: "fail" as const,
          note: outcome.error ?? "The reviewer’s run failed.",
        };
  const reply =
    outcome.status === "succeeded"
      ? reviewerReply((await context.store.session(sessionId)).session.blocks)
      : "";
  const acceptanceCriteria = readTaskInstructions(task.prompt)?.acceptance ?? [];
  const acceptanceRequired = task.reviewer.acceptanceRequired && acceptanceCriteria.length > 0;
  // A clean reviewer turn without the required machine-readable verdict is a
  // format failure, not evidence that the implementation is defective.
  if (
    outcome.status === "succeeded" &&
    (review.note === NO_VERDICT ||
      (acceptanceRequired && !hasTaskAcceptanceReport(reply, acceptanceCriteria))) &&
    (!task.reviewOnly || task.continueUntilDone) &&
    (task.reviewer.verdictRepairAttempts ?? 0) < 2
  ) {
    const pending = await context.write({
      ...task,
      reviewer: { ...task.reviewer, verdictRepairPending: true },
      updatedAt: now,
    });
    await context.resumeReviewer(pending, now);
    return;
  }
  const acceptance = acceptanceRequired
    ? parseTaskAcceptance(reply, acceptanceCriteria, { checkedAt: now, sessionId })
    : undefined;
  if (acceptance && review.verdict === "pass") {
    const incomplete = acceptance.criteria.filter((criterion) => criterion.verdict !== "verified");
    if (incomplete.length)
      review = {
        verdict: "fail",
        note: `Acceptance evidence is incomplete: ${incomplete
          .map((criterion) => `#${criterion.criterionIndex + 1} ${criterion.criterion}`)
          .join("; ")
          .slice(0, 2000)}`,
      };
  }
  const verification: TaskVerification = {
    ...task.verification,
    review: { ...review, sessionId },
    ...(acceptance ? { acceptance } : {}),
  };
  const findings =
    outcome.status === "succeeded"
      ? reviewFindings(
          reviewerReply((await context.store.session(sessionId)).session.blocks),
          review,
        )
      : [];
  // Acceptance already includes the repository snapshot. Crew reviews also
  // need it for exact independent-review validation, including passing reviews.
  const eligibleFingerprint = outcome.status === "succeeded" && review.note !== NO_VERDICT;
  const repositoryFingerprint =
    eligibleFingerprint && (task.crewRunId || (!acceptance && review.verdict === "fail"))
      ? await context.workspaceFingerprint(task)
      : undefined;
  const acceptanceFingerprint =
    acceptance && eligibleFingerprint
      ? await context.acceptanceFingerprint(task, repositoryFingerprint)
      : undefined;
  const workspaceFingerprint = acceptanceRequired ? acceptanceFingerprint : repositoryFingerprint;
  const currentReview = await context.find(task.id);
  if (
    currentReview?.status !== "verifying" ||
    currentReview.updatedAt !== task.updatedAt ||
    currentReview.reviewer?.runId !== task.reviewer.runId
  )
    return;
  if (
    task.crewRunId &&
    eligibleFingerprint &&
    (!repositoryFingerprint || repositoryFingerprint !== task.crewReviewFingerprint)
  ) {
    const reason =
      "The working copy changed during independent review. Recheck the review on the current result.";
    await context.block(
      {
        ...task,
        verification: {
          ...verification,
          review: { ...review, sessionId, verdict: "fail", note: reason },
        },
      },
      reason,
      now,
    );
    return;
  }
  if (acceptance) {
    if (
      eligibleFingerprint &&
      task.reviewer.workspaceFingerprint &&
      acceptanceFingerprint !== task.reviewer.workspaceFingerprint
    ) {
      const reruns = reviewRerunCount(task);
      if (reruns < MAX_REVIEW_RERUNS) {
        // The verdict describes contents that no longer exist. A fresh review
        // of the current contents costs less than a blocked task and its dependents.
        await context.write({
          ...task,
          reviewer: undefined,
          needsInput: undefined,
          ownerNotices: [
            ...(task.ownerNotices ?? []),
            ownerNotice(
              "auto_continued",
              `Reviewed again because the working copy changed during the review (${reruns + 1}/${MAX_REVIEW_RERUNS}).`,
              now,
              `${REVIEW_RERUN_NOTICE}${randomUUID()}`,
            ),
          ].slice(-OWNER_NOTICE_LIMIT),
          updatedAt: now,
        });
        return;
      }
      const reason =
        "The working copy changed during acceptance review. Recheck the current result.";
      acceptance.criteria = acceptance.criteria.map((criterion) => ({
        ...criterion,
        verdict: "unresolved",
        note: reason,
      }));
      await context.block(
        {
          ...task,
          verification: {
            ...verification,
            review: { verdict: "fail", note: reason, sessionId },
          },
        },
        reason,
        now,
      );
      return;
    }
    acceptance.workspaceFingerprint = task.reviewer.workspaceFingerprint
      ? acceptanceFingerprint
      : undefined;
  }
  // Repeating a broad finding while files are still changing is not itself
  // proof of a stalled correction. A repeated contents/finding pair is.
  const comparable = workspaceFingerprint
    ? task.attemptHistory?.findLast(
        (attempt) =>
          attempt.verdict === "fail" && attempt.workspaceFingerprint === workspaceFingerprint,
      )
    : undefined;
  let repairStop =
    review.verdict === "fail" && outcome.status === "succeeded"
      ? reviewRepairStop(
          findings,
          (task.repairAttempts ?? 0) > 0 && comparable?.verdict === "fail"
            ? comparable.findings
            : undefined,
        )
      : undefined;
  if (
    !repairStop &&
    review.verdict === "fail" &&
    outcome.status === "succeeded" &&
    task.continueUntilDone &&
    workspaceFingerprint &&
    (task.repairAttempts ?? 0) > 0 &&
    task.attemptHistory?.slice(-2).length === 2 &&
    task
      .attemptHistory!.slice(-2)
      .every(
        (attempt) =>
          attempt.verdict === "fail" && attempt.workspaceFingerprint === workspaceFingerprint,
      )
  )
    repairStop = {
      reason: "no_progress",
      message:
        "The working-copy contents remain unchanged across three failed reviews. Review wording changed, but no implementation progress was observed. Choose a different correction or provide the missing resource.",
    };
  let workerSummary = "Worker summary unavailable.";
  if (task.sessionId) {
    try {
      const blocks = (await context.store.session(task.sessionId)).session.blocks;
      workerSummary =
        blocks
          .slice(blocks.findLastIndex((block) => block.role === "user") + 1)
          .findLast((block) => block.role === "assistant" && block.text.trim())
          ?.text.trim()
          .slice(-4000) || workerSummary;
    } catch {
      /* A removed worker session must not prevent verification. */
    }
  }
  const attemptHistory =
    outcome.status === "succeeded" && review.note !== NO_VERDICT
      ? [
          ...(task.attemptHistory ?? []),
          {
            attempt: task.repairAttempts ?? 0,
            at: now,
            workerSessionId: task.sessionId,
            reviewerSessionId: sessionId,
            workerSummary,
            verdict: review.verdict,
            reviewOnly: task.reviewOnly,
            note: review.note,
            findings: findings
              .filter((finding) => finding.kind === "finding")
              .map((finding) => finding.finding),
            ...(workspaceFingerprint ? { workspaceFingerprint } : {}),
          },
        ].slice(-20)
      : task.attemptHistory;
  const reviewed =
    outcome.status === "succeeded"
      ? {
          ...task,
          verification,
          repairStop,
          reviewFailureCount: review.verdict === "fail" ? taskReviewFailureCount(task) + 1 : 0,
          attemptHistory,
          reviewNotes: addReviewNotes(
            review.verdict === "pass"
              ? resolveReviewFindings(task.reviewNotes ?? [], now)
              : resolveReviewedNotes(
                  task.reviewNotes ?? [],
                  reviewerReply((await context.store.session(sessionId)).session.blocks),
                  now,
                ),
            findings,
            sessionId,
            now,
            randomUUID,
          ),
        }
      : { ...task, verification };
  if (review.verdict === "fail") {
    await (
      outcome.status === "succeeded" && review.note !== NO_VERDICT
        ? context.repairOrBlock.bind(context)
        : context.block.bind(context)
    )(reviewed, `Review failed: ${review.note}`, now);
    return;
  }
  const diffStat = await context.diffStat(task);
  const latest = await context.find(task.id);
  if (latest?.status === "verifying" && latest.updatedAt === task.updatedAt)
    await context.enterReview({
      ...latest,
      verification,
      reviewNotes: reviewed.reviewNotes,
      repairStop: undefined,
      completedWithFindings: undefined,
      attemptHistory,
      diffStat,
    });
}

export async function resumeReviewer(
  context: TaskContext,
  task: HostTask,
  now: number,
): Promise<void> {
  if (context.closing) return;
  if (await context.limits.reached()) return;
  const budgetReason = await context.budgetReason(task, true);
  if (budgetReason) {
    await context.budgetBlock(task, budgetReason, now);
    return;
  }
  try {
    const sessionId = task.reviewer!.sessionId!;
    const session = await context.store.session(sessionId);
    const interrupted = task.reviewer!.recoveryPending;
    const last = session.session.blocks.at(-1);
    if (last?.role === "system" && last.text.trim() === STOPPED_BY_USER) {
      await context.block(task, STOPPED_BY_USER, now);
      return;
    }
    if (
      session.runId !== task.reviewer!.runId ||
      (interrupted
        ? !(await context.canResumeAfterHostStop(task.reviewer!))
        : session.status !== "idle")
    ) {
      await context.block(
        task,
        "The reviewer recovery no longer owns its recorded turn. Recheck the review to continue.",
        now,
      );
      return;
    }
    // Retire the exact prior turn before its session can accept a successor.
    // Shared Work reconciles that receipt before registering the continuation.
    if (!context.waitRecoveryRun) throw new Error("Reviewer retirement proof is unavailable.");
    await context.waitRecoveryRun(sessionId, task.reviewer!.runId);
    const receipt = await launchSessionRun(
      context.store,
      context.engine,
      {
        projectId: task.projectId,
        harness: session.session.harness,
        providerAccountId: session.session.providerAccountId,
        model: session.session.model,
        modelSettings: session.session.modelSettings,
        runtimeMode: session.session.runtimeMode,
        title: `Review: ${task.title}`.slice(0, 200),
        resumeSessionId: sessionId,
        ...(task.workspaceId ? { workspaceId: task.workspaceId } : {}),
        ...(task.worktreeCwd ? { worktreeCwd: task.worktreeCwd } : {}),
        ...(task.isolate === false ? { workspaceMode: "current" as const } : {}),
        author: { kind: "task", id: task.id, name: task.title, reason: "review-recovery" },
        work: {
          kind: "task.reviewer",
          id: task.id,
          occurrence: JSON.stringify([
            "review-recovery",
            sessionId,
            task.reviewer!.runId,
            task.reviewer!.verdictRepairAttempts ?? 0,
            Boolean(interrupted),
            task.workInvocationId,
          ]),
        },
        prompt:
          (interrupted
            ? "The host interrupted this review. Continue the unfinished review in the existing conversation, preserving the inspected evidence and completed checks. "
            : "") +
          "Complete the existing read-only review using the evidence already inspected. Do not edit files or launch an implementation worker. Include the concrete findings, then end with exactly VERDICT: PASS or VERDICT: FAIL - <specific reason>. Do not invent a passing verdict or claim unavailable checks passed.\n" +
          (task.reviewer!.acceptanceRequired
            ? acceptanceReviewInstructions(readTaskInstructions(task.prompt)?.acceptance ?? [])
            : ""),
      },
      async () => {
        const latest = await context.find(task.id);
        return (
          !context.closing &&
          (await context.goalExecutionAllowed(task.goalId)) &&
          latest?.status === "verifying" &&
          latest.reviewer?.sessionId === sessionId &&
          latest.workInvocationId === task.workInvocationId &&
          !latest.awaitingOwnerRestart
        );
      },
    );
    if (receipt.deferred) return;
    if (!receipt.sessionId || !receipt.runId)
      throw new Error(receipt.error ?? "Reviewer continuation has no exact receipt.");
    await context.write({
      ...task,
      reviewer: {
        ...task.reviewer!,
        runId: receipt.runId,
        startedAt: now,
        verdictRepairPending: undefined,
        recoveryPending: undefined,
        verdictRepairAttempts: (task.reviewer!.verdictRepairAttempts ?? 0) + Number(!interrupted),
      },
      updatedAt: now,
    });
  } catch (error) {
    await context.block(task, `Could not resume the reviewer: ${errorMessage(error)}`, now);
  }
}

export async function enterReview(context: TaskContext, task: HostTask): Promise<HostTask> {
  if (task.workspaceId && context.managed) {
    await context.stopWorkspaceActivity(task);
    const workspace = await context.managed.registry.get({ workspaceId: task.workspaceId });
    if (!workspace) throw new Error("The task workspace is unavailable.");
    await context.managed.registry.finish({
      workspaceId: workspace.id,
      expectedRevision: workspace.revision,
      idempotencyKey: `task-finish:${task.id}:${workspace.revision}`,
    });
    task = {
      ...task,
      workspaceActivityId: undefined,
      deliveryState: "awaitingOwner",
      deliveryOperationId: undefined,
      deliveryApprovalRequired: true,
    };
  }
  const now = context.now();
  const reviewing: HostTask = {
    ...task,
    status: "review",
    reviewFailureCount: 0,
    needsInput: undefined,
    reviewer: undefined,
    retryFeedback: undefined,
    reviewOnly: undefined,
    mergeRetry: undefined,
    completedAt: now,
    updatedAt: now,
  };
  // Direct work is already available to dependent tasks after checks pass.
  if (task.isolate === false && !task.crewRunId && !hasUnmergedBranch(task))
    return await context.write({ ...reviewing, status: "done", mergeError: undefined });
  return await context.write(reviewing);
}
