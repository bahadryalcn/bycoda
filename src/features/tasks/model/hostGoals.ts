import { isRemoteProvider, type RemoteProvider } from "../../connections/model/protocol";
import { RUNTIME_MODES, type RuntimeMode } from "../../sessions/model/session";
import type { HostTask } from "./hostTasks";
import { parseTaskWorkspace, type TaskWorkspace } from "./taskWorkspace";
import { MAX_RUNNING_TASKS_LIMIT } from "./hostSettings";
import { readTaskInstructions } from "./taskInstructions";

/** One main job a machine's host breaks into tasks across several of its
 * projects and carries out. The host advertises this capability when it has
 * it. */
export const HOST_GOALS = "goals";
export const HOST_DIRECT_GOALS = "goals.direct-checkout";

export const GOAL_STATUSES = [
  "planning",
  "awaiting-approval",
  "running",
  "done",
  "blocked",
  "cancelled",
] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** How many projects one goal may span, and how many tasks its plan may have. */
export const MAX_GOAL_PROJECTS = 8;
export const MAX_PLAN_TASKS = 20;

export const GOAL_CANCELLED = "Goal cancelled";

/** What every task of a goal is checked with before review. */
export type GoalVerifyDefaults = {
  /** A check command per project, by the host's project ID. */
  verifyCommand?: Record<string, string>;
  /** Have a second agent review each task's result. */
  review: boolean;
};

export type HostGoalInput = {
  /** False runs tasks directly in the selected checkout without a task branch. */
  isolate?: boolean;
  workspaces?: Record<string, TaskWorkspace>;
  maxRunningTasks?: number;
  manualStart?: boolean;
  id: string;
  title: string;
  /** The main job, as the owner wrote it. */
  prompt: string;
  /** The host's IDs for the projects the work may be spread over. */
  projectIds: string[];
  /** The project the planner runs in; one of `projectIds`. */
  leadProjectId: string;
  harness: RemoteProvider;
  model: string;
  modelSettings: Record<string, string>;
  runtimeMode: RuntimeMode;
  /** Stop the planner, or any of the goal's runs, after this long; zero
   * means off. */
  maxRunMinutes: number;
  verifyDefaults: GoalVerifyDefaults;
  /** Wait for the owner to approve the plan before any task is created. */
  approvePlan: boolean;
  /** Merge every task the goal creates once its checks pass, without waiting
   * for approval. Absent counts as false. */
  autoMerge?: boolean;
  /** Planned tasks keep correcting actionable failures while making progress. */
  continueUntilDone?: boolean;
};

/** One task of a plan, as the planner wrote it. */
export type GoalPlanTask = {
  key: string;
  /** The project's path on the host, exactly as listed to the planner. */
  project: string;
  title: string;
  prompt: string;
  /** Keys of the tasks that must be done first. */
  dependsOn: string[];
  /** The host's ID for `project`, added by the host. */
  projectId?: string;
};

export type GoalPlan = { tasks: GoalPlanTask[] };

/** Operational settings editable without replanning or changing execution identity. */
export type GoalSettings = {
  autoMerge: boolean;
  continueUntilDone: boolean;
  /** Zero uses the machine limit. */
  maxRunningTasks: number;
  maxRunMinutes: number;
};

export type HostGoal = HostGoalInput & {
  status: GoalStatus;
  plan?: GoalPlan;
  /** Why planning failed, for a goal blocked before it had tasks. */
  planError?: string;
  /** Why the goal is blocked once it has tasks, e.g. "1 of 3 tasks blocked: …". */
  error?: string;
  /** What the owner asked the planner to change, for the next plan. */
  feedback?: string;
  /** The planner's session turn, kept after it finished. */
  plannerSessionId?: string;
  plannerRunId?: string;
  plannerStartedAt?: number;
  /** Bounded format-repair turns, independent of trusted host interruptions. */
  plannerRepairAttempts?: number;
  /** A retained planner awaits recovery, possibly held by the daily limit. */
  plannerRecoveryPending?: boolean;
  /** The tasks created from the plan, in the plan's order. */
  taskIds: string[];
  createdAt: number;
  updatedAt: number;
};

export function isGoalStatus(value: unknown): value is GoalStatus {
  return GOAL_STATUSES.some((status) => status === value);
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Validates what a desktop sent. Throws with the reason on bad input. */
export function parseHostGoal(input: unknown): HostGoalInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid goal");
  const v = input as Record<string, unknown>;
  if (typeof v.id !== "string" || !ID.test(v.id)) throw new Error("Invalid goal ID");
  if (typeof v.title !== "string" || !v.title.trim() || v.title.length > 200)
    throw new Error("Goal title is required and must be under 200 characters.");
  if (
    typeof v.prompt !== "string" ||
    !v.prompt.trim() ||
    v.prompt.length > 256_000 ||
    v.prompt.includes("\0")
  )
    throw new Error("Describe the job for this goal.");
  if (
    !Array.isArray(v.projectIds) ||
    v.projectIds.length < 1 ||
    v.projectIds.some((id) => typeof id !== "string" || !ID.test(id))
  )
    throw new Error("Choose at least one project for this goal.");
  const projectIds = [...new Set(v.projectIds as string[])];
  if (projectIds.length > MAX_GOAL_PROJECTS)
    throw new Error(`A goal can span at most ${MAX_GOAL_PROJECTS} projects.`);
  if (typeof v.leadProjectId !== "string" || !projectIds.includes(v.leadProjectId))
    throw new Error("The lead project must be one of the goal’s projects.");
  if (!isRemoteProvider(v.harness)) throw new Error("Invalid goal agent");
  if (typeof v.model !== "string" || !v.model.trim() || v.model.length > 200)
    throw new Error("Invalid goal model");
  if (!RUNTIME_MODES.includes(v.runtimeMode as never)) throw new Error("Invalid goal run mode.");
  const settings = v.modelSettings ?? {};
  if (
    typeof settings !== "object" ||
    Array.isArray(settings) ||
    Object.values(settings as object).some((value) => typeof value !== "string")
  )
    throw new Error("Invalid model settings");
  const limit = v.maxRunMinutes ?? 0;
  if (
    v.maxRunningTasks !== undefined &&
    (!Number.isInteger(v.maxRunningTasks) ||
      Number(v.maxRunningTasks) < 1 ||
      Number(v.maxRunningTasks) > MAX_RUNNING_TASKS_LIMIT)
  )
    throw new Error("Invalid goal concurrency");
  if (v.manualStart !== undefined && typeof v.manualStart !== "boolean")
    throw new Error("Invalid goal start mode");
  const workspaces: Record<string, TaskWorkspace> = {};
  if (v.workspaces !== undefined) {
    if (!v.workspaces || typeof v.workspaces !== "object" || Array.isArray(v.workspaces))
      throw new Error("Invalid goal workspaces");
    for (const [projectId, raw] of Object.entries(v.workspaces)) {
      if (!projectIds.includes(projectId))
        throw new Error("Workspace project is outside this goal");
      const workspace = parseTaskWorkspace(raw);
      if (workspace?.branchName) throw new Error("Choose a base branch for goal tasks");
      if (workspace) workspaces[projectId] = workspace;
    }
  }
  if (!Number.isInteger(limit) || Number(limit) < 0 || Number(limit) > 10_080)
    throw new Error("Invalid goal run limit");
  if (
    (v.approvePlan !== undefined && typeof v.approvePlan !== "boolean") ||
    (v.isolate !== undefined && typeof v.isolate !== "boolean") ||
    (v.autoMerge !== undefined && typeof v.autoMerge !== "boolean") ||
    (v.continueUntilDone !== undefined && typeof v.continueUntilDone !== "boolean")
  )
    throw new Error("Invalid goal options");
  const verify = v.verifyDefaults ?? {};
  if (typeof verify !== "object" || Array.isArray(verify)) throw new Error("Invalid goal checks");
  const { verifyCommand, review } = verify as Record<string, unknown>;
  if (review !== undefined && typeof review !== "boolean") throw new Error("Invalid goal checks");
  const commands: Record<string, string> = {};
  if (verifyCommand !== undefined) {
    if (!verifyCommand || typeof verifyCommand !== "object" || Array.isArray(verifyCommand))
      throw new Error("Invalid check command");
    for (const [projectId, command] of Object.entries(verifyCommand)) {
      if (
        !projectIds.includes(projectId) ||
        typeof command !== "string" ||
        command.length > 4000 ||
        command.includes("\0")
      )
        throw new Error("Invalid check command");
      if (command.trim()) commands[projectId] = command.trim();
    }
  }
  return {
    id: v.id,
    title: v.title.trim(),
    prompt: v.prompt,
    projectIds,
    leadProjectId: v.leadProjectId,
    harness: v.harness,
    model: v.model,
    modelSettings: settings as Record<string, string>,
    runtimeMode: v.runtimeMode as RuntimeMode,
    maxRunMinutes: Number(limit),
    ...(v.isolate === false ? { isolate: false } : {}),
    ...(Object.keys(workspaces).length ? { workspaces } : {}),
    ...(v.maxRunningTasks !== undefined ? { maxRunningTasks: Number(v.maxRunningTasks) } : {}),
    ...(v.manualStart === true ? { manualStart: true } : {}),
    verifyDefaults: {
      ...(Object.keys(commands).length ? { verifyCommand: commands } : {}),
      review: review !== false,
    },
    approvePlan: v.approvePlan === true,
    ...(v.autoMerge === true ? { autoMerge: true } : {}),
    ...(v.continueUntilDone === true ? { continueUntilDone: true } : {}),
  };
}

const PLAN_KEY = /^[A-Za-z0-9_.-]{1,64}$/;

/** The text of the last fenced code block marked `json`, or of the last
 * unmarked one when none is marked. */
export function lastJsonBlock(text: string): string | undefined {
  const marked: string[] = [];
  const unmarked: string[] = [];
  for (const match of text.matchAll(/```([^\n`]*)\r?\n([\s\S]*?)```/g)) {
    const info = match[1].trim().toLowerCase();
    if (info === "json" || info === "jsonc") marked.push(match[2]);
    else if (!info) unmarked.push(match[2]);
  }
  return marked.length ? marked[marked.length - 1] : unmarked[unmarked.length - 1];
}

/** Compares project paths the way a planner may write them back: with either
 * slash and with or without a trailing one. */
function pathKey(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/(.)\/+$/, "$1");
}

/** The listed project a planner's `project` names, matched exactly first and
 * then, when that is unambiguous, ignoring case. */
function matchProject(value: string, allowed: readonly string[]): string | undefined {
  const key = pathKey(value);
  const exact = allowed.find((path) => pathKey(path) === key);
  if (exact) return exact;
  const loose = allowed.filter((path) => pathKey(path).toLowerCase() === key.toLowerCase());
  return loose.length === 1 ? loose[0] : undefined;
}

/** Reads the plan at the end of the planner's reply: the last fenced json
 * block, `{"tasks":[{"key","project","title","prompt","dependsOn"}]}`, with 1
 * to 20 tasks, unique keys, every project from `allowedProjects`, and
 * dependencies on tasks of the plan that form no cycle. Throws with the
 * precise reason when the plan is missing or invalid. */
export function parseGoalPlan(text: string, allowedProjects: readonly string[]): GoalPlan {
  const block = lastJsonBlock(text);
  if (block === undefined)
    throw new Error("The planner’s reply has no ```json block with the plan.");
  let raw: unknown;
  try {
    raw = JSON.parse(block);
  } catch (error) {
    throw new Error(
      `The plan is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const list =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).tasks
      : undefined;
  if (!Array.isArray(list)) throw new Error("The plan must be an object with a “tasks” list.");
  if (list.length === 0) throw new Error("The plan has no tasks.");
  if (list.length > MAX_PLAN_TASKS)
    throw new Error(`The plan has ${list.length} tasks; at most ${MAX_PLAN_TASKS} are allowed.`);
  const tasks: GoalPlanTask[] = [];
  const keys = new Set<string>();
  list.forEach((entry, index) => {
    const at = `Task ${index + 1}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error(`${at} is not an object.`);
    const v = entry as Record<string, unknown>;
    if (typeof v.key !== "string" || !PLAN_KEY.test(v.key))
      throw new Error(`${at} needs a “key”: a short ID of letters, digits, “-”, “_” or “.”.`);
    const name = `Task “${v.key}”`;
    if (keys.has(v.key)) throw new Error(`The key “${v.key}” is used twice.`);
    keys.add(v.key);
    if (typeof v.project !== "string" || !v.project.trim())
      throw new Error(`${name} has no “project”.`);
    const project = matchProject(v.project, allowedProjects);
    if (!project)
      throw new Error(`${name} is for “${v.project}”, which is not one of this goal’s projects.`);
    if (typeof v.title !== "string" || !v.title.trim() || v.title.length > 200)
      throw new Error(`${name} needs a “title” under 200 characters.`);
    const structured = readTaskInstructions(v.prompt);
    const prompt =
      typeof v.prompt === "string" ? v.prompt : structured ? JSON.stringify(structured) : "";
    if (!prompt.trim() || prompt.length > 256_000 || prompt.includes("\0"))
      throw new Error(`${name} has no “prompt”.`);
    const dependsOn = v.dependsOn ?? [];
    if (!Array.isArray(dependsOn) || dependsOn.some((key) => typeof key !== "string"))
      throw new Error(`${name}: “dependsOn” must be a list of task keys.`);
    tasks.push({
      key: v.key,
      project,
      title: v.title.trim(),
      prompt,
      dependsOn: [...new Set(dependsOn as string[])],
    });
  });
  for (const task of tasks)
    for (const key of task.dependsOn)
      if (!keys.has(key))
        throw new Error(`Task “${task.key}” depends on “${key}”, which is not in the plan.`);
  const cycle = findCycle(tasks);
  if (cycle) throw new Error(`The plan’s dependencies form a cycle: ${cycle.join(" → ")}.`);
  return { tasks };
}

/** A dependency cycle among the tasks, as the keys around it with the first
 * repeated at the end, or null when there is none. */
function findCycle(tasks: readonly GoalPlanTask[]): string[] | null {
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  const done = new Set<string>();
  const path: string[] = [];
  const visit = (key: string): string[] | null => {
    const at = path.indexOf(key);
    if (at >= 0) return [...path.slice(at), key];
    if (done.has(key)) return null;
    path.push(key);
    for (const next of byKey.get(key)?.dependsOn ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    path.pop();
    done.add(key);
    return null;
  };
  for (const task of tasks) {
    const cycle = visit(task.key);
    if (cycle) return cycle;
  }
  return null;
}

type ProgressTask = Pick<HostTask, "id" | "title" | "status" | "dependsOn">;

/** How far a goal's tasks have got. */
export function goalProgress(
  goal: Pick<HostGoal, "taskIds">,
  tasks: readonly Pick<HostTask, "id" | "status">[],
): { done: number; total: number } {
  const own = goal.taskIds.flatMap((id) => {
    const task = tasks.find((entry) => entry.id === id);
    return task ? [task] : [];
  });
  return {
    done: own.filter((task) => task.status === "done").length,
    total: own.length,
  };
}

/** Where a goal that has tasks stands: done once every task is done; blocked
 * while some task is blocked and none can make progress, i.e. nothing runs,
 * waits in review, or waits in the queue on dependencies that can still
 * finish; running otherwise. */
export function goalStateFromTasks(
  goal: Pick<HostGoal, "taskIds">,
  all: readonly ProgressTask[],
): { status: "running" | "done" | "blocked"; error?: string } {
  const tasks = goal.taskIds.flatMap((id) => {
    const task = all.find((entry) => entry.id === id);
    return task ? [task] : [];
  });
  if (tasks.length === 0)
    return {
      status: "blocked",
      error: "All of this goal’s tasks were deleted.",
    };
  if (tasks.every((task) => task.status === "done")) return { status: "done" };
  const blocked = tasks.filter((task) => task.status === "blocked");
  if (blocked.length === 0) return { status: "running" };
  // A queued task is stuck when something it waits for, directly or not, is
  // blocked.
  const stuck = new Map<string, boolean>();
  const isStuck = (task: ProgressTask, seen: Set<string>): boolean => {
    if (task.status === "blocked") return true;
    if (task.status !== "queued") return false;
    const known = stuck.get(task.id);
    if (known !== undefined) return known;
    if (seen.has(task.id)) return true;
    seen.add(task.id);
    const result = (task.dependsOn ?? []).some((id) => {
      const dependency = all.find((entry) => entry.id === id);
      return dependency ? isStuck(dependency, seen) : false;
    });
    stuck.set(task.id, result);
    return result;
  };
  const moving = tasks.some(
    (task) => task.status !== "done" && task.status !== "blocked" && !isStuck(task, new Set()),
  );
  if (moving) return { status: "running" };
  return {
    status: "blocked",
    error: `${blocked.length} of ${tasks.length} task${tasks.length === 1 ? "" : "s"} blocked: ${blocked
      .map((task) => task.title)
      .join(", ")}`,
  };
}
