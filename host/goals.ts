import { randomUUID } from "node:crypto";
import { resolveHostWorktree } from "./git-worktrees";
import {
  GOAL_CANCELLED,
  MAX_PLAN_TASKS,
  goalStateFromTasks,
  parseGoalPlan,
  parseHostGoal,
  type GoalPlan,
  type HostGoal,
  type GoalSettings,
} from "../src/features/tasks/model/hostGoals";
import {
  STOPPED_BY_USER,
  HOST_INTERRUPTED,
  cancelSessionRun,
  errorMessage,
  launchSessionRun,
  sessionRunState,
  type SessionRunEngine,
} from "./sessionRuns";
import type { HostStore } from "./store";
import type { HostTasks } from "./tasks";

const FEEDBACK_LIMIT = 8000;
const MAX_PLANNER_FORMAT_REPAIRS = 2;

function plannerPrompt(
  goal: HostGoal,
  projects: ReadonlyArray<{ name: string; cwd: string; lead: boolean; workingCwd?: string }>,
): string {
  const lead = projects.find((project) => project.lead)!;
  return [
    "You are planning a job that other agents will carry out across one or more projects. Only read: do not edit, create or delete files, do not commit, and do not start the work yourself.",
    "",
    `Job: ${goal.title}`,
    "",
    goal.prompt,
    "",
    "Projects you may assign work to (name: absolute path on this machine):",
    ...projects.map((project) => `- ${project.name}: ${project.cwd}`),
    ...projects.flatMap((project) =>
      project.workingCwd
        ? [
            `Read ${project.name} from the selected working copy at ${project.workingCwd}. Use ${project.cwd} as its project identifier in the plan; use relative file paths in task prompts. Do not switch branches or worktrees.`,
          ]
        : [],
    ),
    "",
    `You are in ${lead.name}. Read the other projects at their paths as you need to.`,
    "",
    goal.isolate === false
      ? `Break the job into 1 to ${MAX_PLAN_TASKS} tasks. Each task is carried out by one agent directly in the selected checkout, preserving existing uncommitted changes. Independent tasks may run concurrently in the same checkout, within the configured limits. They must own separate scopes, preserve other sessions' changes, and leave all work uncommitted for the owner. No host commit or merge is performed. Make every prompt self-contained, use paths relative to the project root, and do not instruct agents to create worktrees or switch branches. When a task needs another task's completed result, list its key in dependsOn; it starts after that task passes its configured checks. Tasks in separate checkouts may run concurrently.`
      : `Break the job into 1 to ${MAX_PLAN_TASKS} tasks. Each task is carried out by one agent that works only in its project, on a branch of its own that is merged once the task is approved. The agent sees nothing but its task's prompt, so make every prompt self-contained. Each agent starts in its own copy of its project, so in prompts refer to files by paths relative to the project root, never by the absolute paths above, and do not tell the agent which folder or branch to work in. When a task needs the merged result of another, list that task's key in its dependsOn; it then starts only after that task is merged. Leave out dependencies that are not needed, so independent tasks can run at the same time.`,
    ...(goal.feedback ? ["", "The owner's feedback on an earlier plan:", goal.feedback] : []),
    "",
    "Do not use plan mode or ask for approval; write the plan in your reply.",
    ...(goal.continueUntilDone
      ? [
          "The owner requested continuous execution. Carry that intent into every task: resolve routine implementation decisions autonomously and continue through actionable failures while preserving completed work. Only a concrete missing resource, access or owner decision should require input.",
        ]
      : []),
    "Keep tasks proportional to the work. Reuse existing project contracts rather than requiring every worker to rediscover the project or read whole manuals. Request focused verification, separate development checks from release gates, and distinguish implemented deliverables from acceptance requiring unavailable devices or credentials. Never assign an absolute working folder or assume the integration branch is named main.",
    'End your reply with a fenced ```json block of exactly this shape, with each "project" copied exactly from the list above:',
    '{"tasks":[{"key":"short-id","project":"<project path from the list>","title":"...","prompt":{"schema":"bycoda.task.v1","objective":"clear outcome","deliverables":["concrete output"],"acceptance":["observable completion condition"],"constraints":["scope boundary"],"verification":["focused check and expected result"]},"dependsOn":["other-key"]}]}',
    "Write concise, self-contained task briefs in the owner's language. Keep each condition in its matching field, do not repeat boilerplate, and do not require unavailable physical devices or credentials unless the owner explicitly requires them.",
  ].join("\n");
}

/** Breaks one main job into tasks across several of this machine's projects
 * and follows them to the end. A planner agent writes the plan in the lead
 * project; each planned task is an ordinary task on the board, on a branch of
 * its own, that starts once the tasks it depends on are merged. Runs on the
 * task board's timer. */
export class HostGoals {
  constructor(
    private readonly store: HostStore,
    private readonly engine: SessionRunEngine,
    private readonly tasks: HostTasks,
    private readonly now: () => number = Date.now,
  ) {
    store.db.exec("CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, value TEXT NOT NULL);");
    tasks.onTick(() => this.work());
    tasks.limits.track(() =>
      this.all().flatMap((goal) =>
        goal.status === "planning" && goal.plannerSessionId
          ? [goal.plannerStartedAt ?? goal.createdAt]
          : [],
      ),
    );
  }

  /** The task board's tick, which settles planners and goal progress. */
  tick(): Promise<void> {
    return this.tasks.tick();
  }

  /** Oldest first, with their progress brought up to date. */
  list(): HostGoal[] {
    this.follow(this.now());
    return this.all();
  }

  /** Adds a goal and starts its planner. */
  create(raw: unknown): HostGoal {
    const input = parseHostGoal(raw);
    if (this.find(input.id)) throw new Error("This goal already exists.");
    for (const projectId of input.projectIds) this.store.project(projectId);
    const now = this.now();
    return this.plan({
      ...input,
      status: "planning",
      taskIds: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Updates operational settings and existing tasks atomically. */
  update(id: string, raw: unknown, expectedUpdatedAt: unknown): HostGoal {
    const goal = this.get(id);
    if (expectedUpdatedAt !== goal.updatedAt)
      throw new Error("This goal changed. Close and reopen settings before saving.");
    if (goal.status === "done" || goal.status === "cancelled")
      throw new Error("Only an active goal can be edited.");
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("Invalid goal settings");
    const settings = raw as GoalSettings;
    const keys = ["autoMerge", "continueUntilDone", "maxRunningTasks", "maxRunMinutes"];
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
    const updated = this.store.transaction(() => {
      this.tasks.updateGoalSettings(goal.id, goal.taskIds, {
        ...(Boolean(goal.autoMerge) !== settings.autoMerge
          ? { autoMerge: settings.autoMerge }
          : {}),
        ...(Boolean(goal.continueUntilDone) !== settings.continueUntilDone
          ? { continueUntilDone: settings.continueUntilDone }
          : {}),
        ...(goal.maxRunMinutes !== settings.maxRunMinutes
          ? { maxRunMinutes: settings.maxRunMinutes }
          : {}),
      });
      return this.write({
        ...goal,
        autoMerge: parsed.autoMerge,
        continueUntilDone: parsed.continueUntilDone,
        maxRunningTasks: parsed.maxRunningTasks,
        maxRunMinutes: parsed.maxRunMinutes,
        updatedAt: Math.max(now, goal.updatedAt + 1),
      });
    });
    void this.tasks.tick();
    return updated;
  }

  /** Creates the tasks of a plan the owner approved. */
  approve(id: string): HostGoal {
    const goal = this.get(id);
    if (goal.status !== "awaiting-approval")
      throw new Error("Only a plan waiting for approval can be approved.");
    const next = this.start(goal, this.now());
    void this.tasks.tick();
    return next;
  }

  /** Plans again, from a plan waiting for approval or a failed planning,
   * with the owner's feedback when given. */
  replan(id: string, feedback?: unknown): HostGoal {
    const goal = this.get(id);
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
    return this.plan({
      ...rest,
      ...(note ? { feedback: note } : {}),
      status: "planning",
      updatedAt: this.now(),
    });
  }

  /** Stops the goal: its planner, its running tasks as Stop does, and its
   * queued tasks, which are blocked. Branches stay. */
  async cancel(id: string): Promise<HostGoal> {
    const goal = this.get(id);
    if (goal.status === "done" || goal.status === "cancelled")
      throw new Error(`This goal is already ${goal.status}.`);
    // Written first, so a tick in between does not take the goal up again.
    const cancelled = this.write({
      ...goal,
      status: "cancelled",
      updatedAt: this.now(),
    });
    if (goal.status === "planning") this.stopPlanner(goal);
    for (const taskId of goal.taskIds) {
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
    const goal = this.find(id);
    if (!goal) return;
    const own = goal.taskIds.flatMap((taskId) => {
      const task = this.tasks.get(taskId);
      return task ? [task] : [];
    });
    if (own.some((task) => task.status === "running" || task.status === "verifying"))
      throw new Error("Stop this goal’s running tasks before deleting it.");
    if (goal.status === "planning") this.stopPlanner(goal);
    if (withTasks) for (const task of own) await this.tasks.delete(task.id, true);
    this.store.db.prepare("DELETE FROM goals WHERE id=?").run(id);
  }

  /** Settles planners and brings every goal's progress up to date. Called by
   * the task board's tick, before queued tasks start. */
  private work(): void {
    const now = this.now();
    for (const goal of this.all()) {
      try {
        if (goal.status === "planning" && goal.plannerRecoveryPending) {
          this.resumePlanner(goal, now);
        } else if (
          goal.status === "blocked" &&
          !goal.taskIds.length &&
          goal.planError === `The planner failed: ${HOST_INTERRUPTED}` &&
          this.canResumePlanner(goal)
        ) {
          this.queuePlannerRecovery(goal, HOST_INTERRUPTED, now);
        } else if (goal.status === "planning" && !goal.plannerSessionId) {
          // Waiting for daily agent time: planning starts once there is some.
          if (!this.tasks.limits.reached()) this.plan(goal);
        } else if (goal.status === "planning") this.settlePlanner(goal, now);
      } catch (error) {
        console.error("Could not settle a goal planner:", errorMessage(error));
      }
    }
    this.follow(now);
  }

  private all(): HostGoal[] {
    return this.store.db
      .prepare("SELECT value FROM goals")
      .all()
      .map((row) => JSON.parse(String(row.value)) as HostGoal)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  private find(id: string): HostGoal | undefined {
    const row = this.store.db.prepare("SELECT value FROM goals WHERE id=?").get(id);
    return row ? (JSON.parse(String(row.value)) as HostGoal) : undefined;
  }

  private get(id: string): HostGoal {
    const goal = this.find(id);
    if (!goal) throw new Error("Goal not found.");
    return goal;
  }

  private write(goal: HostGoal): HostGoal {
    this.store.db
      .prepare("INSERT INTO goals VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value")
      .run(goal.id, JSON.stringify(goal));
    return goal;
  }

  private blockPlanning(goal: HostGoal, planError: string, now: number) {
    return this.write({
      ...goal,
      status: "blocked",
      plannerRecoveryPending: undefined,
      planError,
      updatedAt: now,
    });
  }

  /** Starts the planner in the lead project's folder. */
  private plan(goal: HostGoal): HostGoal {
    const now = this.now();
    // With the day's agent time used up the goal waits, still planning.
    if (this.tasks.limits.reached()) return this.write({ ...goal, updatedAt: now });
    let projects;
    try {
      projects = goal.projectIds.map((projectId) => {
        const project = this.store.project(projectId);
        return {
          name: project.name,
          cwd: project.cwd,
          ...(goal.workspaces?.[projectId]?.checkoutCwd
            ? {
                workingCwd: resolveHostWorktree(
                  project.cwd,
                  goal.workspaces[projectId].checkoutCwd,
                ),
              }
            : {}),
          lead: projectId === goal.leadProjectId,
        };
      });
    } catch (error) {
      return this.blockPlanning(goal, errorMessage(error), now);
    }
    const started = launchSessionRun(this.store, this.engine, {
      projectId: goal.leadProjectId,
      ...(projects.find((project) => project.lead)?.workingCwd
        ? { worktreeCwd: projects.find((project) => project.lead)!.workingCwd }
        : {}),
      harness: goal.harness,
      model: goal.model,
      modelSettings: goal.modelSettings,
      runtimeMode: goal.runtimeMode,
      title: `Plan: ${goal.title}`.slice(0, 200),
      prompt: plannerPrompt(goal, projects),
    });
    const planning: HostGoal = {
      ...goal,
      status: "planning",
      plannerSessionId: started.sessionId,
      plannerRunId: started.runId,
      plannerStartedAt: now,
      updatedAt: now,
    };
    if (started.error !== undefined)
      return this.blockPlanning(planning, `Could not start the planner: ${started.error}`, now);
    return this.write(planning);
  }

  private stopPlanner(goal: HostGoal): void {
    const run = {
      sessionId: goal.plannerSessionId,
      runId: goal.plannerRunId,
      startedAt: goal.plannerStartedAt ?? goal.createdAt,
    };
    if (
      goal.plannerSessionId &&
      sessionRunState(this.store, run, 0, this.now()).state === "running"
    ) {
      cancelSessionRun(this.engine, run);
      this.tasks.limits.record(run.startedAt, this.now());
    }
  }

  /** Resume only host-authored infrastructure interruptions, never an owner
   * stop, a stale turn, or a persistence failure carrying a different note. */
  private canResumePlanner(goal: HostGoal): boolean {
    try {
      const session = this.store.session(goal.plannerSessionId ?? "");
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

  private queuePlannerRecovery(
    goal: HostGoal,
    error: string,
    now: number,
    formatRepair = false,
  ): void {
    const pending = this.write({
      ...goal,
      status: "planning",
      planError: error,
      plannerRecoveryPending: true,
      plannerRepairAttempts: (goal.plannerRepairAttempts ?? 0) + Number(formatRepair),
      updatedAt: now,
    });
    this.resumePlanner(pending, now);
  }

  /** Retain the conversation and its inspected evidence. Daily limits delay
   * recovery rather than turning a recoverable interruption into a blocker. */
  private resumePlanner(goal: HostGoal, now: number): void {
    if (this.tasks.limits.reached()) return;
    try {
      const sessionId = goal.plannerSessionId!;
      const session = this.store.session(sessionId);
      if (
        session.runId !== goal.plannerRunId ||
        session.status === "running" ||
        (session.status === "interrupted" && !this.canResumePlanner(goal))
      ) {
        this.blockPlanning(
          goal,
          "The planner recovery no longer owns its recorded turn. Replan to continue.",
          now,
        );
        return;
      }
      this.engine.command({
        type: "send",
        commandId: randomUUID(),
        sessionId,
        text: [
          "Continue the existing read-only planning conversation. Reuse the projects and evidence already inspected; do not edit files, commit, start implementation, switch branches, ask for approval or enter plan mode.",
          `The host could not complete planning: ${goal.planError ?? HOST_INTERRUPTED}`,
          "Return a corrected, self-contained plan in the required fenced json shape, using only the project's allowed paths and valid acyclic dependencies. Preserve the original objective and constraints. If the host interrupted the turn, continue the unfinished plan from the existing evidence.",
        ].join("\n\n"),
      });
      this.write({
        ...goal,
        status: "planning",
        planError: undefined,
        plannerRunId: this.store.session(sessionId).runId,
        plannerStartedAt: now,
        plannerRecoveryPending: undefined,
        updatedAt: now,
      });
    } catch (error) {
      this.blockPlanning(goal, `Could not resume the planner: ${errorMessage(error)}`, now);
    }
  }

  /** Follows the planner to its reply and reads the plan from it. */
  private settlePlanner(goal: HostGoal, now: number): void {
    const run = {
      sessionId: goal.plannerSessionId,
      runId: goal.plannerRunId,
      startedAt: goal.plannerStartedAt ?? goal.createdAt,
      // Why the planner is being stopped, saved before it was cancelled.
      error: goal.planError,
    };
    const outcome = sessionRunState(this.store, run, goal.maxRunMinutes, now);
    if (outcome.state === "running") return;
    if (outcome.state === "overLimit") {
      this.write({ ...goal, planError: outcome.error });
      cancelSessionRun(this.engine, run);
      return;
    }
    this.tasks.limits.record(run.startedAt, now);
    if (outcome.status !== "succeeded") {
      if (outcome.error === HOST_INTERRUPTED && !goal.planError && this.canResumePlanner(goal)) {
        this.queuePlannerRecovery(goal, HOST_INTERRUPTED, now);
        return;
      }
      this.blockPlanning(
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
    const blocks = this.store.session(goal.plannerSessionId ?? "").session.blocks;
    const lastUser = blocks.findLastIndex((block) => block.role === "user");
    const reply = blocks
      .slice(lastUser + 1)
      .filter((block) => (block.role === "assistant" || block.role === "plan") && block.text.trim())
      .map((block) => block.text)
      .join("\n\n");
    const paths = new Map(
      goal.projectIds.map((projectId) => [this.store.project(projectId).cwd, projectId]),
    );
    let plan: GoalPlan;
    try {
      plan = parseGoalPlan(reply, [...paths.keys()]);
    } catch (error) {
      if (
        goal.continueUntilDone &&
        (goal.plannerRepairAttempts ?? 0) < MAX_PLANNER_FORMAT_REPAIRS
      ) {
        this.queuePlannerRecovery(goal, errorMessage(error), now, true);
        return;
      }
      this.blockPlanning(goal, errorMessage(error), now);
      return;
    }
    const planned: HostGoal = {
      ...goal,
      plan: {
        tasks: plan.tasks.map((task) => ({
          ...task,
          projectId: paths.get(task.project),
        })),
      },
      planError: undefined,
      updatedAt: now,
    };
    if (goal.approvePlan) this.write({ ...planned, status: "awaiting-approval" });
    else this.start(planned, now);
  }

  /** Creates a task on the board for every task of the plan. */
  private start(goal: HostGoal, now: number): HostGoal {
    const planned = goal.plan?.tasks ?? [];
    try {
      for (const task of planned) this.store.project(task.projectId ?? "");
    } catch (error) {
      return this.blockPlanning(goal, errorMessage(error), now);
    }
    const ids = new Map(planned.map((task) => [task.key, randomUUID()]));
    const { verifyCommand, review } = goal.verifyDefaults;
    // No queued task may escape without its owning goal's complete task list.
    return this.store.transaction(() => {
      for (const task of planned) {
        const projectId = task.projectId!;
        const command = verifyCommand?.[projectId];
        const dependsOn = task.dependsOn.map((key) => ids.get(key)!);
        this.tasks.save({
          id: ids.get(task.key),
          title: task.title,
          prompt: task.prompt,
          projectId,
          harness: goal.harness,
          model: goal.model,
          modelSettings: goal.modelSettings,
          runtimeMode: goal.runtimeMode,
          maxRunMinutes: goal.maxRunMinutes,
          isolate: goal.isolate !== false,
          ...(goal.workspaces?.[projectId] ? { workspace: goal.workspaces[projectId] } : {}),
          ...(goal.manualStart ? { status: "todo" } : {}),
          ...(command ? { verifyCommand: command } : {}),
          review,
          ...(goal.autoMerge && goal.isolate !== false ? { autoMerge: true } : {}),
          ...(goal.continueUntilDone ? { continueUntilDone: true } : {}),
          goalId: goal.id,
          ...(dependsOn.length ? { dependsOn } : {}),
        });
      }
      return this.write({
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
  private follow(now: number): void {
    const tasks = this.tasks.list();
    for (const goal of this.all()) {
      if (!goal.taskIds.length || (goal.status !== "running" && goal.status !== "blocked"))
        continue;
      for (const id of goal.taskIds) {
        const at = tasks.findIndex((task) => task.id === id);
        const task = tasks[at];
        if (task?.status !== "blocked" || task.repairAttempts !== undefined) continue;
        const recovered = this.tasks.recoverGoalReview(id, goal.id);
        if (recovered && at >= 0) tasks[at] = recovered;
      }
      const state = goalStateFromTasks(goal, tasks);
      if (state.status === goal.status && state.error === goal.error) continue;
      this.write({
        ...goal,
        status: state.status,
        error: state.error,
        updatedAt: now,
      });
    }
  }
}
