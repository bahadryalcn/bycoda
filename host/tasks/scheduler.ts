import {
  assistantRecoveryHoldsTask,
  readAssistantRecovery,
} from "../assistant/work/assistant-worker-recovery";
import { isDeepStrictEqual } from "node:util";

import type { TaskRunBudgetUsage } from "../../src/features/tasks/model/taskBudget";
import {
  canTakeOverBlockedTask,
  TASK_INPUT_REQUIRED,
  taskRequiresInstructions,
  hasUnmergedBranch,
  type HostTask,
} from "../../src/features/tasks/model/hostTasks";
import { hostGitRepositoryKey } from "../git/git-mutations";
import { errorMessage, sessionRunState } from "../sessions/sessionRuns";
import { sameWait } from "./stop-reasons";
import { taskAwaitsRestart, type TaskWait } from "../../src/shared/model/host-contracts/task-stop";
import { TICK_MS } from "./constants";
import { TASK_HISTORY_RETAINED } from "./constants";
import type { TaskContext } from "./context";
import { stopTaskRuntimeRuns } from "../work/runtime-budget";
import { workCrewId } from "../../src/shared/model/host-contracts/work-executor";

/**
 * Whether a fresh ledger reading differs from the persisted usage enough to rewrite the
 * task row. Every row write bumps the global task cache, the change etag and the history
 * journal, so the measurement time and the elapsed minutes of a still-running run (which
 * grow on every tick) never count: the ledger stays the metering source, budget deadlines
 * read it directly, and any real transition rewrites the row with exact usage.
 */
export function budgetUsageChanged(
  previous: TaskRunBudgetUsage | undefined,
  current: TaskRunBudgetUsage,
): boolean {
  const { measuredAt: _measuredAt, ...material } = current;
  if (previous && current.runningRuns > 0 && previous.runningRuns === current.runningRuns) {
    const { agentMinutes: _minutes, ...stable } = material;
    const {
      agentMinutes: _previousMinutes,
      measuredAt: _previousMeasuredAt,
      ...stableBefore
    } = previous;
    return !isDeepStrictEqual(stable, stableBefore);
  }
  const { measuredAt: _previousMeasuredAt, ...before } = previous ?? {};
  return !isDeepStrictEqual(material, before);
}

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

const historyCutoff = (context: TaskContext) =>
  context.store.db
    .prepare("SELECT sequence FROM task_history ORDER BY sequence DESC LIMIT 1 OFFSET ?")
    .get(TASK_HISTORY_RETAINED);

export async function work(context: TaskContext): Promise<void> {
  const now = context.now();
  // Idle Hosts have nothing to prune on most ticks: look without BEGIN IMMEDIATE, keeping the
  // read in the same SQL FIFO as writers, and open the write transaction only when a row is due.
  const due = await context.store.db.scope(async () => Boolean(await historyCutoff(context)));
  if (due) {
    await context.store.transaction(async () => {
      // Re-check inside the transaction: another writer may have pruned or shrunk history since.
      const cutoff = await historyCutoff(context);
      if (!cutoff) return;
      const sequence = Number(cutoff.sequence);
      const removed = await context.store.db
        .prepare(
          "SELECT coalesce(max(effective_at),0) AS latest FROM task_history WHERE sequence<=?",
        )
        .get(sequence);
      await context.store.db
        .prepare("UPDATE task_history_floor SET sequence=max(sequence, ?) WHERE id=1")
        .run(sequence);
      await context.store.db
        .prepare("UPDATE task_history_meta SET available_from=max(available_from, ?) WHERE id=1")
        .run(Math.max(now, Number(removed!.latest)));
      await context.store.db.prepare("DELETE FROM task_history WHERE sequence<=?").run(sequence);
    });
  }
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
  const unfinishedDependency = async (task: HostTask): Promise<HostTask | undefined> => {
    const unfinished: HostTask[] = [];
    for (const id of task.dependsOn ?? []) {
      const dependency = await context.scheduledTask(id);
      if (dependency && (dependency.status !== "done" || hasUnmergedBranch(dependency)))
        unfinished.push(dependency);
    }
    // A stopped dependency explains the wait better than one that is merely unfinished.
    return unfinished.find((dependency) => dependency.status === "blocked") ?? unfinished[0];
  };
  const hasUnfinishedDependencies = async (task: HostTask) =>
    (await unfinishedDependency(task)) !== undefined;
  /** Record why a queued task is not starting; written once per reason. */
  const hold = async (task: HostTask, wait: TaskWait): Promise<HostTask> => {
    if (task.status !== "queued" || sameWait(task.wait, wait)) return task;
    const written = await context.write({ ...task, wait, error: undefined, updatedAt: now });
    byId.set(written.id, written);
    return written;
  };
  /** A queued task waits on its unfinished dependency; one the owner stopped stops it too. */
  const holdOnDependency = async (task: HostTask, dependency: HostTask): Promise<void> => {
    if (dependency.status === "blocked" && dependency.stop?.code === "owner_stopped") {
      const stopped = await context.block(
        task,
        {
          code: "dependency_stopped",
          phase: "scheduling",
          message: `Dependency ${dependency.title} was stopped. Restart or remove it before this task can run.`,
        },
        now,
      );
      byId.set(stopped.id, stopped);
      return;
    }
    await hold(task, {
      code: "dependency",
      waitsOn: {
        taskId: dependency.id,
        ...(dependency.status === "blocked" && dependency.stop
          ? { code: dependency.stop.code }
          : {}),
      },
      message: `Waiting for ${dependency.title}.`,
    });
  };
  // A newly failed task remains visibly blocked until the next scheduler tick.
  const takeoverCandidates = new Set(initial.filter(canTakeOverBlockedTask).map((task) => task.id));
  for (let task of initial) {
    if (taskAwaitsRestart(task) && task.status !== "running" && task.status !== "verifying")
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
        const fresh = await context.unchangedTask(task.id, maintenanceRows.get(task.id));
        if (!fresh) continue;
        if (budgetUsageChanged(task.budgetUsage, usage)) {
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
      if (
        budgetReason &&
        (budgetRunActive ||
          (await context.budgets.read({ taskId: parent?.id ?? task.id })).runningRuns > 0)
      ) {
        await stopTaskRuntimeRuns(context.store, context.engine, parent?.id ?? task.id, budgetRun);
        if (workCrewId(task)) await context.crewRunner?.stop(task);
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
          {
            code: "dependency_cycle",
            phase: "scheduling",
            message: `Task dependency cycle: ${cycle.join(" -> ")}. Edit the dependencies before requeuing.`,
          },
          now,
        );
      else if (
        task.status === "blocked" &&
        task.stop?.code === "host_interrupted" &&
        (await context.canResumeAfterHostStop(task))
      )
        await context.requeueInterrupted(task, now);
      else if (task.status === "running" && workCrewId(task))
        maintain(task, async (fresh) => await context.settleCrew(fresh, now));
      else if (task.status === "running") await context.settle(task, now);
      else if (task.status === "verifying")
        maintain(task, async (fresh) => await context.settleVerification(fresh, now));
      else if (
        task.status === "review" &&
        (task.autoMerge || task.deliveryRequested) &&
        !task.deliveryApprovalRequired &&
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
  const clearWait = async (task: HostTask): Promise<HostTask> => {
    const written = await context.write({ ...task, wait: undefined, updatedAt: now });
    byId.set(written.id, written);
    return written;
  };
  const launchQueued = async () => {
    if (context.closing) return;
    const tasks = Array.from(byId.values()).sort(
      (a, b) => (a.position ?? a.createdAt) - (b.position ?? b.createdAt),
    );
    // Coordinators wait for their workers; counting them as a worker slot
    // deadlocks a team on hosts configured to run one task at a time.
    const active = tasks.filter(
      (task) => !workCrewId(task) && (task.status === "running" || task.status === "verifying"),
    );
    // Logical crew parents can wait idle after their coordinator turn retires.
    // Bound only preparations in this pass; shared Work enforces physical capacity.
    const teams: HostTask[] = [];
    const { maxRunningTasks } = await context.limits.settings();
    const launches: Promise<void>[] = [];
    for (const candidate of tasks) {
      if (context.closing) return;
      // An awaited launch may have allowed edits/deletions to later tasks.
      let task = byId.get(candidate.id);
      if (!task || context.jobs.has(task.id)) continue;
      if (assistantRecoveryHoldsTask(await readAssistantRecovery(context.store, task.id), task))
        continue;
      // Keep instruction errors visible, but avoid expensive admission reads
      // for work whose dependency is already known to be unfinished.
      if (
        task.status !== "queued" &&
        !(takeoverCandidates.has(task.id) && canTakeOverBlockedTask(task))
      )
        continue;
      if (task.status === "queued" && !taskRequiresInstructions(task)) {
        const dependency = await unfinishedDependency(task);
        if (dependency) {
          await holdOnDependency(task, dependency);
          continue;
        }
        if (task.wait?.code === "dependency") task = await clearWait(task);
      } else if (
        takeoverCandidates.has(task.id) &&
        canTakeOverBlockedTask(task) &&
        (await hasUnfinishedDependencies(task))
      )
        continue;
      if (
        (workCrewId(task) ? teams : active).length +
          (workCrewId(task)
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
      if (context.assistantTaskAdmission && !(await context.assistantTaskAdmission(task))) {
        await hold(task, {
          code: "assistant_hold",
          message: "Held by the assistant job that owns this task.",
        });
        continue;
      }
      if (task.repairAdvisor) {
        await context.repairOrBlock(task, task.repairAdvisor.error, now);
        continue;
      }
      if (task.goalId && context.pausedGoals.has(task.goalId)) continue;
      if (context.crewCanStart && !(await context.crewCanStart(task))) {
        await hold(task, {
          code: "crew_capacity",
          message: "Waiting for the crew to have capacity to start this task.",
        });
        continue;
      }
      const goalId = task.goalId;
      if (goalId) {
        const goal = await context.owningGoal(goalId);
        if (goal?.status === "cancelled") continue;
        if (
          goal?.maxRunningTasks &&
          active.filter((item) => item.goalId === goalId).length >= goal.maxRunningTasks
        )
          continue;
      }
      if (taskRequiresInstructions(task)) {
        await context.block(
          task,
          { code: "input_required", phase: "scheduling", message: TASK_INPUT_REQUIRED },
          now,
        );
        continue;
      }
      // Used-up daily time holds queued work back; running work finishes.
      if (await context.limits.reached()) {
        const daily: TaskWait = {
          code: "daily_limit",
          message: "The daily agent-time limit is reached. Queued work starts once it resets.",
        };
        // Every queued task that is not already waiting on something more specific.
        for (const queued of byId.values())
          if (queued.status === "queued" && queued.wait?.code !== "dependency")
            await hold(queued, daily);
        break;
      }
      if (task.wait?.code === "daily_limit") task = await clearWait(task);
      // A task waits for every task it depends on to be merged, and then
      // starts from the project as it is, with their work in it.
      if (await hasUnfinishedDependencies(task)) continue;
      if (task.wait && ["dependency", "crew_capacity", "assistant_hold"].includes(task.wait.code))
        task = await clearWait(task);
      // Reserve policy capacity before any asynchronous preparation. Independent
      // work may prepare concurrently; dependencies and final revision checks stay
      // inside launch, and fallback shared checkouts retain their ordered gate.
      const reserved = task;
      const slots = workCrewId(task) ? teams : active;
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
