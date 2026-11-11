import { flatMapAsync, mapAsync, someAsync } from "../async-collections";
import { deferredAssistantTurn } from "../assistant/core/assistant-turn-policy";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { assertExpectedConfiguration } from "../configurationConflict";
import { resolveHostWorktreeAsync } from "../git/git-worktrees";
import {
  GOAL_CANCELLED,
  goalStateFromTasks,
  goalPlanNeedsApproval,
  goalPlanReviews,
  parseGoalPlan,
  parseHostGoal,
  type GoalPlan,
  type GoalSettings,
} from "../../src/features/tasks/model/hostGoals";
import {
  STOPPED_BY_USER,
  HOST_INTERRUPTED,
  cancelSessionRun,
  errorMessage,
  launchSessionRun,
  sessionRunState,
  type SessionRunEngine,
} from "../sessions/sessionRuns";
import type { HostStore } from "../store";
import type { HostTasks } from "../tasks/tasks";
import { newRequestId } from "../../src/shared/lib/id/requestId";
import {
  FINAL_ACCEPTANCE_CRITERIA,
  finalReviewPrompt,
  finalTaskFingerprint,
  plannerPrompt,
  type HostGoal,
} from "./goal-prompts";
import {
  NO_VERDICT,
  parseReviewVerdict,
  type HostTask,
} from "../../src/features/tasks/model/hostTasks";
import {
  acceptanceReviewInstructions,
  hasTaskAcceptanceReport,
  parseTaskAcceptance,
} from "../../src/features/tasks/model/taskAcceptance";
import { hasUnmergedBranch, orderTasksForDeletion } from "../../src/features/tasks/model/taskRules";
const FEEDBACK_LIMIT = 8000;
const MAX_PLANNER_FORMAT_REPAIRS = 2;
/** Breaks one main job into tasks across several of this machine's projects
 * and follows them to the end. A planner agent writes the plan in the lead
 * project; each planned task is an ordinary task on the board, on a branch of
 * its own, that starts once the tasks it depends on are merged. Runs on the
 * task board's timer. */
export class HostGoals {
  onDelete?: (goal: { id: string }) => void;
  readonly ready: Promise<void>;
  private readonly engine: SessionRunEngine;
  private readonly assistantPlanning = new Set<string>();
  private readonly retiredAssistantGoals = new Set<string>();
  constructor(
    private readonly store: HostStore,
    engine: SessionRunEngine,
    private readonly tasks: HostTasks,
    private readonly now: () => number = Date.now,
  ) {
    // The Store's AsyncLocal authorization follows an admitted owner request
    // across preparation and SQL waits. Scheduler calls have no request grant.
    this.engine = {
      withCommandAdmission: engine.withCommandAdmission?.bind(engine),
      withMessageAuthor: (author, work) => {
        const perform = () =>
          engine.withMessageAuthor ? engine.withMessageAuthor(author, work) : work();
        if (author.kind !== "task") return perform();
        const check = async () => {
          if (this.tasks.isAssistantDeletionHeld(author.id))
            throw new Error("This goal is held for owner-reviewed deletion.");
          if (author.id.startsWith("assistant-")) {
            const current = await this.find(author.id);
            if (!current || current.status === "cancelled" || current.awaitingOwnerRestart)
              throw new Error(
                "The original assistant goal was deleted or awaits an explicit owner restart.",
              );
          }
        };
        if (engine.withCommandAdmission) return engine.withCommandAdmission({ check }, perform);
        return check().then(perform);
      },
      command: async (command) => {
        await store.db.checkAuthorization();
        return engine.command(command);
      },
      updateSession: async (id, patch) => {
        await store.db.checkAuthorization();
        return engine.updateSession(id, patch);
      },
    };
    this.ready = (async () => {
      await store.ready;
      await tasks.ready;
      await store.db.scope(async () => {
        await store.db.exec(
          "CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, value TEXT NOT NULL);",
        );
        await store.db.exec(
          "CREATE INDEX IF NOT EXISTS goals_scheduler_status ON goals(json_extract(value, '$.status'))",
        );
        await store.db.exec(
          "UPDATE goals SET value=json_set(json_remove(value, '$.autoMerge'), '$.deliveryApprovalRequired', json('true')) WHERE json_extract(value, '$.autoMerge')=1",
        );
        // An upgraded host must not turn unrecorded planner/final-review history into zero usage.
        const hasRecordedRun = store.db.prepare(
          "SELECT 1 FROM task_run_budget_ledger WHERE session_id=? AND run_id=? AND goal_id=?",
        );
        for (const goal of await this.all()) {
          const finalReceipt = goal.finalAcceptance?.requestId
            ? await store.receiptStatus(`goal-final:${goal.finalAcceptance.requestId}:send`)
            : undefined;
          if (
            finalReceipt?.runId &&
            goal.finalAcceptance?.startedAt !== undefined &&
            !(await hasRecordedRun.get(finalReceipt.sessionId, finalReceipt.runId, goal.id))
          )
            await tasks.budgets.register({
              goalId: goal.id,
              role: "final-review",
              sessionId: finalReceipt.sessionId,
              runId: finalReceipt.runId,
              startedAt: goal.finalAcceptance.startedAt,
            });
          const runs = [
            ...(goal.plannerSessionId || goal.plannerStartedAt !== undefined
              ? [{ sessionId: goal.plannerSessionId, runId: goal.plannerRunId }]
              : []),
            ...(goal.finalAcceptance?.sessionId || goal.finalAcceptance?.startedAt !== undefined
              ? [
                  {
                    sessionId: goal.finalAcceptance.sessionId ?? finalReceipt?.sessionId,
                    runId: goal.finalAcceptance.runId ?? finalReceipt?.runId,
                  },
                ]
              : []),
            ...(goal.finalAcceptanceHistory ?? []).filter((run) => run.sessionId),
          ];
          if (
            await someAsync(
              runs,
              async (run) =>
                !run.sessionId ||
                !run.runId ||
                !(await hasRecordedRun.get(run.sessionId, run.runId, goal.id)),
            )
          )
            await tasks.budgets.markUnknownHistory({ goalId: goal.id });
        }
        tasks.onTick(async () => await this.work());
        tasks.limits.trackRuns(async () =>
          (await this.all(false, true)).flatMap((goal) =>
            goal.status === "planning" && goal.plannerSessionId && goal.plannerRunId
              ? [{ sessionId: goal.plannerSessionId, runId: goal.plannerRunId }]
              : goal.status === "running" &&
                  goal.finalAcceptance?.status === "running" &&
                  goal.finalAcceptance.sessionId &&
                  goal.finalAcceptance.runId &&
                  goal.finalAcceptance.accountedRunId !== goal.finalAcceptance.runId
                ? [{ sessionId: goal.finalAcceptance.sessionId, runId: goal.finalAcceptance.runId }]
                : [],
          ),
        );
        tasks.trackExternalRuns(async () => await this.runningFinalReviews());
      });
    })();
  }
  /** Bind only this operation, never the persisted goal's autonomous lifetime. */
  withAuthorization<T>(authorized: () => Promise<boolean>, work: () => Promise<T>): Promise<T> {
    return this.store.db.withAuthorization(authorized, async () => {
      await this.store.db.checkAuthorization();
      return work();
    });
  }
  /** The task board's tick, which settles planners and goal progress. */
  tick(): Promise<void> {
    return this.tasks.tick();
  }
  /** Oldest first, with their progress brought up to date. */
  async list(): Promise<HostGoal[]> {
    await this.ready;

    return await this.store.db.scope(async () => {
      await this.follow(this.now());
      return await mapAsync(await this.all(), async (goal) => ({
        ...goal,
        budgetUsage: await this.tasks.budgets.read({ goalId: goal.id }),
      }));
    });
  }
  /** Adds a goal and starts its planner. */
  async create(raw: unknown): Promise<HostGoal> {
    await this.ready;
    const input = parseHostGoal(raw);
    if (await this.find(input.id)) throw new Error("This goal already exists.");
    for (const projectId of input.projectIds) await this.store.project(projectId);
    const now = this.now();
    const goal: HostGoal = {
      ...input,
      status: "planning",
      taskIds: [],
      createdAt: now,
      updatedAt: now,
    };
    const writeFirst = (raw as { expectedAbsent?: unknown }).expectedAbsent === true;
    if (!writeFirst && !input.id.startsWith("assistant-")) return this.plan(goal);
    const admitted = await this.store.transaction(async () => {
      if (await this.find(input.id)) throw new Error("This goal already exists.");
      return this.write(goal);
    });
    return this.plan(admitted, admitted);
  }
  /** Updates operational settings and existing tasks atomically. */
  async update(id: string, raw: unknown, expectedUpdatedAt: unknown): Promise<HostGoal> {
    await this.ready;

    const goal = await this.get(id);
    if (expectedUpdatedAt !== goal.updatedAt)
      throw new Error("This goal changed. Close and reopen settings before saving.");
    if (goal.status === "done" || goal.status === "cancelled")
      throw new Error("Only an active goal can be edited.");
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("Invalid goal settings");
    const settings = raw as GoalSettings;
    const keys = ["autoMerge", "continueUntilDone", "maxRunningTasks", "maxRunMinutes", "budget"];
    if (
      Object.keys(raw).some((key) => !keys.includes(key)) ||
      typeof settings.autoMerge !== "boolean" ||
      typeof settings.continueUntilDone !== "boolean" ||
      !Number.isInteger(settings.maxRunningTasks) ||
      settings.maxRunningTasks < 0 ||
      !Number.isInteger(settings.maxRunMinutes)
    )
      throw new Error("Invalid goal settings");
    if (settings.autoMerge && goal.isolate === false)
      throw new Error("Automatic merge requires isolated tasks.");
    if (goal.status === "planning" && settings.maxRunMinutes !== goal.maxRunMinutes)
      throw new Error("Wait for planning to finish before changing the run limit.");
    const parsed = parseHostGoal({
      ...goal,
      ...settings,
      maxRunningTasks: settings.maxRunningTasks || undefined,
    });
    const now = this.now();
    const updated = await this.tasks.transaction(async () => {
      const current = await this.get(id);
      if (current.updatedAt !== expectedUpdatedAt || !isDeepStrictEqual(current, goal))
        throw new Error("This goal changed. Close and reopen settings before saving.");
      await this.tasks.updateGoalSettings(goal.id, goal.taskIds, {
        autoMerge: false,
        ...(Boolean(goal.continueUntilDone) !== settings.continueUntilDone
          ? { continueUntilDone: settings.continueUntilDone }
          : {}),
        ...(goal.maxRunMinutes !== settings.maxRunMinutes
          ? { maxRunMinutes: settings.maxRunMinutes }
          : {}),
      });
      return await this.write({
        ...goal,
        autoMerge: undefined,
        deliveryApprovalRequired: parsed.autoMerge || goal.deliveryApprovalRequired || undefined,
        continueUntilDone: parsed.continueUntilDone,
        maxRunningTasks: parsed.maxRunningTasks,
        maxRunMinutes: parsed.maxRunMinutes,
        budget: parsed.budget,
        budgetStop: undefined,
        updatedAt: Math.max(now, goal.updatedAt + 1),
      });
    });
    this.store.afterCommit(() => {
      void this.tasks.tick().catch((error) => console.error("Goal task scheduling failed:", error));
    });
    return updated;
  }
  /** Creates the tasks of a plan the owner approved. */
  async approve(id: string): Promise<HostGoal> {
    await this.ready;

    const goal = await this.get(id);
    if (goal.status !== "awaiting-approval")
      throw new Error("Only a plan waiting for approval can be approved.");
    const next = await this.start(goal, this.now());
    this.store.afterCommit(() => {
      void this.tasks.tick().catch((error) => console.error("Goal task scheduling failed:", error));
    });
    return next;
  }
  /** Plans again, from a plan waiting for approval or a failed planning,
   * with the owner's feedback when given. */
  async replan(id: string, feedback?: unknown, reviewed?: HostGoal): Promise<HostGoal> {
    await this.ready;

    const goal = await this.get(id);
    if (reviewed) {
      assertExpectedConfiguration({ expectedConfiguration: reviewed }, goal, parseHostGoal);
      if (reviewed.updatedAt !== goal.updatedAt || reviewed.status !== goal.status)
        throw new Error("Goal changed after review. Read it again.");
    }
    const failedPlanning = goal.status === "blocked" && !goal.taskIds.length;
    if (goal.status !== "awaiting-approval" && !failedPlanning)
      throw new Error("Only a goal whose plan was not started can be planned again.");
    if (
      feedback !== undefined &&
      (typeof feedback !== "string" || feedback.length > FEEDBACK_LIMIT || feedback.includes("\0"))
    )
      throw new Error("Invalid plan feedback");
    const {
      plan,
      planError,
      plannerSessionId,
      plannerRunId,
      plannerStartedAt,
      plannerRepairAttempts,
      plannerRecoveryPending,
      feedback: earlier,
      ...rest
    } = goal;
    const note = typeof feedback === "string" ? feedback.trim() : "";
    return await this.plan(
      {
        ...rest,
        ...(note ? { feedback: note } : {}),
        status: "planning",
        updatedAt: this.now(),
      },
      reviewed ? goal : undefined,
    );
  }
  /** Stops the goal: its planner, its running tasks as Stop does, and its
   * queued tasks, which are blocked. Branches stay. */
  async cancel(id: string): Promise<HostGoal> {
    await this.ready;

    const goal = await this.get(id);
    if (goal.status === "done" || goal.status === "cancelled")
      throw new Error(`This goal is already ${goal.status}.`);
    // Written first, so a tick in between does not take the goal up again.
    const cancelled = await this.write({
      ...goal,
      status: "cancelled",
      updatedAt: this.now(),
    });
    if (goal.status === "planning") await this.stopPlanner(goal);
    await this.stopFinalReview(goal);
    for (const taskId of goal.taskIds) {
      await this.store.db.checkAuthorization();
      try {
        await this.tasks.cancel(taskId, GOAL_CANCELLED);
      } catch (error) {
        console.error("Could not stop a goal task:", errorMessage(error));
      }
    }
    return cancelled;
  }
  /** Deletes a goal none of whose tasks is running. Its tasks stay on the
   * board unless `withTasks`, which also discards their unmerged branches. */
  async delete(id: string, withTasks = false): Promise<void> {
    await this.ready;

    const goal = await this.find(id);
    if (!goal) return;
    const own = await flatMapAsync(goal.taskIds, async (taskId) => {
      const task = await this.tasks.get(taskId);
      return task ? [task] : [];
    });
    if (own.some((task) => task.status === "running" || task.status === "verifying"))
      throw new Error("Stop this goal’s running tasks before deleting it.");
    if (goal.status === "planning") await this.stopPlanner(goal);
    await this.stopFinalReview(goal);
    if (withTasks && own.some(hasUnmergedBranch))
      throw new Error(
        "Unmerged work is protected. Review or discard those tasks individually before deleting the goal with its tasks.",
      );
    if (withTasks)
      for (const task of orderTasksForDeletion(own)) {
        await this.store.db.checkAuthorization();
        await this.tasks.delete(task.id, false);
      }
    const deleted = await this.store.db.prepare("DELETE FROM goals WHERE id=?").run(id);
    if (Number(deleted.changes) > 0) this.store.afterCommit(() => this.onDelete?.({ id }));
  }
  /** No cleanup or cancellation here: the exact chain was already retired. */
  async deleteStoppedAssistantGoal(id: string, expectedValue: string): Promise<void> {
    await this.ready;
    const row = await this.store.db.prepare("SELECT value FROM goals WHERE id=?").get(id);
    if (
      !id.startsWith("assistant-") ||
      row?.value !== expectedValue ||
      !this.tasks.isAssistantDeletionHeld(id)
    )
      throw new Error("The selected goal changed or lost its deletion hold.");
    const goal = JSON.parse(expectedValue) as HostGoal;
    if (
      !["done", "cancelled"].includes(goal.status) ||
      (await this.store.db
        .prepare("SELECT 1 FROM tasks WHERE json_extract(value,'$.goalId')=? LIMIT 1")
        .get(id))
    )
      throw new Error("The goal still has live task metadata or has not stopped.");
    const deleted = await this.store.db
      .prepare("DELETE FROM goals WHERE id=? AND value=?")
      .run(id, expectedValue);
    if (Number(deleted.changes) !== 1)
      throw new Error("The exact stopped goal changed before deletion.");
    this.store.afterCommit(() => {
      this.retiredAssistantGoals.add(id);
      this.onDelete?.({ id });
    });
  }
  async markAssistantDeletionQuiescent(id: string, expectedValue: string): Promise<void> {
    const row = await this.store.db.prepare("SELECT value FROM goals WHERE id=?").get(id);
    if (row?.value !== expectedValue || !this.tasks.isAssistantDeletionHeld(id))
      throw new Error("The selected goal changed during Stop.");
    const goal = JSON.parse(expectedValue) as HostGoal;
    await this.write({
      ...goal,
      status: goal.status === "done" ? "done" : "cancelled",
      awaitingOwnerRestart: true,
      plannerRecoveryPending: undefined,
      ...(goal.finalAcceptance?.status === "running"
        ? {
            finalAcceptance: {
              ...goal.finalAcceptance,
              status: "failed",
              recoveryPending: undefined,
              error: "Stopped for owner-reviewed job deletion.",
            },
          }
        : {}),
      updatedAt: this.now(),
    });
  }
  async restoreAssistantDeletedGoal(snapshot: HostGoal): Promise<HostGoal> {
    await this.ready;
    parseHostGoal(snapshot);
    if (!snapshot.id.startsWith("assistant-"))
      throw new Error("Only the original assistant goal may be restored.");
    return this.store.transaction(async () => {
      if (await this.find(snapshot.id))
        throw new Error("A goal with this identity already exists. Nothing was restored.");
      for (const id of snapshot.projectIds) await this.store.project(id);
      const value: HostGoal = {
        ...snapshot,
        status: snapshot.status === "done" ? "done" : "cancelled",
        awaitingOwnerRestart: true,
        plannerRecoveryPending: undefined,
        deliveryApprovalRequired: true,
        ...(snapshot.finalAcceptance?.status === "running"
          ? {
              finalAcceptance: {
                ...snapshot.finalAcceptance,
                status: "failed",
                recoveryPending: undefined,
                requestId: undefined,
                error: "Restored quiescent; independent review needs an explicit owner decision.",
              },
            }
          : {}),
        updatedAt: this.now(),
      };
      await this.store.db.checkAuthorization();
      await this.store.db
        .prepare("INSERT INTO goals(id,value) VALUES(?,?)")
        .run(value.id, JSON.stringify(value));
      return value;
    }, "critical");
  }
  /** Settles planners and brings every goal's progress up to date. Called by
   * the task board's tick, before queued tasks start. */
  private async work(): Promise<void> {
    const now = this.now();
    for (const goal of await this.all(false, true)) {
      if (this.tasks.isAssistantDeletionHeld(goal.id) || goal.awaitingOwnerRestart) continue;
      try {
        const budgetRun =
          goal.status === "planning" && goal.plannerSessionId
            ? {
                sessionId: goal.plannerSessionId,
                runId: goal.plannerRunId,
                startedAt: goal.plannerStartedAt ?? goal.createdAt,
              }
            : goal.finalAcceptance?.status === "running"
              ? {
                  ...goal.finalAcceptance,
                  startedAt: goal.finalAcceptance.startedAt ?? goal.updatedAt,
                }
              : undefined;
        if (
          goal.budget &&
          budgetRun &&
          (await sessionRunState(this.store, budgetRun, 0, now)).state === "running"
        ) {
          const budget = await this.tasks.budgets.evaluate({ goalId: goal.id }, goal.budget);
          if (budget.blocked) {
            const reason = budget.reasons.join(" ");
            if (goal.status === "planning") {
              await this.stopPlanner(goal);
              await this.blockPlanning(
                { ...goal, budgetStop: reason, budgetUsage: budget.usage },
                reason,
                now,
              );
            } else {
              await this.stopFinalReview(goal);
              await this.blockFinalReview(
                { ...goal, budgetStop: reason, budgetUsage: budget.usage },
                reason,
                now,
              );
            }
            continue;
          }
        }
        if (goal.status === "planning" && goal.plannerRecoveryPending) {
          await this.resumePlanner(goal, now);
        } else if (
          goal.status === "blocked" &&
          !goal.taskIds.length &&
          goal.planError === `The planner failed: ${HOST_INTERRUPTED}` &&
          (await this.canResumePlanner(goal))
        ) {
          await this.queuePlannerRecovery(goal, HOST_INTERRUPTED, now);
        } else if (goal.status === "planning" && !goal.plannerSessionId) {
          // Waiting for daily agent time: planning starts once there is some.
          if (!(await this.tasks.limits.reached())) await this.plan(goal);
        } else if (goal.status === "planning") await this.settlePlanner(goal, now);
      } catch (error) {
        console.error("Could not settle a goal planner:", errorMessage(error));
      }
    }
    await this.follow(now);
    for (const goal of await this.all(true)) {
      if (goal.finalReview && goal.finalAcceptance?.status === "pending")
        await this.startFinalReview(goal, now);
      else if (goal.finalReview && goal.finalAcceptance?.status === "running")
        await this.settleFinalReview(goal, now);
    }
  }
  private async all(followOnly = false, planningOnly = false): Promise<HostGoal[]> {
    return await this.store.db.scope(async () => {
      return (
        await this.store.db
          .prepare(
            followOnly
              ? "SELECT value FROM goals WHERE json_extract(value, '$.status') IN ('running', 'blocked')"
              : planningOnly
                ? "SELECT value FROM goals WHERE json_extract(value, '$.status') IN ('planning', 'blocked', 'running')"
                : "SELECT value FROM goals",
          )
          .all()
      )
        .map((row) => JSON.parse(String(row.value)) as HostGoal)
        .sort((a, b) => a.createdAt - b.createdAt);
    });
  }
  private async find(id: string): Promise<HostGoal | undefined> {
    const row = await this.store.db.prepare("SELECT value FROM goals WHERE id=?").get(id);
    return row ? (JSON.parse(String(row.value)) as HostGoal) : undefined;
  }
  private async get(id: string): Promise<HostGoal> {
    return await this.store.db.scope(async () => {
      const goal = await this.find(id);
      if (!goal) throw new Error("Goal not found.");
      return goal;
    });
  }
  private async write(goal: HostGoal, reviewed?: HostGoal): Promise<HostGoal> {
    if (goal.autoMerge) goal = { ...goal, autoMerge: undefined, deliveryApprovalRequired: true };
    return await this.store.db.scope(async () => {
      // Nested scope reuse does not repeat FIFO admission. Recheck after any
      // awaited reconciliation/preparation before this concrete write as well.
      await this.store.db.checkAuthorization();
      if (
        reviewed &&
        !isDeepStrictEqual(await this.find(goal.id), JSON.parse(JSON.stringify(reviewed)))
      )
        throw new Error("Goal changed after planning admission. Read it again.");
      if (goal.id.startsWith("assistant-")) {
        const current = await this.find(goal.id);
        if (
          (!current && this.retiredAssistantGoals.has(goal.id)) ||
          (current?.awaitingOwnerRestart && !goal.awaitingOwnerRestart)
        )
          throw new Error(
            "The original assistant goal was deleted or awaits an explicit owner restart.",
          );
      }
      await this.store.db
        .prepare(
          "INSERT INTO goals VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
        )
        .run(goal.id, JSON.stringify(goal));
      return goal;
    });
  }
  /** A zero-provider proof does not authorize replacing a later owner decision. */
  private async resetDeferredTurn(goal: HostGoal, next: HostGoal): Promise<void> {
    const expected = JSON.stringify(goal);
    await this.store.transaction(async () => {
      const row = await this.store.db.prepare("SELECT value FROM goals WHERE id=?").get(goal.id);
      if (
        !row ||
        String(row.value) !== expected ||
        goal.status === "cancelled" ||
        goal.awaitingOwnerRestart ||
        this.tasks.isAssistantDeletionHeld(goal.id)
      )
        return;
      // The hours fence can remain while its unstarted turn is parked. Owner,
      // budget and deletion holds must not be consumed or rewritten by recovery.
      const held = await this.store.db
        .prepare(
          "SELECT goal_id FROM task_goal_holds WHERE goal_id=? UNION SELECT goal_id FROM task_goal_reason_holds WHERE goal_id=? AND reason<>'assistant-hours' UNION SELECT goal_id FROM task_goal_deletion_holds WHERE goal_id=? LIMIT 1",
        )
        .get(goal.id, goal.id, goal.id);
      if (held) return;
      await this.write(next);
    }, "critical");
  }
  private async blockPlanning(goal: HostGoal, planError: string, now: number, reviewed?: HostGoal) {
    return await this.write(
      {
        ...goal,
        status: "blocked",
        plannerRecoveryPending: undefined,
        planError,
        updatedAt: now,
      },
      reviewed,
    );
  }
  /** Preserve only this already-started run when its reviewed goal loses admission.
   * Recovery bookkeeping never restores goal state or starts another provider. */
  private async retireReviewedPlanner(
    goalId: string,
    started: { sessionId: string; runId: string },
    cause: unknown,
  ): Promise<never> {
    const key = `goal-planner-retirement:${goalId}:${started.runId}`;
    let persistedState: string | undefined;
    const record = async (state: string, cleanupError?: string) => {
      try {
        await this.store.db.runRecoveryBookkeeping(() =>
          this.store.db
            .prepare(
              "INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            )
            .run(
              key,
              JSON.stringify({
                goalId,
                ...started,
                state,
                cause: errorMessage(cause),
                ...(cleanupError ? { cleanupError } : {}),
              }),
            ),
        );
        persistedState = state;
      } catch {
        // Storage failure cannot skip cancellation or erase the exact run from
        // the caller's uncertain outcome. No effects use bookkeeping authority.
      }
    };
    await record("cancellation-pending");
    let cancellation = "requested";
    try {
      await cancelSessionRun(this.engine, started);
      await record("cancellation-requested");
    } catch (error) {
      cancellation = "unknown";
      await record("uncertain", errorMessage(error));
    }
    throw new Error(
      `${errorMessage(cause)} Planner session ${started.sessionId}, run ${started.runId}; cancellation ${cancellation}; retirement receipt ${key}: ${persistedState ?? "not persisted"}. Inspect this exact run before recovery.`,
    );
  }
  /** Starts the planner in the lead project's folder. */
  private async plan(goal: HostGoal, reviewed?: HostGoal): Promise<HostGoal> {
    if (!(await this.tasks.goalExecutionAllowed(goal.id))) return goal;
    if (this.assistantPlanning.has(goal.id)) return (await this.find(goal.id)) ?? goal;
    this.assistantPlanning.add(goal.id);
    let admitted: HostGoal | undefined;
    try {
      if (reviewed) admitted = await this.store.transaction(() => this.write(goal, reviewed));
      else if (goal.id.startsWith("assistant-"))
        await this.store.transaction(async () => {
          const current = await this.find(goal.id);
          if (
            this.tasks.isAssistantDeletionHeld(goal.id) ||
            current?.awaitingOwnerRestart ||
            current?.status === "cancelled"
          )
            throw new Error("The original assistant goal is held or awaits an owner restart.");
          await this.write({ ...goal, status: "planning" });
        }, "critical");
      const now = this.now();
      const budget = await this.tasks.budgets.evaluate({ goalId: goal.id }, goal.budget, {
        starting: true,
      });
      if (budget.blocked)
        return await this.blockPlanning(
          { ...goal, budgetStop: budget.reasons.join(" "), budgetUsage: budget.usage },
          budget.reasons.join(" "),
          now,
          admitted,
        );
      // With the day's agent time used up the goal waits, still planning.
      if (await this.tasks.limits.reached())
        return await this.write({ ...goal, updatedAt: now }, admitted);
      let projects;
      try {
        projects = await mapAsync(goal.projectIds, async (projectId) => {
          const project = await this.store.project(projectId);
          return {
            name: project.name,
            cwd: project.cwd,
            ...(goal.workspaces?.[projectId]?.checkoutCwd
              ? {
                  workingCwd: await resolveHostWorktreeAsync(
                    project.cwd,
                    goal.workspaces[projectId].checkoutCwd,
                  ),
                }
              : {}),
            lead: projectId === goal.leadProjectId,
          };
        });
      } catch (error) {
        return await this.blockPlanning(goal, errorMessage(error), now, admitted);
      }
      const checkAdmission = async () => {
        if (!admitted) return;
        const current = await this.find(goal.id);
        assertExpectedConfiguration({ expectedConfiguration: admitted }, current, parseHostGoal);
        if (
          !current ||
          current.status !== "planning" ||
          current.awaitingOwnerRestart ||
          current.createdAt !== admitted.createdAt
        )
          throw new Error("Goal changed after planning admission. Read it again.");
      };
      const launch = () =>
        launchSessionRun(
          this.store,
          this.engine,
          {
            projectId: goal.leadProjectId,
            ...(goal.isolate !== undefined &&
            (goal.isolate === false || !goal.workspaces?.[goal.leadProjectId]?.checkoutCwd)
              ? { workspaceMode: goal.isolate ? ("worktree" as const) : ("current" as const) }
              : {}),
            ...(projects.find((project) => project.lead)?.workingCwd
              ? { worktreeCwd: projects.find((project) => project.lead)!.workingCwd }
              : {}),
            harness: (goal.plannerExecution ?? goal).harness,
            providerAccountId: (goal.plannerExecution ?? goal).providerAccountId,
            model: (goal.plannerExecution ?? goal).model,
            modelSettings: (goal.plannerExecution ?? goal).modelSettings,
            runtimeMode: goal.runtimeMode,
            title: `Plan: ${goal.title}`.slice(0, 200),
            author: { kind: "task", id: goal.id, name: goal.title, reason: "planning" },
            prompt: plannerPrompt(goal, projects),
          },
          async () => {
            await checkAdmission();
            return this.tasks.goalExecutionAllowed(goal.id);
          },
        );
      const started =
        admitted && this.engine.withCommandAdmission
          ? await this.engine.withCommandAdmission({ check: checkAdmission }, launch)
          : await launch();
      if (started.deferred) return goal;
      const planning: HostGoal = {
        ...goal,
        status: "planning",
        plannerSessionId: started.sessionId,
        plannerRunId: started.runId,
        plannerStartedAt: now,
        updatedAt: now,
        budgetUsage: budget.usage,
        budgetStop: undefined,
      };
      try {
        if (started.sessionId && started.runId)
          await this.tasks.budgets.register({
            goalId: goal.id,
            role: "planner",
            sessionId: started.sessionId,
            runId: started.runId,
            startedAt: now,
          });
        if (started.error !== undefined)
          return await this.blockPlanning(
            planning,
            `Could not start the planner: ${started.error}`,
            now,
            admitted,
          );
        return await this.write(planning, admitted);
      } catch (error) {
        if (admitted && started.sessionId && started.runId)
          return this.retireReviewedPlanner(
            goal.id,
            { sessionId: started.sessionId, runId: started.runId },
            error,
          );
        throw error;
      }
    } finally {
      this.assistantPlanning.delete(goal.id);
    }
  }
  private async stopPlanner(goal: HostGoal): Promise<void> {
    const run = {
      sessionId: goal.plannerSessionId,
      runId: goal.plannerRunId,
      startedAt: goal.plannerStartedAt ?? goal.createdAt,
    };
    if (
      goal.plannerSessionId &&
      (await sessionRunState(this.store, run, 0, this.now())).state === "running"
    ) {
      await cancelSessionRun(this.engine, run);
      await this.tasks.limits.recordRun(run, this.now());
    }
  }
  /** Resume only host-authored infrastructure interruptions, never an owner
   * stop, a stale turn, or a persistence failure carrying a different note. */
  private async canResumePlanner(goal: HostGoal): Promise<boolean> {
    try {
      const session = await this.store.session(goal.plannerSessionId ?? "");
      const last = session.session.blocks.at(-1);
      return (
        session.status === "interrupted" &&
        (!goal.plannerRunId || session.runId === goal.plannerRunId) &&
        last?.role === "system" &&
        (last.text.trim() === "Host stopped. This turn was interrupted." ||
          last.text.trim() ===
            "Host restarted. This turn was interrupted; inspect its work before continuing.")
      );
    } catch {
      return false;
    }
  }
  private async queuePlannerRecovery(
    goal: HostGoal,
    error: string,
    now: number,
    formatRepair = false,
  ): Promise<void> {
    const pending = await this.write({
      ...goal,
      status: "planning",
      planError: error,
      plannerRecoveryPending: true,
      plannerRepairAttempts: (goal.plannerRepairAttempts ?? 0) + Number(formatRepair),
      updatedAt: now,
    });
    await this.resumePlanner(pending, now);
  }
  /** Retain the conversation and its inspected evidence. Daily limits delay
   * recovery rather than turning a recoverable interruption into a blocker. */
  private async resumePlanner(goal: HostGoal, now: number): Promise<void> {
    if (await this.tasks.limits.reached()) return;
    const budget = await this.tasks.budgets.evaluate({ goalId: goal.id }, goal.budget, {
      starting: true,
    });
    if (budget.blocked) {
      await this.blockPlanning(
        { ...goal, budgetStop: budget.reasons.join(" "), budgetUsage: budget.usage },
        budget.reasons.join(" "),
        now,
      );
      return;
    }
    try {
      const sessionId = goal.plannerSessionId!;
      const session = await this.store.session(sessionId);
      if (
        session.runId !== goal.plannerRunId ||
        session.status === "running" ||
        (session.status === "interrupted" && !(await this.canResumePlanner(goal)))
      ) {
        await this.blockPlanning(
          goal,
          "The planner recovery no longer owns its recorded turn. Replan to continue.",
          now,
        );
        return;
      }
      if (
        this.tasks.admissionClosed ||
        this.tasks.isAssistantDeletionHeld(goal.id) ||
        goal.awaitingOwnerRestart
      )
        return;
      const resume = () =>
        this.engine.command({
          type: "send",
          commandId: newRequestId(),
          sessionId,
          text: [
            "Continue the existing read-only planning conversation. Reuse the projects and evidence already inspected; do not edit files, commit, start implementation, switch branches, ask for approval or enter plan mode.",
            `The host could not complete planning: ${goal.planError ?? HOST_INTERRUPTED}`,
            "Return a corrected, self-contained plan in the required fenced json shape, using only the project's allowed paths and valid acyclic dependencies. Preserve the original objective and constraints. If the host interrupted the turn, continue the unfinished plan from the existing evidence.",
          ].join("\n\n"),
        });
      await (this.engine.withMessageAuthor
        ? this.engine.withMessageAuthor(
            { kind: "task", id: goal.id, name: goal.title, reason: "planner recovery" },
            resume,
          )
        : resume());
      await this.write({
        ...goal,
        status: "planning",
        planError: undefined,
        plannerRunId: (await this.store.session(sessionId)).runId,
        plannerStartedAt: now,
        plannerRecoveryPending: undefined,
        updatedAt: now,
      });
      const resumed = await this.store.session(sessionId);
      if (resumed.runId)
        await this.tasks.budgets.register({
          goalId: goal.id,
          role: "planner",
          sessionId,
          runId: resumed.runId,
          startedAt: now,
        });
    } catch (error) {
      await this.blockPlanning(goal, `Could not resume the planner: ${errorMessage(error)}`, now);
    }
  }
  /** Follows the planner to its reply and reads the plan from it. */
  private async settlePlanner(goal: HostGoal, now: number): Promise<void> {
    const run = {
      sessionId: goal.plannerSessionId,
      runId: goal.plannerRunId,
      startedAt: goal.plannerStartedAt ?? goal.createdAt,
      // Why the planner is being stopped, saved before it was cancelled.
      error: goal.planError,
    };
    const outcome = await sessionRunState(this.store, run, goal.maxRunMinutes, now);
    if (outcome.state === "running") return;
    if (outcome.state === "overLimit") {
      await this.write({ ...goal, planError: outcome.error });
      await cancelSessionRun(this.engine, run);
      return;
    }
    await this.tasks.limits.recordRun(run, now);
    if (outcome.status !== "succeeded") {
      if (
        await deferredAssistantTurn(this.store, goal.plannerSessionId, goal.plannerRunId, goal.id)
      ) {
        await this.resetDeferredTurn(goal, {
          ...goal,
          status: "planning",
          plannerSessionId: undefined,
          plannerRunId: undefined,
          plannerStartedAt: undefined,
          plannerRecoveryPending: undefined,
          planError: undefined,
          updatedAt: now,
        });
        return;
      }
      if (
        outcome.error === HOST_INTERRUPTED &&
        !goal.planError &&
        (await this.canResumePlanner(goal))
      ) {
        await this.queuePlannerRecovery(goal, HOST_INTERRUPTED, now);
        return;
      }
      await this.blockPlanning(
        goal,
        outcome.status === "cancelled"
          ? STOPPED_BY_USER
          : `The planner failed: ${outcome.error ?? "its run failed."}`,
        now,
      );
      return;
    }
    // The planner's whole last turn: the plan may sit in an earlier message
    // than its last one, or in a plan block when it answered in plan mode.
    const blocks = (await this.store.session(goal.plannerSessionId ?? "")).session.blocks;
    const lastUser = blocks.findLastIndex((block) => block.role === "user");
    const reply = blocks
      .slice(lastUser + 1)
      .filter((block) => (block.role === "assistant" || block.role === "plan") && block.text.trim())
      .map((block) => block.text)
      .join("\n\n");
    const paths = new Map(
      await mapAsync(goal.projectIds, async (projectId) => [
        (await this.store.project(projectId)).cwd,
        projectId,
      ]),
    );
    let plan: GoalPlan;
    try {
      plan = parseGoalPlan(reply, [...paths.keys()]);
    } catch (error) {
      if (
        goal.continueUntilDone &&
        (goal.plannerRepairAttempts ?? 0) < MAX_PLANNER_FORMAT_REPAIRS
      ) {
        await this.queuePlannerRecovery(goal, errorMessage(error), now, true);
        return;
      }
      await this.blockPlanning(goal, errorMessage(error), now);
      return;
    }
    const planned: HostGoal = {
      ...goal,
      plan: {
        ...plan,
        tasks: plan.tasks.map((task) => ({
          ...task,
          projectId: paths.get(task.project),
        })),
      },
      planError: undefined,
      updatedAt: now,
    };
    if (goalPlanNeedsApproval(planned))
      await this.write({ ...planned, status: "awaiting-approval" });
    else await this.start(planned, now);
  }
  /** Creates a task on the board for every task of the plan. */
  private async start(goal: HostGoal, now: number): Promise<HostGoal> {
    const planned = goal.plan?.tasks ?? [];
    try {
      for (const task of planned) await this.store.project(task.projectId ?? "");
    } catch (error) {
      return await this.blockPlanning(goal, errorMessage(error), now);
    }
    const ids = new Map(planned.map((task) => [task.key, randomUUID()]));
    const { verifyCommand } = goal.verifyDefaults;
    const review = goalPlanReviews(goal).task;
    // No queued task may escape without its owning goal's complete task list.
    return await this.tasks.transaction(async () => {
      for (const task of planned) {
        await this.store.db.checkAuthorization();
        const projectId = task.projectId!;
        const command = verifyCommand?.[projectId];
        const dependsOn = task.dependsOn.map((key) => ids.get(key)!);
        await this.tasks.save({
          id: ids.get(task.key),
          title: task.title,
          prompt: task.prompt,
          projectId,
          harness: goal.harness,
          providerAccountId: goal.providerAccountId,
          model: goal.model,
          modelSettings: goal.modelSettings,
          runtimeMode: goal.runtimeMode,
          maxRunMinutes: goal.maxRunMinutes,
          ...(goal.isolate !== undefined ? { isolate: goal.isolate } : {}),
          ...(goal.workspaces?.[projectId] ? { workspace: goal.workspaces[projectId] } : {}),
          ...(goal.manualStart ? { status: "todo" } : {}),
          ...(command ? { verifyCommand: command } : {}),
          review,
          ...(goal.deliveryApprovalRequired ? { deliveryApprovalRequired: true } : {}),
          ...(goal.continueUntilDone ? { continueUntilDone: true } : {}),
          goalId: goal.id,
          ...(dependsOn.length ? { dependsOn } : {}),
        });
      }
      return await this.write({
        ...goal,
        status: "running",
        planError: undefined,
        error: undefined,
        taskIds: planned.map((task) => ids.get(task.key)!),
        updatedAt: now,
      });
    });
  }
  /** Brings the status of every goal with tasks in line with them. */
  private async follow(now: number): Promise<void> {
    const goals = (await this.all(true)).filter((goal) => goal.taskIds.length);
    if (!goals.length) return;
    let tasks = await this.tasks.taskIndex(goals.flatMap((goal) => goal.taskIds));
    let recoveredTasks: Map<string, HostTask> | undefined;
    for (const goal of goals) {
      for (const id of goal.taskIds) {
        const task = tasks.get(id);
        if (task?.status !== "blocked" || task.repairAttempts !== undefined) continue;
        const recovered = await this.tasks.recoverGoalReview(id, goal.id);
        if (recovered) {
          recoveredTasks ??= new Map(tasks);
          recoveredTasks.set(id, recovered);
          tasks = recoveredTasks;
        }
      }
      const state = goalStateFromTasks(goal, tasks);
      if (
        goal.finalReview &&
        goal.finalAcceptance?.status === "pending" &&
        (await this.attachFinalReceipt(goal, now))
      )
        continue;
      if (goalPlanReviews(goal).final && state.status === "done") {
        const fingerprint = finalTaskFingerprint(goal, tasks);
        const final = goal.finalAcceptance;
        if (final?.taskFingerprint === fingerprint && final.status === "passed") {
          await this.write({ ...goal, status: "done", error: undefined, updatedAt: now });
        } else if (
          final?.status === "failed" &&
          (final.taskFingerprint === fingerprint ||
            final.invalidatedTaskFingerprint === fingerprint)
        ) {
          if (goal.status !== "blocked" || goal.error !== final.note)
            await this.write({ ...goal, status: "blocked", error: final.note, updatedAt: now });
        } else if (final?.status === "running") {
          // The owning tick settles or rejects this exact review; reads never launch a run.
          if (goal.status !== "running")
            await this.write({ ...goal, status: "running", error: undefined, updatedAt: now });
        } else if (
          final?.status !== "pending" ||
          final.taskFingerprint !== fingerprint ||
          goal.status !== "running"
        ) {
          await this.write({
            ...goal,
            status: "running",
            error: undefined,
            finalAcceptance: {
              status: "pending",
              taskFingerprint: fingerprint,
              requestId: randomUUID(),
            },
            finalAcceptanceHistory: final?.sessionId
              ? [...(goal.finalAcceptanceHistory ?? []), final].slice(-5)
              : goal.finalAcceptanceHistory,
            updatedAt: now,
          });
        }
        continue;
      }
      if (
        goal.finalReview &&
        goal.finalAcceptance?.status === "running" &&
        state.status !== "done"
      ) {
        // Retained until the tick can cancel its owned session and reject stale results.
        continue;
      }
      if (state.status === goal.status && state.error === goal.error) continue;
      await this.write({
        ...goal,
        status: state.status,
        error: state.error,
        updatedAt: now,
      });
    }
  }
  /** The owner can request a fresh final check without rerunning implementation. */
  async recheckFinalReview(id: string, expectedUpdatedAt: unknown): Promise<HostGoal> {
    await this.ready;

    const goal = await this.get(id);
    if (goal.updatedAt !== expectedUpdatedAt)
      throw new Error("This goal changed. Refresh before rechecking.");
    if (
      !goal.finalReview ||
      goal.status === "cancelled" ||
      goal.status === "planning" ||
      goal.finalAcceptance?.status === "running"
    )
      throw new Error("Only a completed or failed final goal review can be rechecked.");
    const tasks = await this.tasks.taskIndex(goal.taskIds);
    if (
      goal.taskIds.length === 0 ||
      goal.taskIds.some((taskId) => tasks.get(taskId)?.status !== "done")
    )
      throw new Error("Finish and deliver all goal tasks before the final review.");
    const now = this.now();
    const next = await this.write({
      ...goal,
      status: "running",
      error: undefined,
      finalAcceptanceHistory: goal.finalAcceptance?.sessionId
        ? [...(goal.finalAcceptanceHistory ?? []), goal.finalAcceptance].slice(-5)
        : goal.finalAcceptanceHistory,
      finalAcceptance: {
        status: "pending",
        taskFingerprint: finalTaskFingerprint(goal, tasks),
        requestId: randomUUID(),
      },
      updatedAt: Math.max(now, goal.updatedAt + 1),
    });
    this.store.afterCommit(() => {
      void this.tasks.tick().catch((error) => console.error("Goal task scheduling failed:", error));
    });
    return next;
  }
  private async runningFinalReviews(): Promise<number> {
    return (await this.all(false, true)).filter(
      (goal) => goal.status === "running" && goal.finalAcceptance?.status === "running",
    ).length;
  }
  /** A pending database write can lag an accepted provider launch at host shutdown. */
  private async attachFinalReceipt(goal: HostGoal, now: number): Promise<HostGoal | undefined> {
    const final = goal.finalAcceptance;
    const receipt = final?.requestId
      ? await this.store.receiptStatus(`goal-final:${final.requestId}:send`)
      : undefined;
    if (!receipt?.runId) return;
    let executionWorkspace: { cwd: string; workspaceId?: string };
    try {
      executionWorkspace = await this.reviewerExecutionWorkspace(receipt.sessionId, goal);
    } catch (error) {
      return await this.blockFinalReview(
        goal,
        `Final review no longer owns its recorded execution workspace: ${errorMessage(error)}`,
        now,
      );
    }
    if (
      final?.executionWorkspace &&
      (executionWorkspace.cwd !== final.executionWorkspace.cwd ||
        executionWorkspace.workspaceId !== final.executionWorkspace.workspaceId)
    )
      return await this.blockFinalReview(
        goal,
        "Final review no longer owns its recorded execution workspace.",
        now,
      );
    const startedAt = final?.startedAt ?? now;
    await this.tasks.budgets.register({
      goalId: goal.id,
      role: "final-review",
      sessionId: receipt.sessionId,
      runId: receipt.runId,
      startedAt,
    });
    return await this.write({
      ...goal,
      finalAcceptance: {
        ...final!,
        status: "running",
        sessionId: receipt.sessionId,
        runId: receipt.runId,
        executionWorkspace,
        startedAt,
        freshnessUnknown: !final?.workspaceFingerprint || undefined,
      },
      updatedAt: now,
    });
  }
  private async blockFinalReview(goal: HostGoal, note: string, now: number): Promise<HostGoal> {
    return await this.write({
      ...goal,
      status: "blocked",
      error: note,
      finalAcceptance: {
        ...goal.finalAcceptance!,
        status: "failed",
        note,
        completedAt: now,
        recoveryPending: undefined,
      },
      updatedAt: now,
    });
  }
  private async finalWorkspaceFingerprint(
    goal: HostGoal,
    tasks: ReadonlyMap<string, HostTask>,
  ): Promise<string | undefined> {
    const results: Array<[string, string]> = [];
    for (let index = 0; index < goal.taskIds.length; index += 4) {
      const batch = await Promise.all(
        goal.taskIds.slice(index, index + 4).map(async (id) => {
          const task = tasks.get(id);
          try {
            return [id, task ? await this.tasks.resultFingerprint(task) : undefined] as const;
          } catch {
            // A removed project or failed read is unknown evidence, never an unchanged result.
            return [id, undefined] as const;
          }
        }),
      );
      if (batch.some(([, fingerprint]) => !fingerprint)) return;
      results.push(...batch.map(([id, fingerprint]) => [id, fingerprint!] as [string, string]));
    }
    return createHash("sha256").update(JSON.stringify(results)).digest("hex");
  }
  private async startFinalReview(goal: HostGoal, now: number): Promise<void> {
    if (goal.status !== "running") return;
    if (!(await this.tasks.goalExecutionAllowed(goal.id))) return;
    if (await this.attachFinalReceipt(goal, now)) return;
    if (await this.tasks.limits.reached()) return;
    const budget = await this.tasks.budgets.evaluate({ goalId: goal.id }, goal.budget, {
      starting: true,
    });
    if (budget.blocked) {
      await this.blockFinalReview(
        { ...goal, budgetStop: budget.reasons.join(" "), budgetUsage: budget.usage },
        budget.reasons.join(" "),
        now,
      );
      return;
    }
    const runningTasks = (await this.tasks.list()).filter(
      (task) =>
        !task.crewDefinitionId && (task.status === "running" || task.status === "verifying"),
    ).length;
    if (
      runningTasks + (await this.runningFinalReviews()) >=
      (await this.tasks.limits.settings()).maxRunningTasks
    )
      return;
    const tasks = await this.tasks.taskIndex(goal.taskIds);
    if (goal.taskIds.some((id) => tasks.get(id)?.status !== "done")) {
      await this.blockFinalReview(
        goal,
        "A goal task is missing or no longer delivered. Recheck the current result.",
        now,
      );
      return;
    }
    try {
      const requestId = goal.finalAcceptance?.requestId ?? randomUUID();
      if (!goal.finalAcceptance?.requestId)
        goal = await this.write({
          ...goal,
          finalAcceptance: { ...goal.finalAcceptance!, requestId },
        });
      const workspaceFingerprint = await this.finalWorkspaceFingerprint(goal, tasks);
      const current = await this.find(goal.id);
      if (
        !current ||
        current.status !== "running" ||
        current.finalAcceptance?.status !== "pending" ||
        current.finalAcceptance.requestId !== requestId ||
        current.updatedAt !== goal.updatedAt
      )
        return;
      const currentTasks = await this.tasks.taskIndex(goal.taskIds);
      if (
        finalTaskFingerprint(current, currentTasks) !== goal.finalAcceptance!.taskFingerprint ||
        goal.taskIds.some((id) => currentTasks.get(id)?.status !== "done")
      ) {
        await this.blockFinalReview(
          {
            ...current,
            finalAcceptance: {
              ...current.finalAcceptance,
              invalidatedTaskFingerprint: finalTaskFingerprint(current, currentTasks),
            },
          },
          "Delivered tasks changed while preparing final review. Recheck the current result.",
          this.now(),
        );
        return;
      }
      if (
        (await this.tasks.limits.reached()) ||
        (await this.tasks.list()).filter(
          (task) =>
            !task.crewDefinitionId && (task.status === "running" || task.status === "verifying"),
        ).length +
          (await this.runningFinalReviews()) >=
          (await this.tasks.limits.settings()).maxRunningTasks
      )
        return;
      const currentBudget = await this.tasks.budgets.evaluate({ goalId: goal.id }, current.budget, {
        starting: true,
      });
      if (currentBudget.blocked) {
        await this.blockFinalReview(
          {
            ...current,
            budgetStop: currentBudget.reasons.join(" "),
            budgetUsage: currentBudget.usage,
          },
          currentBudget.reasons.join(" "),
          this.now(),
        );
        return;
      }
      const projects = await mapAsync(goal.projectIds, async (id) => {
        const project = await this.store.project(id);
        return {
          id,
          cwd: await resolveHostWorktreeAsync(
            project.cwd,
            goal.workspaces?.[id]?.checkoutCwd ?? project.cwd,
          ),
        };
      });
      const launchAt = this.now();
      goal = await this.write({
        ...current,
        finalAcceptance: {
          ...current.finalAcceptance!,
          startedAt: launchAt,
          workspaceFingerprint,
          freshnessUnknown: !workspaceFingerprint || undefined,
        },
      });
      const started = await launchSessionRun(
        this.store,
        this.engine,
        {
          requestId: `goal-final:${requestId}`,
          projectId: goal.leadProjectId,
          ...(goal.isolate !== undefined &&
          (goal.isolate === false || !goal.workspaces?.[goal.leadProjectId]?.checkoutCwd)
            ? { workspaceMode: goal.isolate ? ("worktree" as const) : ("current" as const) }
            : {}),
          worktreeCwd: projects.find((project) => project.id === goal.leadProjectId)!.cwd,
          harness: goal.harness,
          providerAccountId: goal.providerAccountId,
          model: goal.model,
          modelSettings: goal.modelSettings,
          runtimeMode: goal.runtimeMode,
          title: `Final review: ${goal.title}`.slice(0, 200),
          author: { kind: "task", id: goal.id, name: goal.title, reason: "final review" },
          prompt: finalReviewPrompt(goal, tasks, projects),
        },
        () => this.tasks.goalExecutionAllowed(goal.id),
      );
      if (started.deferred) return;
      const executionWorkspace = started.sessionId
        ? await this.reviewerExecutionWorkspace(started.sessionId, goal)
        : undefined;
      const reviewing: HostGoal = {
        ...goal,
        status: "running",
        error: undefined,
        finalAcceptance: {
          status: "running",
          taskFingerprint: finalTaskFingerprint(goal, tasks),
          requestId,
          workspaceFingerprint,
          freshnessUnknown: !workspaceFingerprint || undefined,
          sessionId: started.sessionId,
          runId: started.runId,
          executionWorkspace,
          startedAt: launchAt,
        },
        updatedAt: now,
        budgetUsage: currentBudget.usage,
        budgetStop: undefined,
      };
      if (started.sessionId && started.runId)
        await this.tasks.budgets.register({
          goalId: goal.id,
          role: "final-review",
          sessionId: started.sessionId,
          runId: started.runId,
          startedAt: launchAt,
        });
      if (started.error)
        await this.blockFinalReview(
          reviewing,
          `Could not start final review: ${started.error}`,
          now,
        );
      else await this.write(reviewing);
    } catch (error) {
      await this.blockFinalReview(goal, errorMessage(error), now);
    }
  }
  private async stopFinalReview(goal: HostGoal): Promise<void> {
    const final = goal.finalAcceptance;
    if (
      final?.status === "running" &&
      final.sessionId &&
      (
        await sessionRunState(
          this.store,
          {
            ...final,
            startedAt: final.startedAt ?? goal.updatedAt,
          },
          0,
          this.now(),
        )
      ).state === "running"
    ) {
      await cancelSessionRun(this.engine, final);
      await this.tasks.limits.recordRun(final, this.now());
    }
  }
  private async canResumeFinalReview(goal: HostGoal): Promise<boolean> {
    const final = goal.finalAcceptance;
    if (!final?.sessionId) return false;
    try {
      const session = await this.store.session(final.sessionId);
      const last = session.session.blocks.at(-1);
      return (
        session.status === "interrupted" &&
        session.runId === final.runId &&
        last?.role === "system" &&
        (last.text.trim() === "Host stopped. This turn was interrupted." ||
          last.text.trim() ===
            "Host restarted. This turn was interrupted; inspect its work before continuing.")
      );
    } catch {
      return false;
    }
  }
  private async reviewerExecutionWorkspace(sessionId: string, goal: HostGoal) {
    const projectId = goal.leadProjectId;
    const value = await this.store.session(sessionId);
    if (value.projectId !== projectId || value.session.id !== sessionId)
      throw new Error("Reviewer execution identity changed");
    const session = value.session;
    if (session.workspaceId) {
      const workspace = await this.store.managedWorkspace(session.workspaceId);
      if (
        !workspace ||
        workspace.id !== session.workspaceId ||
        workspace.environmentId !== this.store.environmentId ||
        workspace.projectId !== projectId ||
        workspace.owner.kind !== "session" ||
        workspace.owner.id !== sessionId ||
        workspace.directoryState !== "present" ||
        workspace.path !== session.cwd ||
        session.worktreeCwd !== workspace.path
      )
        throw new Error("Reviewer managed workspace ownership changed");
    } else {
      const project = await this.store.project(projectId);
      const selected = await resolveHostWorktreeAsync(
        project.cwd,
        goal.workspaces?.[projectId]?.checkoutCwd ?? project.cwd,
      );
      if (session.cwd !== selected) throw new Error("Reviewer selected checkout changed");
    }
    return {
      cwd: session.cwd,
      ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
    };
  }

  private async finalReviewOwnsSession(goal: HostGoal): Promise<boolean> {
    const final = goal.finalAcceptance;
    if (!final?.sessionId) return false;
    try {
      const session = await this.store.session(final.sessionId);
      const project = await this.store.project(goal.leadProjectId);
      const cwd =
        final.executionWorkspace?.cwd ??
        (await resolveHostWorktreeAsync(
          project.cwd,
          goal.workspaces?.[goal.leadProjectId]?.checkoutCwd ?? project.cwd,
        ));
      if (final.executionWorkspace) {
        const current = await this.reviewerExecutionWorkspace(final.sessionId, goal);
        if (
          current.cwd !== final.executionWorkspace.cwd ||
          current.workspaceId !== final.executionWorkspace.workspaceId
        )
          return false;
      }
      return (
        session.runId === final.runId &&
        session.projectId === goal.leadProjectId &&
        session.session.cwd === cwd &&
        session.session.harness === goal.harness &&
        (session.session.providerAccountId ?? "default") ===
          (goal.providerAccountId ?? "default") &&
        session.session.model === goal.model &&
        session.session.runtimeMode === goal.runtimeMode &&
        JSON.stringify(session.session.modelSettings) === JSON.stringify(goal.modelSettings)
      );
    } catch {
      return false;
    }
  }
  private async resumeFinalReview(goal: HostGoal, now: number): Promise<void> {
    if (await this.tasks.limits.reached()) return;
    const budget = await this.tasks.budgets.evaluate({ goalId: goal.id }, goal.budget, {
      starting: true,
    });
    if (budget.blocked) {
      await this.blockFinalReview(
        { ...goal, budgetStop: budget.reasons.join(" "), budgetUsage: budget.usage },
        budget.reasons.join(" "),
        now,
      );
      return;
    }
    const final = goal.finalAcceptance!;
    try {
      const session = await this.store.session(final.sessionId!);
      if (
        !(await this.finalReviewOwnsSession(goal)) ||
        (final.recoveryPending
          ? !(await this.canResumeFinalReview(goal))
          : session.status !== "idle")
      ) {
        await this.blockFinalReview(
          goal,
          "The final reviewer no longer owns its recorded turn. Recheck the final review.",
          now,
        );
        return;
      }
      if (
        this.tasks.admissionClosed ||
        this.tasks.isAssistantDeletionHeld(goal.id) ||
        goal.awaitingOwnerRestart
      )
        return;
      const resume = () =>
        this.engine.command({
          type: "send",
          commandId: newRequestId(),
          sessionId: final.sessionId!,
          text: [
            "Continue the existing independent read-only final goal review. Preserve inspected evidence, inspect current delivered files, and verify the complete original objective. Do not edit files, launch implementation, commit, merge or publish.",
            acceptanceReviewInstructions(FINAL_ACCEPTANCE_CRITERIA),
            "End with VERDICT: PASS only if both conditions are verified, otherwise VERDICT: FAIL - <concrete missing proof and next action>.",
          ].join("\n\n"),
        });
      await (this.engine.withMessageAuthor
        ? this.engine.withMessageAuthor(
            { kind: "task", id: goal.id, name: goal.title, reason: "final review recovery" },
            resume,
          )
        : resume());
      await this.write({
        ...goal,
        finalAcceptance: {
          ...final,
          runId: (await this.store.session(final.sessionId!)).runId,
          startedAt: now,
          recoveryPending: undefined,
        },
        updatedAt: now,
      });
      const resumed = await this.store.session(final.sessionId!);
      if (resumed.runId)
        await this.tasks.budgets.register({
          goalId: goal.id,
          role: "final-review",
          sessionId: final.sessionId!,
          runId: resumed.runId,
          startedAt: now,
        });
    } catch (error) {
      await this.blockFinalReview(goal, errorMessage(error), now);
    }
  }
  private async settleFinalReview(goal: HostGoal, now: number): Promise<void> {
    let final = goal.finalAcceptance!;
    if (!(await this.finalReviewOwnsSession(goal))) {
      await this.blockFinalReview(
        goal,
        "The final reviewer no longer owns its recorded session and turn. Recheck the final review.",
        now,
      );
      return;
    }
    const tasks = await this.tasks.taskIndex(goal.taskIds);
    if (
      goal.taskIds.some((id) => tasks.get(id)?.status !== "done") ||
      finalTaskFingerprint(goal, tasks) !== final.taskFingerprint
    ) {
      await this.stopFinalReview(goal);
      await this.blockFinalReview(
        {
          ...goal,
          finalAcceptance: {
            ...final,
            invalidatedTaskFingerprint: finalTaskFingerprint(goal, tasks),
          },
        },
        "Delivered task results changed during final review. Recheck the integrated result.",
        now,
      );
      return;
    }
    if (final.recoveryPending) {
      await this.resumeFinalReview(goal, now);
      return;
    }
    const run = { ...final, startedAt: final.startedAt ?? goal.updatedAt };
    const outcome = await sessionRunState(this.store, run, goal.maxRunMinutes, now);
    if (outcome.state === "running") return;
    if (outcome.state === "overLimit") {
      await this.write({
        ...goal,
        finalAcceptance: { ...final, error: outcome.error },
        updatedAt: now,
      });
      await cancelSessionRun(this.engine, final);
      return;
    }
    if (final.accountedRunId !== final.runId) {
      await this.tasks.limits.recordRun(final, now);
      goal = await this.write({
        ...goal,
        finalAcceptance: { ...final, accountedRunId: final.runId },
      });
      final = goal.finalAcceptance!;
    }
    if (outcome.status !== "succeeded") {
      if (await deferredAssistantTurn(this.store, final.sessionId, final.runId, goal.id)) {
        await this.resetDeferredTurn(goal, {
          ...goal,
          finalAcceptance: {
            ...final,
            status: "pending",
            sessionId: undefined,
            runId: undefined,
            requestId: undefined,
            startedAt: undefined,
            accountedRunId: undefined,
            recoveryPending: undefined,
            error: undefined,
          },
          updatedAt: now,
        });
        return;
      }
      if (
        outcome.error === HOST_INTERRUPTED &&
        !final.error &&
        (await this.canResumeFinalReview(goal))
      ) {
        const pending = await this.write({
          ...goal,
          finalAcceptance: { ...final, recoveryPending: true },
          updatedAt: now,
        });
        await this.resumeFinalReview(pending, now);
      } else
        await this.blockFinalReview(
          goal,
          outcome.status === "cancelled"
            ? STOPPED_BY_USER
            : (outcome.error ?? "The final review failed."),
          now,
        );
      return;
    }
    const workspaceFingerprint = await this.finalWorkspaceFingerprint(goal, tasks);
    const current = await this.find(goal.id);
    if (
      !current ||
      current.status !== "running" ||
      current.finalAcceptance?.status !== "running" ||
      current.finalAcceptance.runId !== final.runId ||
      current.finalAcceptance.requestId !== final.requestId ||
      current.updatedAt !== goal.updatedAt
    )
      return;
    const currentTasks = await this.tasks.taskIndex(goal.taskIds);
    if (
      finalTaskFingerprint(current, currentTasks) !== final.taskFingerprint ||
      goal.taskIds.some((id) => currentTasks.get(id)?.status !== "done")
    ) {
      await this.blockFinalReview(
        {
          ...current,
          finalAcceptance: {
            ...final,
            invalidatedTaskFingerprint: finalTaskFingerprint(current, currentTasks),
          },
        },
        "Delivered task results changed during final review. Recheck the integrated result.",
        this.now(),
      );
      return;
    }
    if (final.workspaceFingerprint && workspaceFingerprint !== final.workspaceFingerprint) {
      await this.blockFinalReview(
        goal,
        "The integrated working copies changed during final review. Recheck the current result.",
        this.now(),
      );
      return;
    }
    const reviewedSession = await this.store.session(final.sessionId!);
    if (reviewedSession.runId !== final.runId || !(await this.finalReviewOwnsSession(current))) {
      await this.blockFinalReview(
        current,
        "The final reviewer no longer owns its recorded session and turn. Recheck the final review.",
        this.now(),
      );
      return;
    }
    const blocks = reviewedSession.session.blocks;
    const lastUser = blocks.findLastIndex((block) => block.role === "user");
    const reply = blocks
      .slice(lastUser + 1)
      .filter((block) => block.role === "assistant" && block.text.trim())
      .map((block) => block.text)
      .join("\n\n");
    const review = parseReviewVerdict(reply);
    if (
      (review.note === NO_VERDICT || !hasTaskAcceptanceReport(reply, FINAL_ACCEPTANCE_CRITERIA)) &&
      goal.continueUntilDone &&
      (final.formatRepairAttempts ?? 0) < 2
    ) {
      const pending = await this.write({
        ...goal,
        finalAcceptance: { ...final, formatRepairAttempts: (final.formatRepairAttempts ?? 0) + 1 },
        updatedAt: now,
      });
      await this.resumeFinalReview(pending, now);
      return;
    }
    const acceptance = parseTaskAcceptance(reply, FINAL_ACCEPTANCE_CRITERIA, {
      checkedAt: now,
      sessionId: final.sessionId!,
      workspaceFingerprint: final.workspaceFingerprint ? workspaceFingerprint : undefined,
    });
    const incomplete = acceptance.criteria.filter((row) => row.verdict !== "verified");
    const passed = review.verdict === "pass" && !incomplete.length;
    const note = passed
      ? review.note || "The complete integrated goal was independently verified."
      : incomplete.length
        ? `Final acceptance evidence is incomplete: ${incomplete.map((row) => row.criterion).join("; ")}`
        : review.note;
    await this.write({
      ...goal,
      status: passed ? "done" : "blocked",
      error: passed ? undefined : note,
      finalAcceptance: {
        ...final,
        status: passed ? "passed" : "failed",
        acceptance,
        note,
        completedAt: now,
      },
      updatedAt: now,
    });
  }
}
