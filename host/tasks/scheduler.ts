import { someAsync } from "../async-collections";
import {
  assistantRecoveryHoldsTask,
  readAssistantRecovery,
} from "../assistant/work/assistant-worker-recovery";
import { isDeepStrictEqual } from "node:util";

import {
  canTakeOverBlockedTask,
  TASK_INPUT_REQUIRED,
  taskRequiresInstructions,
  hasUnmergedBranch,
  type HostTask,
} from "../../src/features/tasks/model/hostTasks";
import { hostGitRepositoryKey } from "../git/git-mutations";
import {
  HOST_INTERRUPTED,
  cancelSessionRun,
  errorMessage,
  sessionRunState,
} from "../sessions/sessionRuns";
import { TICK_MS } from "./constants";
import { TASK_HISTORY_RETAINED } from "./constants";
import type { TaskContext } from "./context";
export function start(context: TaskContext): void {
  if (context.closing || context.timer) return;
  context.store.db.outsideScope(() => {
    const kick = () =>
      void context.ready
        .then(() => context.tick())
        .catch((error) => console.error("Task scheduling failed:", error));
    kick();
    context.timer = setInterval(kick, TICK_MS);
    context.timer.unref?.();
  });
}

export function stop(context: TaskContext): void {
  clearInterval(context.timer);
  context.timer = undefined;
}

export function close(context: TaskContext): Promise<void> {
  if (context.disposal) return context.disposal;
  context.closing = true;
  context.stop();
  for (const controller of context.jobControllers.values()) controller.abort();
  context.disposal = context.idle();
  return context.disposal;
}

export function onTick(context: TaskContext, hook: () => Promise<void> | void): void {
  context.beforeStart = hook;
}

export async function idle(context: TaskContext): Promise<void> {
  await context.ready;
  const failures: unknown[] = [];
  while (context.ticking || context.jobs.size) {
    const results = await Promise.allSettled([
      ...(context.ticking ? [context.ticking] : []),
      ...context.jobs.values(),
    ]);
    for (const result of results) if (result.status === "rejected") failures.push(result.reason);
  }
  if (failures.length) throw new AggregateError(failures, "Task work failed while draining.");
}

export function tick(context: TaskContext): Promise<void> {
  if (context.closing) return Promise.resolve();
  context.ticking ??= context.work().finally(() => {
    context.schedulerTasks = undefined;
    context.ticking = undefined;
  });
  return context.ticking;
}

export async function work(context: TaskContext): Promise<void> {
  const now = context.now();
  await context.store.transaction(async () => {
    const cutoff = await context.store.db
      .prepare("SELECT sequence FROM task_history ORDER BY sequence DESC LIMIT 1 OFFSET ?")
      .get(TASK_HISTORY_RETAINED);
    if (!cutoff) return;
    const sequence = Number(cutoff.sequence);
    const removed = await context.store.db
      .prepare("SELECT coalesce(max(effective_at),0) AS latest FROM task_history WHERE sequence<=?")
      .get(sequence);
    await context.store.db
      .prepare("UPDATE task_history_floor SET sequence=max(sequence, ?) WHERE id=1")
      .run(sequence);
    await context.store.db
      .prepare("UPDATE task_history_meta SET available_from=max(available_from, ?) WHERE id=1")
      .run(Math.max(now, Number(removed!.latest)));
    await context.store.db.prepare("DELETE FROM task_history WHERE sequence<=?").run(sequence);
  });
  // Refresh once per tick, including persisted recovery edits made outside
  // this board. All later reads in this pass use the live index below.
  const maintenanceRows = new Map<string, string>();
  const byId = await context.schedulerSnapshot(true, maintenanceRows);
  const initial = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
  context.schedulerTasks = byId;
  const maintenance: Promise<void>[] = [];
  const maintenanceLanes = new Map<string, Promise<void>>();
  let maintenanceAdmission: Promise<unknown> = Promise.resolve();
  let maintenanceActive = 0;
  const maintenanceWaiters: (() => void)[] = [];
  const maintain = (task: HostTask, work: (fresh: HostTask) => Promise<unknown>) => {
    const expected = maintenanceRows.get(task.id);
    // Resolve aliases in enqueue order without holding admission for the work.
    const admitted = maintenanceAdmission.then(async () => {
      const key = await hostGitRepositoryKey((await context.store.project(task.projectId)).cwd);
      const operation = (maintenanceLanes.get(key) ?? Promise.resolve()).then(async () => {
        if (maintenanceActive >= 4)
          await new Promise<void>((resolve) => maintenanceWaiters.push(resolve));
        else maintenanceActive++;
        try {
          // A goal hook, owner edit or another board may have stopped/replaced
          // this task while its lane was queued, even at the same timestamp.
          const fresh = await context.unchangedTask(task.id, expected);
          if (fresh) await work(fresh);
        } finally {
          const next = maintenanceWaiters.shift();
          if (next) next();
          else maintenanceActive--;
        }
      });
      maintenanceLanes.set(
        key,
        operation.catch(() => undefined),
      );
      return { operation };
    });
    maintenanceAdmission = admitted.then(
      () => undefined,
      () => undefined,
    );
    const operation = admitted
      .then(({ operation }) => operation)
      .catch((error) => {
        console.error("Could not settle a task:", errorMessage(error));
      });
    maintenance.push(operation);
    return operation;
  };
  const hasUnfinishedDependencies = async (task: HostTask) =>
    await someAsync(task.dependsOn ?? [], async (id) => {
      const dependency = await context.scheduledTask(id);
      return (
        dependency !== undefined && (dependency.status !== "done" || hasUnmergedBranch(dependency))
      );
    });
  // A newly failed task remains visibly blocked until the next scheduler tick.
  const takeoverCandidates = new Set(initial.filter(canTakeOverBlockedTask).map((task) => task.id));
  for (let task of initial) {
    if (task.awaitingOwnerRestart && task.status !== "running" && task.status !== "verifying")
      continue;
    try {
      const activeStatus = task.status === "running" || task.status === "verifying";
      const parent = activeStatus ? await context.budgetParent(task) : undefined;
      const goalId = task.goalId ?? parent?.goalId;
      const configuredBudget =
        task.budget ??
        parent?.budget ??
        (activeStatus && goalId ? (await context.owningGoal(goalId))?.budget : undefined);
      if (activeStatus && configuredBudget && task.budgetUsage?.measuredAt !== now) {
        const usage = await context.budgets.read({ taskId: task.id });
        const { measuredAt: _measuredAt, ...materialUsage } = usage;
        const { measuredAt: _previousMeasuredAt, ...previousMaterialUsage } =
          task.budgetUsage ?? {};
        const fresh = await context.unchangedTask(task.id, maintenanceRows.get(task.id));
        if (!fresh) continue;
        if (!isDeepStrictEqual(materialUsage, previousMaterialUsage)) {
          // Owner edits made by onChange still invalidate the queued operation.
          task = await context.write(fresh, maintenanceRows);
        }
      }
      const budgetReason = activeStatus ? await context.budgetReason(task) : undefined;
      const budgetRun = task.status === "verifying" && task.reviewer ? task.reviewer : task;
      const budgetRunActive =
        (task.status === "running" || task.status === "verifying") &&
        (
          await sessionRunState(
            context.store,
            { ...budgetRun, startedAt: budgetRun.startedAt ?? task.createdAt },
            0,
            now,
          )
        ).state === "running";
      if (budgetReason && budgetRunActive) {
        if (task.crewDefinitionId) await context.crewRunner?.stop(task);
        else
          await cancelSessionRun(
            context.engine,
            task.status === "verifying" && task.reviewer ? task.reviewer : task,
          );
        context.jobControllers.get(task.id)?.abort();
        await context.budgetBlock(task, budgetReason, now);
        continue;
      }
      if (assistantRecoveryHoldsTask(await readAssistantRecovery(context.store, task.id), task))
        continue;
      const cycle = task.status === "queued" ? context.dependencyCycle(task.id, byId) : undefined;
      if (cycle)
        await context.block(
          task,
          `Task dependency cycle: ${cycle.join(" -> ")}. Edit the dependencies before requeuing.`,
          now,
        );
      else if (
        task.status === "blocked" &&
        task.error === HOST_INTERRUPTED &&
        (await context.canResumeAfterHostStop(task))
      )
        await context.requeueInterrupted(task, now);
      else if (task.status === "running" && task.crewDefinitionId)
        maintain(task, async (fresh) => await context.settleCrew(fresh, now));
      else if (task.status === "running") await context.settle(task, now);
      else if (task.status === "verifying")
        maintain(task, async (fresh) => await context.settleVerification(fresh, now));
      else if (
        task.status === "review" &&
        (task.autoMerge || task.deliveryRequested) &&
        hasUnmergedBranch(task)
      )
        maintain(task, async (fresh) => await context.recoverMerge(fresh, now));
      else if (
        task.status === "done" &&
        task.merged &&
        !context.delivering.has(task.id) &&
        (task.worktreeCwd || task.historyRecovery?.some((entry) => entry.worktreeCwd))
      ) {
        context.delivering.add(task.id);
        maintain(task, async (fresh) => await context.cleanupDelivered(fresh, now)).finally(() => {
          context.delivering.delete(task.id);
        });
      }
    } catch (error) {
      console.error("Could not settle a task:", errorMessage(error));
    }
  }
  try {
    if (!context.closing) await context.beforeStart?.();
  } catch (error) {
    console.error("Could not update goals:", errorMessage(error));
  }
  const launchQueued = async () => {
    if (context.closing) return;
    const tasks = Array.from(byId.values()).sort(
      (a, b) => (a.position ?? a.createdAt) - (b.position ?? b.createdAt),
    );
    // Coordinators wait for their workers; counting them as a worker slot
    // deadlocks a team on hosts configured to run one task at a time.
    const active = tasks.filter(
      (task) =>
        !task.crewDefinitionId && (task.status === "running" || task.status === "verifying"),
    );
    const teams = tasks.filter((task) => task.crewDefinitionId && task.status === "running");
    const { maxRunningTasks } = await context.limits.settings();
    const launches: Promise<void>[] = [];
    for (const candidate of tasks) {
      if (context.closing) return;
      // An awaited launch may have allowed edits/deletions to later tasks.
      let task = byId.get(candidate.id);
      if (!task || context.jobs.has(task.id)) continue;
      if (assistantRecoveryHoldsTask(await readAssistantRecovery(context.store, task.id), task))
        continue;
      if (
        (task.crewDefinitionId ? teams : active).length +
          (task.crewDefinitionId
            ? 0
            : (await Promise.all(context.externalRunSources.map((source) => source()))).reduce(
                (sum, value) => sum + value,
                0,
              )) >=
        maxRunningTasks
      )
        continue;
      if (
        takeoverCandidates.has(task.id) &&
        canTakeOverBlockedTask(task) &&
        (await context.takeoverGoalActive(task))
      ) {
        if ((await context.limits.reached()) || (await hasUnfinishedDependencies(task))) continue;
        task = await context.queueTakeover(task, now);
      }
      if (task.status !== "queued") continue;
      if (task.goalId && context.pausedGoals.has(task.goalId)) continue;
      if (context.crewCanStart && !(await context.crewCanStart(task))) continue;
      if (task.goalId) {
        const goal = await context.owningGoal(task.goalId);
        if (goal?.status === "cancelled") continue;
        if (
          goal?.maxRunningTasks &&
          active.filter((item) => item.goalId === task.goalId).length >= goal.maxRunningTasks
        )
          continue;
      }
      if (taskRequiresInstructions(task)) {
        await context.block(task, TASK_INPUT_REQUIRED, now);
        continue;
      }
      // Used-up daily time holds queued work back; running work finishes.
      if (await context.limits.reached()) break;
      // A task waits for every task it depends on to be merged, and then
      // starts from the project as it is, with their work in it.
      if (await hasUnfinishedDependencies(task)) continue;
      // Reserve policy capacity before any asynchronous preparation. Independent
      // work may prepare concurrently; dependencies and final revision checks stay
      // inside launch, and fallback shared checkouts retain their ordered gate.
      const reserved = task;
      const slots = task.crewDefinitionId ? teams : active;
      slots.push(reserved);
      launches.push(
        context
          .launch(task, now, active)
          .then((started) => {
            const index = slots.indexOf(reserved);
            if (index < 0) return;
            if (started.status === "running" || started.status === "verifying")
              slots[index] = started;
            else slots.splice(index, 1);
          })
          .catch((error) => {
            const index = slots.indexOf(reserved);
            if (index >= 0) slots.splice(index, 1);
            console.error("Could not start a task:", errorMessage(error));
          }),
      );
    }
    await Promise.all(launches);
  };
  await launchQueued();
  if (maintenance.length) {
    await Promise.all(maintenance);
    // Settlement may free slots or complete a dependency. Preserve the public
    // tick's completed-settlement contract without holding independent starts.
    try {
      if (!context.closing) await context.beforeStart?.();
    } catch (error) {
      console.error("Could not update goals:", errorMessage(error));
    }
    await launchQueued();
  }
}
