import type { HostStore } from "./store";
import type { HostGoals } from "./goals";
import type { HostTasks } from "./tasks";
import type { RuntimeLogPrincipal } from "./runtime-log-tools";
import { MAX_RUNNING_TASKS_LIMIT } from "../src/features/tasks/model/hostSettings";

const id = { type: "string", minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_-]+$" };
const expected = { type: "integer", minimum: 0 };
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const GOAL_WRITE_TOOLS = {
  "goals.create": object(
    {
      goalId: id,
      title: { type: "string", minLength: 1, maxLength: 200 },
      prompt: { type: "string", minLength: 1, maxLength: 12000 },
    },
    ["goalId", "title", "prompt"],
  ),
  "goals.replan": object(
    {
      goalId: id,
      expectedUpdatedAt: expected,
      feedback: { type: "string", maxLength: 8000 },
    },
    ["goalId", "expectedUpdatedAt"],
  ),
  "goals.cancel": object({ goalId: id, expectedUpdatedAt: expected }, [
    "goalId",
    "expectedUpdatedAt",
  ]),
  "goals.update": object(
    {
      goalId: id,
      expectedUpdatedAt: expected,
      maxRunningTasks: { type: "integer", minimum: 0, maximum: MAX_RUNNING_TASKS_LIMIT },
      maxRunMinutes: { type: "integer", minimum: 0, maximum: 10080 },
    },
    ["goalId", "expectedUpdatedAt"],
  ),
  "goals.delete": object({ goalId: id, expectedUpdatedAt: expected }, [
    "goalId",
    "expectedUpdatedAt",
  ]),
};
export type GoalWriteTool = keyof typeof GOAL_WRITE_TOOLS;
export const isGoalWriteTool = (action: string): action is GoalWriteTool =>
  Object.hasOwn(GOAL_WRITE_TOOLS, action);
export const describeGoalWriteTool = (action: string): string | undefined =>
  isGoalWriteTool(action)
    ? "Create a goal plan in this project using the calling conversation's provider, model and runtime permissions; the owner must approve its plan and start its tasks. Direct checkout execution only, no automatic merge or continuous execution. Mutations require singleton-project scope and expectedUpdatedAt; a goal's planner, workers and reviewers cannot change their own goal. Replan starts a new planner; update changes only concurrency/run limits on a goal whose safe execution identity matches the caller. Cancel stops its planner/tasks while retaining branches. Delete removes only a terminal goal or a never-executed awaiting/blocked plan, with no active planner; tasks, branches and artifacts stay. Creation rejects reused goal IDs: read goals.get before retrying. This never approves, merges or discards work."
    : undefined;

export class ConversationGoalTools {
  constructor(
    private readonly store: Pick<HostStore, "project" | "session" | "sessionStateMetadata">,
    private readonly goals: Pick<
      HostGoals,
      "list" | "create" | "replan" | "cancel" | "update" | "delete"
    >,
    private readonly tasks: Pick<HostTasks, "list">,
    // Desktop conversations need not have an adopted row in the host store.
    private readonly session: HostStore["session"] = (id) => store.session(id),
  ) {}

  async call(
    action: GoalWriteTool,
    input: Record<string, unknown>,
    principal: RuntimeLogPrincipal,
    authorized: () => boolean,
  ): Promise<unknown> {
    const check = () => {
      if (!authorized()) throw new Error("Session authority revoked.");
    };
    check();
    this.store.project(principal.projectId);
    const caller = this.session(principal.sessionId);
    if (caller.projectId !== principal.projectId)
      throw new Error("Session belongs to another project.");
    if (action === "goals.create") {
      check();
      return this.goals.create({
        id: input.goalId,
        title: input.title,
        prompt: input.prompt,
        projectIds: [principal.projectId],
        leadProjectId: principal.projectId,
        harness: caller.session.harness,
        providerAccountId: caller.session.providerAccountId,
        model: caller.session.model,
        modelSettings: { ...caller.session.modelSettings },
        runtimeMode: caller.session.runtimeMode,
        maxRunMinutes: 0,
        isolate: false,
        autoMerge: false,
        continueUntilDone: false,
        approvePlan: true,
        manualStart: true,
        verifyDefaults: { review: true },
      });
    }
    const goal = this.goals
      .list()
      .find(
        (entry) =>
          entry.id === input.goalId &&
          entry.projectIds.length === 1 &&
          entry.projectIds[0] === principal.projectId,
      );
    if (!goal) throw new Error("Goal is not wholly in this project.");
    if (
      !Number.isSafeInteger(input.expectedUpdatedAt) ||
      goal.updatedAt !== input.expectedUpdatedAt
    )
      throw new Error("Goal changed. Read it before changing it.");
    if (
      goal.plannerSessionId === principal.sessionId ||
      this.tasks
        .list(principal.projectId)
        .some(
          (task) =>
            task.projectId === principal.projectId &&
            (task.goalId === goal.id || goal.taskIds.includes(task.id)) &&
            (task.sessionId === principal.sessionId ||
              task.reviewer?.sessionId === principal.sessionId),
        )
    )
      throw new Error("An agent cannot change its own goal.");
    check();
    if (action === "goals.replan" || action === "goals.update") {
      const settings = caller.session.modelSettings ?? {};
      const goalSettings = goal.modelSettings ?? {};
      if (
        goal.isolate !== false ||
        goal.autoMerge ||
        !goal.approvePlan ||
        !goal.manualStart ||
        goal.continueUntilDone ||
        goal.harness !== caller.session.harness ||
        (goal.providerAccountId ?? "default") !== (caller.session.providerAccountId ?? "default") ||
        goal.model !== caller.session.model ||
        goal.runtimeMode !== caller.session.runtimeMode ||
        Object.keys(settings).length !== Object.keys(goalSettings).length ||
        Object.entries(settings).some(([key, value]) => goalSettings[key] !== value)
      )
        throw new Error(
          "Change this goal through the owner UI; its execution settings differ from safe conversation planning.",
        );
      if (action === "goals.update") {
        if (input.maxRunningTasks === undefined && input.maxRunMinutes === undefined)
          throw new Error("Supply a goal concurrency or run limit.");
        const maxRunningTasks = input.maxRunningTasks ?? goal.maxRunningTasks ?? 0;
        const maxRunMinutes = input.maxRunMinutes ?? goal.maxRunMinutes;
        if (
          !Number.isSafeInteger(maxRunningTasks) ||
          Number(maxRunningTasks) < 0 ||
          Number(maxRunningTasks) > MAX_RUNNING_TASKS_LIMIT ||
          !Number.isSafeInteger(maxRunMinutes) ||
          Number(maxRunMinutes) < 0 ||
          Number(maxRunMinutes) > 10080
        )
          throw new Error("Provide bounded goal limits.");
        return this.goals.update(
          goal.id,
          { maxRunningTasks, maxRunMinutes, autoMerge: false, continueUntilDone: false },
          goal.updatedAt,
        );
      }
      return this.goals.replan(goal.id, input.feedback);
    }
    if (action === "goals.cancel") return this.goals.cancel(goal.id);
    if (action === "goals.delete") {
      const terminal = goal.status === "done" || goal.status === "cancelled";
      const neverExecuted =
        (goal.status === "awaiting-approval" || goal.status === "blocked") &&
        !goal.taskIds.length &&
        !this.tasks.list(principal.projectId).some((task) => task.goalId === goal.id);
      const planner = goal.plannerSessionId
        ? this.store.sessionStateMetadata(goal.plannerSessionId)
        : undefined;
      if (
        (!terminal && !neverExecuted) ||
        planner?.status === "running" ||
        goal.plannerRecoveryPending
      )
        throw new Error(
          "Only an inactive terminal goal or never-executed plan can be deleted; cancel it first.",
        );
      check();
      await this.goals.delete(goal.id, false);
      return { deleted: true, goalId: goal.id, tasksPreserved: true };
    }
    throw new Error("Unknown goal action");
  }
}
