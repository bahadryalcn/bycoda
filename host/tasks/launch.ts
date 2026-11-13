import { someAsync } from "../async-collections";
import { resolveRunModel, routingRun, routingWait, routingWaitDue } from "./model-routing";
import { AssistantTurnPolicyDeferredError } from "../assistant/core/assistant-turn-policy";
import {
  assistantRecoveryHoldsTask,
  assistantRecoveryIdentity,
  readAssistantRecovery,
  writeAssistantRecovery,
} from "../assistant/work/assistant-worker-recovery";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { hasUnmergedBranch, type HostTask } from "../../src/features/tasks/model/hostTasks";
import type { HostEngine } from "../engine";
import { createHostWorktree } from "../git/git-worktrees";
import { taskWorkspace } from "./task-workspace";
import { transferTaskArtifacts } from "./task-artifacts";
import { admitRunDuration, retractRunDuration } from "../execution/run-duration";
import { errorMessage, launchSessionRun } from "../sessions/sessionRuns";
import { assertShellOwnershipAvailable, hasShellPhysicalOwner } from "../execution/shell-ownership";
import { writerWorkspaceMode } from "./task-workspace-runtime";
import { SHARED_EDITS_LIMIT } from "./constants";
import { TaskPreparationSuperseded } from "./errors";
import { git } from "./git";
import { available } from "./git";
import { workerPrompt } from "./prompts";
import { canResumeAfterUsageLimit } from "./usage-limit";
import type { TaskContext } from "./context";
export async function workingCopy(context: TaskContext, task: HostTask): Promise<HostTask> {
  const expected = await context.taskValue(task.id);
  const project = await context.store.project(task.projectId);
  // Legacy interrupted tasks already own their execution identity. They are
  // deliberately outside registry lifecycle ownership until an explicit migration.
  if (!task.workspaceId && hasUnmergedBranch(task)) {
    if (task.worktreeCwd && available(task.worktreeCwd)) {
      if ((await git(task.worktreeCwd, ["symbolic-ref", "--short", "HEAD"])) !== task.branch)
        throw new Error("The retained task checkout is no longer on its recorded branch.");
      return task;
    }
    const tree = await createHostWorktree(project.cwd, task.branch!, "", true);
    return {
      ...task,
      worktreeCwd: tree.path,
      ...(task.mergeRepair ? { mergeRepair: { ...task.mergeRepair, prepared: false } } : {}),
    };
  }
  const mode = task.workspaceId
    ? "worktree"
    : await writerWorkspaceMode(context.store, context.managed, task.projectId, task.isolate);
  task = { ...task, isolate: mode === "worktree" };
  if (context.managed && (task.isolate !== false || task.workspaceId)) {
    const selected = task.workspace ? await taskWorkspace(project.cwd, task.workspace) : undefined;
    if (!task.workspaceId && task.workspace?.branchName)
      throw new Error(
        "Managed tasks generate an owned branch name. Remove the legacy custom branch name before starting.",
      );
    let workspace = task.workspaceId
      ? await context.managed.registry.get({ workspaceId: task.workspaceId })
      : (
          await context.managed.registry.prepare({
            idempotencyKey: `task-workspace:${task.id}:${task.workspaceGenerationId ?? task.createdAt}`,
            projectId: task.projectId,
            environmentId: context.managed.environmentId,
            owner: { kind: "task", id: task.id },
            slug: task.title,
            choice: {
              defaultMode: "worktree",
              ...(selected ? { integrationBranchRef: `refs/heads/${selected.branch}` } : {}),
            },
            ...(selected ? { baseRef: `refs/heads/${selected.branch}` } : {}),
          })
        ).workspace;
    if (
      !workspace ||
      workspace.owner.kind !== "task" ||
      workspace.owner.id !== task.id ||
      workspace.projectId !== task.projectId
    )
      throw new Error("The managed workspace does not belong to this task.");
    if (workspace.directoryState !== "present" || workspace.state !== "active")
      workspace = await context.managed.registry.resume({
        workspaceId: workspace.id,
        expectedRevision: workspace.revision,
        idempotencyKey: `task-resume:${task.id}:${workspace.revision}`,
      });
    for (const id of task.dependsOn ?? []) {
      const dependency = await context.scheduledTask(id);
      if (dependency?.projectId === task.projectId && dependency.deliveredCommit)
        await git(workspace.path, [
          "merge-base",
          "--is-ancestor",
          dependency.deliveredCommit,
          "HEAD",
        ]);
    }
    return context.transaction(async () => {
      const current = await context.unchangedTask(task.id, expected);
      if (!current)
        throw new TaskPreparationSuperseded("Task changed during workspace preparation.");
      return context.write({
        ...current,
        isolate: true,
        workspaceId: workspace.id,
        branch: workspace.branchRef.replace(/^refs\/heads\//, ""),
        worktreeCwd: workspace.path,
        baseBranch: workspace.targetBranchRef.replace(/^refs\/heads\//, ""),
        baseCommit: workspace.baseCommit,
        deliveryCwd: selected?.cwd ?? task.deliveryCwd ?? project.cwd,
      });
    });
  }
  if (task.isolate !== false && !task.branch)
    throw new Error(
      "Update this host to create a managed task workspace. No work was started in the project checkout.",
    );
  if (hasUnmergedBranch(task)) {
    if (task.worktreeCwd && available(task.worktreeCwd)) return task;
    // The worktree was removed; the branch still holds the work.
    const tree = await createHostWorktree(project.cwd, task.branch, "", true);
    return {
      ...task,
      worktreeCwd: tree.path,
      ...(task.mergeRepair ? { mergeRepair: { ...task.mergeRepair, prepared: false } } : {}),
    };
  }
  const target = task.workspace ? await taskWorkspace(project.cwd, task.workspace) : undefined;
  const targetCwd = target?.cwd ?? project.cwd;
  for (const id of task.dependsOn ?? []) {
    const dependency = await context.scheduledTask(id);
    if (dependency?.projectId === task.projectId && dependency.deliveredCommit) {
      try {
        await git(targetCwd, ["merge-base", "--is-ancestor", dependency.deliveredCommit, "HEAD"]);
      } catch {
        throw new Error(
          `The selected base does not contain completed dependency ${dependency.title}. Choose its integration worktree.`,
        );
      }
    }
  }
  if (task.isolate === false)
    return { ...task, worktreeCwd: targetCwd !== project.cwd ? targetCwd : undefined };
  throw new Error(
    "Update this host to create a managed task workspace. The legacy branch is retained.",
  );
}

export async function launch(
  context: TaskContext,
  task: HostTask,
  now: number,
  active: readonly HostTask[],
): Promise<HostTask> {
  if (await hasShellPhysicalOwner(context.store, "task", task.id))
    throw new Error(
      "The original verification command tree is not proven stopped. Inspect Host diagnostics before retrying.",
    );
  await assertShellOwnershipAvailable(
    context.store,
    task.worktreeCwd ?? (await context.store.project(task.projectId)).cwd,
  );
  if (!(await context.goalExecutionAllowed(task.goalId))) return task;
  if (assistantRecoveryHoldsTask(await readAssistantRecovery(context.store, task.id), task))
    return task;
  const budgetReason = await context.budgetReason(task, true);
  if (budgetReason) return await context.budgetBlock(task, budgetReason, now);
  if (task.crewDefinitionId) {
    if (!context.crewRunner)
      return await context.block(task, "Crew execution is unavailable on this host.", now);
    if (task.preflightRequirements?.length) {
      const report = await context.preflightAt(
        task,
        (await context.store.project(task.projectId)).cwd,
      );
      const latest = await context.find(task.id);
      if (!latest || latest.status !== "queued" || latest.updatedAt !== task.updatedAt)
        return latest ?? task;
      task = { ...task, preflight: report };
      if (report.items.some((item) => item.required && item.state !== "ready"))
        return await context.block(
          task,
          "Preparation requires checked resources before starting the crew.",
          now,
        );
    }
    const pending = task.crewExecutionId
      ? task
      : await context.write({
          ...task,
          crewExecutionId: randomUUID(),
          updatedAt: context.now(),
        });
    if (!routingWaitDue(pending, now)) return pending;
    // A run retracted by a model wait is admitted again here; admission is idempotent.
    if (pending.crewExecutionId && (!task.crewExecutionId || routingRun(task).modelRoutingWait))
      await admitRunDuration(
        context.store,
        `\u0000crew-task:${task.id}`,
        pending.crewExecutionId,
        now,
      );
    try {
      if (context.closing || (task.goalId && context.pausedGoals.has(task.goalId))) return pending;
      const coordinator = await context.crewRunner.start(pending);
      const latest = await context.find(task.id);
      if (
        context.closing ||
        !latest ||
        latest.status !== "queued" ||
        latest.updatedAt !== pending.updatedAt
      ) {
        await context.crewRunner.stop(pending);
        return latest ?? task;
      }
      const started = {
        ...latest,
        ...coordinator,
        status: "running" as const,
        startedAt: now,
        updatedAt: context.now(),
        error: undefined,
        needsInput: undefined,
        modelRoutingWait: undefined,
      };
      return await context.write(started);
    } catch (error) {
      const latest = await context.find(task.id);
      if (!latest || latest.status !== "queued" || latest.updatedAt !== pending.updatedAt)
        return latest ?? task;
      if (error instanceof Error && error.name === "CrewRoutingWait") {
        // No eligible model for a crew member: keep the task queued until the next reset.
        const wait = routingWait(error as Error & { nextResetAt?: number });
        // No coordinator was dispatched: the wait is not run time.
        await retractRunDuration(
          context.store,
          `\u0000crew-task:${task.id}`,
          pending.crewExecutionId!,
        );
        const waiting = {
          ...latest,
          modelRoutingWait: wait,
          error: wait.reason,
          updatedAt: context.now(),
        };
        return await context.write(waiting);
      }
      return await context.block(latest, errorMessage(error), context.now());
    }
  }
  if (!task.sessionId) {
    if (!routingWaitDue(task, now)) return task;
    const expected = await context.taskValue(task.id);
    const resolution = await resolveRunModel(context.store, "task.worker", task);
    const routed = await context.transaction(async () => {
      const current = await context.unchangedTask(task.id, expected);
      if (!current) return undefined;
      if (!resolution.ok && resolution.reason === "noEligibleEntry") {
        const wait = routingWait(resolution);
        if (JSON.stringify(routingRun(current).modelRoutingWait) === JSON.stringify(wait))
          return current;
        const waiting = {
          ...current,
          modelRoutingWait: wait,
          error: wait.reason,
          updatedAt: now,
        };
        return context.write(waiting);
      }
      const resolved = {
        ...current,
        ...(resolution.ok ? resolution.target : {}),
        modelRoutingWait: undefined,
        error: routingRun(current).modelRoutingWait ? undefined : current.error,
      };
      return context.write(resolved);
    });
    if (!routed) return (await context.find(task.id)) ?? task;
    if (!resolution.ok && resolution.reason === "noEligibleEntry") return routed;
    task = routed;
  }
  let ready: HostTask;
  try {
    ready = await context.workingCopy(task);
  } catch (error) {
    if (error instanceof TaskPreparationSuperseded) return (await context.find(task.id)) ?? task;
    if ((await context.find(task.id))?.updatedAt !== task.updatedAt) return task;
    return await context.block({ ...task, startedAt: now }, errorMessage(error), now);
  }
  // workingCopy may persist its own managed identity. Capture that exact row,
  // accepting only our original input or its prepared result, never a same-clock
  // owner edit made while preparation awaited the filesystem.
  let preparationExpected = await context.taskValue(task.id);
  const preparedSource =
    preparationExpected === undefined ? undefined : JSON.parse(preparationExpected);
  if (
    !isDeepStrictEqual(preparedSource, JSON.parse(JSON.stringify(task))) &&
    !isDeepStrictEqual(preparedSource, JSON.parse(JSON.stringify(ready)))
  ) {
    if (ready.branch && !task.branch) await context.discard(ready);
    return (await context.find(task.id)) ?? task;
  }
  if (context.closing || (ready.goalId && context.pausedGoals.has(ready.goalId)))
    return (await context.find(task.id)) ?? task;
  if (ready.branch && !ready.dependencyArtifactsPrepared) {
    try {
      for (const id of ready.dependsOn ?? []) {
        const dependency = await context.scheduledTask(id);
        if (dependency?.projectId !== ready.projectId) continue;
        const source = dependency.deliveryCwd ?? (await context.store.project(ready.projectId)).cwd;
        await transferTaskArtifacts(
          source,
          ready.worktreeCwd!,
          dependency.artifactPaths ?? [],
          dependency.artifactHashes,
        );
      }
      ready = { ...ready, dependencyArtifactsPrepared: true };
    } catch (error) {
      // Keep the newly created checkout discoverable and retryable.
      return await context.block(ready, errorMessage(error), now);
    }
  }
  // Legacy non-isolated fallbacks retain serialization. Explicit direct tasks
  // may share a checkout within the owner's configured concurrency limits.
  if (
    ready.isolate !== false &&
    (await someAsync(
      active,
      async (other, index) =>
        other.id !== ready.id &&
        (active.findIndex((entry) => entry.id === ready.id) < 0 ||
          index < active.findIndex((entry) => entry.id === ready.id)) &&
        (other.worktreeCwd ?? (await context.store.project(other.projectId)).cwd) ===
          (ready.worktreeCwd ?? (await context.store.project(ready.projectId)).cwd),
    ))
  )
    return task;
  if (ready.mergeRepair && !ready.mergeRepair.prepared) {
    try {
      const cwd = ready.worktreeCwd!;
      if (!cwd || (await git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"])) !== ready.branch)
        throw new Error("The retained task checkout is not on its recorded branch.");
      const pending = await git(cwd, ["rev-parse", "--verify", "MERGE_HEAD"]).catch(() => "");
      if (pending && pending !== ready.mergeRepair.baseHead)
        throw new Error("The task checkout has a different merge in progress. Work is retained.");
      if (!pending) {
        const dirty = await git(cwd, ["status", "--porcelain"]);
        const resumedReplay = ready.mergeRepair.replayCommit && ready.mergeRepair.replayStarted;
        if (dirty && !resumedReplay)
          throw new Error(
            "The task checkout has changes after review. Work is retained; inspect before integration.",
          );
        // A replay interrupted after staging or committing resumes from those
        // files. Reapply only if the new checkout is still at its empty base.
        const appliedReplay =
          resumedReplay &&
          (dirty || (await git(cwd, ["rev-parse", "HEAD"])) !== ready.mergeRepair.baseHead);
        if (!appliedReplay) {
          if (ready.mergeRepair.replayCommit) {
            if ((await context.find(task.id))?.updatedAt !== task.updatedAt)
              return (await context.find(task.id)) ?? task;
            task = await context.write({
              ...ready,
              mergeRepair: { ...ready.mergeRepair, replayStarted: true },
              updatedAt: now,
            });
            ready = task;
            preparationExpected = await context.taskValue(task.id);
          }
          try {
            await git(
              cwd,
              ready.mergeRepair!.replayCommit
                ? ["cherry-pick", "--no-commit", ready.mergeRepair!.replayCommit]
                : ["merge", "--no-ff", "--no-edit", ready.mergeRepair!.baseHead],
              120000,
            );
          } catch (error) {
            const conflicts = await git(cwd, ["diff", "--name-only", "--diff-filter=U"]);
            if (!conflicts) throw error;
          }
        }
        const conflicts = await git(cwd, ["diff", "--name-only", "--diff-filter=U"]);
        if (conflicts) {
          ready = {
            ...ready,
            mergeRepair: {
              ...ready.mergeRepair!,
              conflicts: conflicts.split(/\r?\n/),
            },
          };
        }
      }
      // A base update with no conflicts needs checks, not a worker turn.
      ready = {
        ...ready,
        mergeRepair: { ...ready.mergeRepair!, prepared: true },
      };
      if (!(await git(cwd, ["diff", "--name-only", "--diff-filter=U"]))) {
        if (ready.mergeRepair!.replayCommit) await context.requireFinalized(ready, cwd);
        if ((await context.find(task.id))?.updatedAt !== task.updatedAt)
          return (await context.find(task.id)) ?? task;
        const next = await context.write({
          ...ready,
          status: "verifying",
          updatedAt: now,
        });
        await context.verify(next);
        return next;
      }
    } catch (error) {
      if ((await context.find(task.id))?.updatedAt !== task.updatedAt)
        return (await context.find(task.id)) ?? task;
      return await context.block(ready, errorMessage(error), now);
    }
  }
  const projectCwd = (await context.store.project(ready.projectId)).cwd;
  const sharedEdits = ready.worktreeCwd ? await context.sharedEdits(projectCwd) : [];
  if ((await context.find(task.id))?.updatedAt !== task.updatedAt)
    return (await context.find(task.id)) ?? task;
  const launchBudget = await context.budgetReason(ready, true);
  if (launchBudget) return await context.budgetBlock(ready, launchBudget, context.now());
  if (ready.preflightRequirements?.length) {
    const report = await context.preflightAt(ready, ready.worktreeCwd ?? projectCwd);
    const current = await context.find(task.id);
    if (!current || current.status !== "queued" || current.updatedAt !== task.updatedAt)
      return current ?? task;
    ready = { ...ready, preflight: report };
    const missing = report.items.filter((item) => item.required && item.state !== "ready");
    if (missing.length)
      return await context.block(
        ready,
        `Preparation requires checked resources: ${missing.map((item) => item.label).join(", ")}.`,
        context.now(),
      );
  }
  const finalLaunchBudget = await context.budgetReason(ready, true);
  if (finalLaunchBudget) return await context.budgetBlock(ready, finalLaunchBudget, context.now());
  const resumable =
    (await context.canResumeAfterHostStop(ready)) ||
    (await canResumeAfterUsageLimit(context, ready, context.now()));
  if (context.closing) return (await context.find(task.id)) ?? task;
  // Persist normalization (including current-checkout defaults and execution
  // cwd) before admission. Every later guard and receipt uses this same source.
  const persistedReady = await context.store.transaction(async () => {
    if (!(await context.unchangedTask(ready.id, preparationExpected))) return undefined;
    const task = await context.write(ready);
    return { task, value: await context.taskValue(task.id) };
  }, "critical");
  if (!persistedReady) return (await context.find(task.id)) ?? task;
  ready = persistedReady.task;
  preparationExpected = persistedReady.value;
  if (ready.workspaceId && context.managed && !ready.workspaceActivityId) {
    const activity = await context.managed.activity.start({
      workspaceId: ready.workspaceId,
      kind: "provider",
      ownerId: ready.id,
    });
    try {
      const activeReady = await context.store.transaction(async () => {
        const current = await context.unchangedTask(ready.id, preparationExpected);
        if (!current) return undefined;
        const task = await context.write({ ...current, workspaceActivityId: activity.id });
        return { task, value: await context.taskValue(task.id) };
      }, "critical");
      if (!activeReady) {
        await context.managed.activity.stop(activity.id);
        return (await context.find(ready.id)) ?? ready;
      }
      ready = activeReady.task;
      preparationExpected = activeReady.value;
    } catch (error) {
      await context.managed.activity.stop(activity.id);
      throw error;
    }
  }
  const recovery = await readAssistantRecovery(context.store, ready.id);
  const recovering = recovery?.state === "queued";
  let launchExpected = preparationExpected;
  let associated: HostTask | undefined;
  const launchState = (task: HostTask) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(task)
          .filter(([key]) => !["updatedAt", "budgetUsage", "runStall"].includes(key))
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    );
  const launchCurrent = async () => {
    const candidate = associated
      ? await context.find(ready.id)
      : await context.unchangedTask(ready.id, launchExpected);
    const current =
      candidate && (!associated || launchState(candidate) === launchState(associated))
        ? candidate
        : undefined;
    if (
      !current ||
      !["queued", "running"].includes(current.status) ||
      (!recovering && !associated && current.status !== "queued") ||
      current.awaitingOwnerRestart ||
      context.closing ||
      assistantRecoveryIdentity(current) !== assistantRecoveryIdentity(ready)
    )
      throw new Error("The task was stopped or changed before worker dispatch.");
    return current;
  };
  const ordinaryAdmission: Parameters<NonNullable<HostEngine["withCommandAdmission"]>>[0] = {
    check: async (stage) => {
      const current = await launchCurrent();
      if (!(await context.goalExecutionAllowed(current.goalId)))
        throw new AssistantTurnPolicyDeferredError();
      if (stage.sessionId) {
        const record = await context.store.session(stage.sessionId),
          session = record.session;
        const expectedCwd = ready.worktreeCwd ?? (await context.store.project(ready.projectId)).cwd;
        if (
          record.projectId !== ready.projectId ||
          (session.worktreeCwd ?? session.cwd) !== expectedCwd ||
          session.harness !== ready.harness ||
          session.model !== ready.model ||
          session.runtimeMode !== ready.runtimeMode ||
          JSON.stringify(session.modelSettings) !== JSON.stringify(ready.modelSettings) ||
          (session.providerAccountId ?? "default") !== (ready.providerAccountId ?? "default") ||
          (stage.runId && record.runId !== stage.runId) ||
          (associated &&
            (current.sessionId !== stage.sessionId ||
              (current.runId !== stage.runId && stage.phase === "provider")))
        )
          throw new Error("The worker launch no longer owns its exact task and session.");
      }
    },
    onAccepted: async (receipt) => {
      if (!receipt.runId) return;
      await context.store.transaction(async () => {
        const current = await launchCurrent();
        associated = await context.write({
          ...current,
          awaitingOwnerRestart: undefined,
          sessionId: receipt.sessionId,
          runId: receipt.runId,
          startedAt: now,
          status: "running",
          updatedAt: now,
        });
        launchExpected = await context.taskValue(ready.id);
      }, "critical");
    },
  };
  if (recovering) {
    if (!context.admitCommand || !context.assistantRecoveryAdmission)
      throw new Error("Guarded assistant recovery admission is unavailable.");
    await context.assistantRecoveryAdmission(ready);
  }
  const launch = () =>
    launchSessionRun(
      context.store,
      context.engine,
      {
        ...ready,
        ...(recovering ? { requestId: recovery!.launchRequestId } : {}),
        ...(ready.isolate === false ? { workspaceMode: "current" as const } : {}),
        author: {
          kind: "task",
          id: ready.id,
          name: ready.title,
          reason: "kickoff",
          ...(recovering ? { operationId: recovery!.operationId } : {}),
        },
        prompt: workerPrompt(ready, projectCwd, sharedEdits),
      },
      async () => {
        await launchCurrent();
        return context.goalExecutionAllowed(ready.goalId);
      },
    );
  const ordinaryLaunch = () => (resumable ? context.resumeInterrupted(ready) : launch());
  const started = !recovering
    ? context.admitCommand
      ? await context.admitCommand(ordinaryAdmission, ordinaryLaunch)
      : await ordinaryLaunch()
    : await context.admitCommand!(
        {
          check: async (stage) => {
            try {
              const current = await context.find(ready.id);
              if (
                !current ||
                !["queued", "running"].includes(current.status) ||
                context.closing ||
                (current.goalId && context.pausedGoals.has(current.goalId)) ||
                assistantRecoveryIdentity(current) !== recovery!.source.identity
              )
                throw new Error("The queued recovery task changed before provider dispatch.");
              const budget = await context.budgetReason(current, true);
              if (budget) throw new Error(budget);
              if (stage.sessionId) {
                const record = await context.store.session(stage.sessionId),
                  session = record.session;
                if (
                  record.projectId !== ready.projectId ||
                  (session.worktreeCwd ?? session.cwd) !== recovery!.source.executionCwd ||
                  session.harness !== ready.harness ||
                  session.model !== ready.model ||
                  session.runtimeMode !== ready.runtimeMode ||
                  JSON.stringify(session.modelSettings) !== JSON.stringify(ready.modelSettings) ||
                  (session.providerAccountId ?? "default") !==
                    (ready.providerAccountId ?? "default") ||
                  (stage.runId && record.runId !== stage.runId) ||
                  (current.status === "running" &&
                    (current.sessionId !== stage.sessionId || current.runId !== stage.runId))
                )
                  throw new Error(
                    "The recovery launch no longer owns its exact new worker source.",
                  );
              }
              await context.assistantRecoveryAdmission!(current, stage);
            } catch (error) {
              await context.assistantRecoveryFailed?.(
                ready,
                `The automatic retry was fenced before provider dispatch: ${String(error).slice(0, 500)}`,
              );
              throw error;
            }
          },
          onAccepted: async (receipt) => {
            if (!receipt.runId) return;
            const current = await readAssistantRecovery(context.store, ready.id);
            if (
              !current ||
              current.operationId !== recovery!.operationId ||
              current.state !== "queued"
            )
              throw new Error("The recovery launch receipt changed before acceptance.");
            await writeAssistantRecovery(context.store, {
              ...current,
              state: "running",
              launchedSessionId: receipt.sessionId,
              launchedRunId: receipt.runId,
              launchedAuthorityGeneration: receipt.authorityGeneration,
              updatedAt: context.now(),
            });
          },
        },
        launch,
      );
  if (started.deferred) {
    await context.stopWorkspaceActivity(ready);
    return await context.store.transaction(async () => {
      const current = await context.unchangedTask(ready.id, launchExpected);
      return current
        ? await context.write({ ...current, workspaceActivityId: undefined, status: "queued" })
        : ((await context.find(ready.id)) ?? ready);
    }, "critical");
  }
  return await context.store.transaction(async () => {
    const current = await context.unchangedTask(ready.id, launchExpected);
    if (!current) return (await context.find(ready.id)) ?? ready;
    const next = {
      ...current,
      awaitingOwnerRestart: undefined,
      sessionId: started.sessionId,
      runId: started.runId,
      startedAt: now,
    };
    if (started.error !== undefined) return context.block(next, started.error, now);
    return associated
      ? current
      : await context.write({ ...next, status: "running", updatedAt: now });
  }, "critical");
}

export async function sharedEdits(_context: TaskContext, projectCwd: string): Promise<string[]> {
  const status = await git(projectCwd, ["status", "--porcelain", "--untracked-files=no"]).catch(
    () => "",
  );
  // `git()` trims the output, so the first line may have lost its leading space.
  const files = status
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^\S{1,2}\s+/, "")
        .replace(/^.* -> /, ""),
    )
    .filter(Boolean);
  return files.length > SHARED_EDITS_LIMIT
    ? [...files.slice(0, SHARED_EDITS_LIMIT), `and ${files.length - SHARED_EDITS_LIMIT} more`]
    : files;
}
