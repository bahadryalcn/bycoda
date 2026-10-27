import { NO_VERDICT } from "./taskRules";
import type { TaskAcceptanceReport } from "./taskAcceptance";
import { parseTaskRunBudget, type TaskRunBudget, type TaskRunBudgetUsage } from "./taskBudget";
import {
  parseTaskPreflightRequirements,
  type TaskPreflightRequirement,
  type TaskPreflightReport,
} from "./taskPreflight";
export type { TaskAcceptanceCriterion, TaskAcceptanceReport } from "./taskAcceptance";
import { parseProviderAccountId } from "../../providers/model/providerAccountId";
import { parseTaskWorkspace, type TaskWorkspace } from "./taskWorkspace";
import { parseCrewScopes } from "../../crews/model/crew";
import type { BranchDeliveryPlan } from "../../workspaces/model/contracts";
export {
  TASK_MOVES,
  canMoveTask,
  canEditTask,
  MAX_TASK_REVIEW_FAILURES,
  TASK_INPUT_REQUIRED,
  taskReviewFailureCount,
  taskRequiresInstructions,
  canTakeOverBlockedTask,
  hasUnmergedBranch,
  NO_VERDICT,
} from "./taskRules";
import { isRemoteProvider, type RemoteProvider } from "../../connections/model/protocol";
import { RUNTIME_MODES, type RuntimeMode } from "../../sessions/model/session";

/** A backlog of tasks a machine's host works through on its own, whether or
 * not a desktop is open. The host advertises this capability when it has it. */
export const HOST_TASKS = "tasks";
/** Explicit local account profiles for unattended task and goal runs. */
export const HOST_TASK_ACCOUNTS = "tasks.provider-accounts";
/** Explicitly clear an independently configured task reviewer on edit. */
export const HOST_TASK_REVIEWER_PROFILE = "tasks.reviewer-profile";

/** The host keeps manual to-do items: tasks the owner adds by hand that no
 * agent starts until they are moved to the queue. The host advertises this
 * capability when it has it; an older host knows only queued tasks. */
export const HOST_TASKS_TODO = "tasks.todo";
/** Progress-aware continuous execution, including planner format recovery. */
export const HOST_TASK_CONTINUATION = "tasks.continue-until-done";

export const TASK_STATUSES = [
  "todo",
  "queued",
  "running",
  "verifying",
  "review",
  "done",
  "blocked",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** The board's columns. A task being verified is shown under Running. */
export const TASK_COLUMNS = [
  "todo",
  "queued",
  "running",
  "review",
  "done",
  "blocked",
] as const satisfies readonly TaskStatus[];
export type TaskColumn = (typeof TASK_COLUMNS)[number];

export function taskColumn(status: TaskStatus): TaskColumn {
  return status === "verifying" ? "running" : status;
}

/** What the host checked after the agent finished, before review. */
export type TaskVerification = {
  command?: { exitCode: number | null; output: string; timedOut: boolean };
  review?: { verdict: "pass" | "fail"; note: string; sessionId: string };
  acceptance?: TaskAcceptanceReport;
};

export type TaskReviewNote = {
  id: string;
  finding: string;
  suggestion?: string;
  /** Supporting prose preserved from legacy reviews without structured findings. */
  details?: string;
  kind: "finding" | "suggestion";
  /** Explicit reviewer classification; absent means a repairable deliverable. */
  category?: "code" | "external";
  /** The reviewer that last reported it, when its session is available. */
  sessionId?: string;
  sessionIds?: string[];
  createdAt: number;
  updatedAt: number;
  occurrences: number;
  readAt?: number;
  resolvedAt?: number;
};

export const TASK_SOURCES = ["manual", "goal", "steward"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

export type HostTaskInput = {
  budget?: TaskRunBudget;
  preflightRequirements?: TaskPreflightRequirement[];
  workflowId?: string;
  workflowVersion?: number;
  /** Reusable team selected to execute this task. Its workers are separate tasks. */
  crewDefinitionId?: string;
  /** Host-owned Crew assignment and its independently selected reviewer. */
  crewRunId?: string;
  crewScopes?: string[];
  /** Working-copy snapshot the independent crew reviewer inspected. */
  crewReviewFingerprint?: string;
  reviewerConfig?: {
    harness: RemoteProvider;
    model: string;
    modelSettings: Record<string, string>;
    instructions: string;
  };
  id: string;
  title: string;
  prompt: string;
  /** The host's ID for the project folder. */
  projectId: string;
  harness: RemoteProvider;
  /** Local profile on the executing host. Absent retains legacy host default. */
  providerAccountId?: string;
  model: string;
  modelSettings: Record<string, string>;
  runtimeMode: RuntimeMode;
  /** Stop a run still going after this long; zero means off. */
  maxRunMinutes: number;
  /** Run on a new branch in its own worktree when the project is a git
   * repository. A task saved before this existed counts as true. */
  isolate?: boolean;
  workspace?: TaskWorkspace;
  /** Persisted board/queue order. */
  position?: number;
  /** A shell command that must exit with zero before the task reaches review. */
  verifyCommand?: string;
  /** Have a second agent review the result. Counts as true when absent. */
  review?: boolean;
  /** Legacy preference, accepted for migration only. The Host suspends it and
   * requires a fresh SHA-bound owner approval for integration delivery. */
  autoMerge?: boolean;
  /** Keep correcting actionable failures while work progresses. Owner stops,
   * unchanged attempts and genuinely unavailable resources still require input. */
  continueUntilDone?: boolean;
  /** The goal this task was planned for. */
  goalId?: string;
  /** Where the task came from. Absent counts as manual or planned by a goal. */
  source?: TaskSource;
  /** The steward that proposed this task. */
  stewardId?: string;
  /** Tasks that must be done (merged) before this one starts. */
  dependsOn?: string[];
};

/** Wire-only clear sentinel; persisted tasks keep a normalized optional profile. */
export type HostTaskWireInput = Omit<HostTaskInput, "reviewerConfig"> & {
  reviewerConfig?: HostTaskInput["reviewerConfig"] | null;
};

/** Task-specific extension of the frozen workspace review; these ignored outputs need explicit review too. */
export interface TaskDeliveryArtifactsPreview {
  paths: string[];
  hashes: Record<string, string>;
  sourceFingerprint: string;
  targetFingerprint: string;
  targetHashes: Record<string, string | null>;
  blockers: string[];
}
export type TaskDeliveryReview = BranchDeliveryPlan & { artifacts?: TaskDeliveryArtifactsPreview };

export type HostTask = HostTaskInput & {
  /** Registry identity survives directory retirement; paths are only materialization hints. */
  workspaceId?: string;
  /** Durable attempt identity keeps prepare retries idempotent without reusing an already delivered workspace. */
  workspaceGenerationId?: string;
  workspaceActivityId?: string;
  deliveryState?: "awaitingOwner" | "merged" | "published";
  deliveryOperationId?: string;
  artifactDeliveryPending?: boolean;
  /** An incomplete artifact delivery fences directory retirement until its receipt reconciles. */
  artifactDeliveryActivityId?: string;
  /** Owner-reviewed ignored outputs, bound to the same opaque delivery plan token. */
  deliveryArtifacts?: TaskDeliveryArtifactsPreview & {
    planToken: string;
    sourceHead: string;
    targetDirectory: string;
  };
  /** Persisted autoMerge settings are suspended until a fresh SHA-bound owner approval. */
  deliveryApprovalRequired?: boolean;
  finalization?: {
    branch: string;
    head: string;
    status: string;
    diff: string;
    fingerprint: string;
    clean: boolean;
  };
  evaluation?: {
    accepted: boolean;
    reviewMinutes: number;
    corrections: number;
    recordedAt: number;
  };
  budgetUsage?: TaskRunBudgetUsage;
  budgetStop?: string;
  preflight?: TaskPreflightReport;
  /** Durable, host-owned identity of this task's current crew execution. */
  crewExecutionId?: string;
  status: TaskStatus;
  sessionId?: string;
  /** The session turn this task started. */
  runId?: string;
  /** Why the task is blocked. */
  error?: string;
  /** Failed checks carried into the next worker run, including via To do. */
  retryFeedback?: string;
  /** Automatic correction runs used by a goal/steward task, persisted across restarts. */
  repairAttempts?: number;
  /** Failed reviews since the owner last changed the task instructions. */
  reviewFailureCount?: number;
  /** Saving instructions does not silently restart blocked work. */
  awaitingOwnerRestart?: boolean;
  /** One independent recovery worker per owner instruction revision. */
  blockedTakeover?: {
    at: number;
    previousSessionId?: string;
    blocker: string;
  };
  /** The finding that triggered the latest automatic correction. */
  repairNote?: string;
  /** The failed check plus working-copy contents, used to stop unchanged retries. */
  checkFailureFingerprint?: string;
  repairStop?: {
    reason: "external" | "no_progress" | "limit";
    message: string;
  };
  /** Bounded, durable outcomes; worker summaries are claims, not acceptance evidence. */
  attemptHistory?: {
    attempt: number;
    at: number;
    workerSessionId?: string;
    reviewerSessionId: string;
    workerSummary: string;
    verdict: "pass" | "fail";
    reviewOnly?: boolean;
    note: string;
    findings: string[];
    workspaceFingerprint?: string;
  }[];
  /** An owner-requested recheck must never launch another worker implicitly. */
  reviewOnly?: boolean;
  /** Durable review findings; absent on hosts predating task notes. */
  reviewNotes?: TaskReviewNote[];
  /** The branch an isolated task works on, and the worktree it is checked
   * out in. Kept until the task is merged or discarded. */
  branch?: string;
  worktreeCwd?: string;
  /** The branch the project was on when the task branch was created, and the
   * commit the task branch started from. */
  baseBranch?: string;
  baseCommit?: string;
  /** Checkout selected for delivery, independent of the task's working copy. */
  deliveryCwd?: string;
  /** Delivery is recorded separately from implementation completion. The branch is retained. */
  merged?: boolean;
  /** The merge happened on its own, and when. */
  autoMerged?: boolean;
  mergedAt?: number;
  /** Integration commit needed by same-project dependent tasks. */
  deliveredCommit?: string;
  /** Ignored local output paths delivered alongside this task, for dependency transfer. */
  artifactPaths?: string[];
  artifactHashes?: Record<string, string>;
  /** Legacy intent only; never an authorization to deliver without a fresh owner plan. */
  deliveryRequested?: boolean;
  /** Dependency outputs have been copied into this task's retained checkout. */
  dependencyArtifactsPrepared?: boolean;
  verification?: TaskVerification;
  /** The reviewer's session turn while it is still running. */
  reviewer?: {
    sessionId?: string;
    runId?: string;
    startedAt: number;
    /** New reviews must explicitly report evidence for every acceptance criterion. */
    acceptanceRequired?: boolean;
    /** Working-copy contents inspected by this reviewer, when available. */
    workspaceFingerprint?: string;
    error?: string;
    /** Format-only follow-ups; these do not launch another implementation worker. */
    verdictRepairAttempts?: number;
    verdictRepairPending?: boolean;
    /** Trusted host interruption; waits for daily capacity without rereviewing from scratch. */
    recoveryPending?: boolean;
  };
  /** What the task branch changes, for a task in review. */
  diffStat?: string;
  /** Why the last attempt to merge a reviewed task failed. */
  mergeError?: string;
  /** Owner follow-up after a delivery into a checkout with uncommitted edits. */
  deliveryNote?: string;
  /** Models are only used for conflicts in the retained task checkout. */
  mergeRepair?: {
    baseHead: string;
    conflicts: string[];
    attempts: number;
    prepared?: boolean;
    /** A flattened task delta to replay after the delivery history was replaced. */
    replayCommit?: string;
    /** Persisted before applying so interrupted replay can resume without discarding files. */
    replayStarted?: boolean;
  };
  /** Original results retained when replaying onto a replacement Git history. */
  historyRecovery?: Array<{
    branch: string;
    worktreeCwd?: string;
    baseCommit: string;
    head: string;
  }>;
  /** Retry unchanged checkout failures with backoff, without another agent. */
  mergeRetry?: { fingerprint: string; after: number };
  /** Cleanup failure does not discard the retained working copy's location. */
  cleanupError?: string;
  cleanupRetryAfter?: number;
  cleanupArchives?: string[];
  /** The running session is waiting on an approval or a question. */
  needsInput?: boolean;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
};

export function isTaskStatus(value: unknown): value is TaskStatus {
  return TASK_STATUSES.some((status) => status === value);
}

/** Where a new task may start: on the queue, or as a to-do item. */
export function isNewTaskStatus(value: unknown): value is "todo" | "queued" {
  return value === "todo" || value === "queued";
}

export const EMPTY_PROMPT_ERROR = "Add a description before starting this task with an agent.";

/** The dependencies a task still waits for: those not done yet. A dependency
 * that was deleted no longer holds the task back. */
export function unfinishedDependencies<T extends Pick<HostTask, "id" | "status">>(
  task: Pick<HostTask, "dependsOn">,
  tasks: readonly T[],
): T[] {
  return (task.dependsOn ?? []).flatMap((id) => {
    const dependency = tasks.find((entry) => entry.id === id);
    return dependency &&
      (dependency.status !== "done" ||
        ("branch" in dependency &&
          Boolean(dependency.branch) &&
          !("merged" in dependency && dependency.merged)))
      ? [dependency]
      : [];
  });
}

/** Reads the reviewer's reply: its last line must be `VERDICT: PASS` or
 * `VERDICT: FAIL - <why>`. Anything else fails the review. */
export function parseReviewVerdict(reply: string): {
  verdict: "pass" | "fail";
  note: string;
} {
  const line = (reply.trim().split(/\r?\n/).pop() ?? "").replace(/[*_`]/g, "").trim();
  const match = /^VERDICT:\s*(PASS|FAIL)\b\s*[-–—:.]?\s*(.*)$/i.exec(line);
  if (!match) return { verdict: "fail", note: NO_VERDICT };
  const note = match[2].trim().slice(0, 300);
  return match[1].toUpperCase() === "PASS"
    ? { verdict: "pass", note }
    : { verdict: "fail", note: note || "The reviewer gave no reason." };
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Validates what a desktop sent. Throws with the reason on bad input. */
export function parseHostTask(input: unknown): HostTaskInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid task");
  const v = input as Record<string, unknown>;
  if (
    v.workflowId !== undefined &&
    (typeof v.workflowId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(v.workflowId))
  )
    throw new Error("Invalid task workflow identity.");
  if (
    v.workflowVersion !== undefined &&
    (!Number.isSafeInteger(v.workflowVersion) || Number(v.workflowVersion) < 1)
  )
    throw new Error("Invalid task workflow version.");
  if (
    v.crewDefinitionId !== undefined &&
    (typeof v.crewDefinitionId !== "string" || !ID.test(v.crewDefinitionId))
  )
    throw new Error("Invalid task crew");
  if (v.crewDefinitionId && v.crewRunId)
    throw new Error("A crew assignment cannot start another team task.");
  if (
    v.crewDefinitionId &&
    (v.isolate === true || v.workspace || v.autoMerge === true || v.continueUntilDone === true)
  )
    throw new Error("Crew tasks use the selected shared project and crew-managed review.");
  if (v.crewRunId !== undefined && (typeof v.crewRunId !== "string" || !ID.test(v.crewRunId)))
    throw new Error("Invalid crew run");
  let reviewerConfig: HostTaskInput["reviewerConfig"];
  if (v.reviewerConfig !== undefined && v.reviewerConfig !== null) {
    const r = v.reviewerConfig as Record<string, unknown>;
    if (
      !r ||
      !isRemoteProvider(r.harness) ||
      typeof r.model !== "string" ||
      !r.model.trim() ||
      r.model.length > 200 ||
      typeof r.instructions !== "string" ||
      r.instructions.length > 12000 ||
      !r.modelSettings ||
      typeof r.modelSettings !== "object" ||
      Array.isArray(r.modelSettings) ||
      Object.values(r.modelSettings).some((x) => typeof x !== "string")
    )
      throw new Error("Invalid crew reviewer");
    reviewerConfig = {
      harness: r.harness,
      model: r.model,
      modelSettings: r.modelSettings as Record<string, string>,
      instructions: r.instructions,
    };
  }
  if (typeof v.id !== "string" || !ID.test(v.id)) throw new Error("Invalid task ID");
  if (typeof v.title !== "string" || !v.title.trim() || v.title.length > 200)
    throw new Error("Task title is required and must be under 200 characters.");
  // A to-do item may have no description; the host asks for one before an
  // agent starts the task.
  if (typeof v.prompt !== "string" || v.prompt.length > 256_000 || v.prompt.includes("\0"))
    throw new Error("Invalid task description.");
  if (typeof v.projectId !== "string" || !ID.test(v.projectId))
    throw new Error("Choose a project for this task.");
  if (!isRemoteProvider(v.harness)) throw new Error("Invalid task agent");
  if (typeof v.model !== "string" || !v.model.trim() || v.model.length > 200)
    throw new Error("Invalid task model");
  if (!RUNTIME_MODES.includes(v.runtimeMode as never)) throw new Error("Invalid task run mode.");
  const settings = v.modelSettings ?? {};
  if (
    typeof settings !== "object" ||
    Array.isArray(settings) ||
    Object.values(settings as object).some((value) => typeof value !== "string")
  )
    throw new Error("Invalid model settings");
  const limit = v.maxRunMinutes ?? 0;
  if (!Number.isInteger(limit) || Number(limit) < 0 || Number(limit) > 10_080)
    throw new Error("Invalid task run limit");
  if (
    (v.isolate !== undefined && typeof v.isolate !== "boolean") ||
    (v.review !== undefined && typeof v.review !== "boolean") ||
    (v.autoMerge !== undefined && typeof v.autoMerge !== "boolean") ||
    (v.continueUntilDone !== undefined && typeof v.continueUntilDone !== "boolean")
  )
    throw new Error("Invalid task options");
  const check = v.verifyCommand ?? "";
  const workspace = parseTaskWorkspace(v.workspace);
  if (v.position !== undefined && (!Number.isSafeInteger(v.position) || Number(v.position) < 0))
    throw new Error("Invalid task position");
  if (typeof check !== "string" || check.length > 4000 || check.includes("\0"))
    throw new Error("Invalid check command");
  if (v.goalId !== undefined && (typeof v.goalId !== "string" || !ID.test(v.goalId)))
    throw new Error("Invalid task goal");
  if (v.source !== undefined && !TASK_SOURCES.some((source) => source === v.source))
    throw new Error("Invalid task source");
  if (v.stewardId !== undefined && (typeof v.stewardId !== "string" || !ID.test(v.stewardId)))
    throw new Error("Invalid task steward");
  if (
    v.dependsOn !== undefined &&
    (!Array.isArray(v.dependsOn) ||
      v.dependsOn.length > 20 ||
      v.dependsOn.some((id) => typeof id !== "string" || !ID.test(id) || id === v.id))
  )
    throw new Error("Invalid task dependencies");
  return {
    id: v.id,
    ...(v.budget === undefined ? {} : { budget: parseTaskRunBudget(v.budget) }),
    ...(v.preflightRequirements === undefined
      ? {}
      : { preflightRequirements: parseTaskPreflightRequirements(v.preflightRequirements) }),
    ...(typeof v.workflowId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v.workflowId)
      ? { workflowId: v.workflowId }
      : {}),
    ...(Number.isSafeInteger(v.workflowVersion) && Number(v.workflowVersion) > 0
      ? { workflowVersion: Number(v.workflowVersion) }
      : {}),
    ...(typeof v.crewDefinitionId === "string" ? { crewDefinitionId: v.crewDefinitionId } : {}),
    ...(typeof v.crewRunId === "string" ? { crewRunId: v.crewRunId } : {}),
    ...(v.crewScopes === undefined ? {} : { crewScopes: parseCrewScopes(v.crewScopes) }),
    ...(reviewerConfig || v.reviewerConfig === null ? { reviewerConfig } : {}),
    title: v.title.trim(),
    prompt: v.prompt,
    projectId: v.projectId,
    harness: v.harness,
    ...(v.providerAccountId === undefined
      ? {}
      : { providerAccountId: parseProviderAccountId(v.providerAccountId, v.harness) }),
    model: v.model,
    modelSettings: settings as Record<string, string>,
    runtimeMode: v.runtimeMode as RuntimeMode,
    maxRunMinutes: Number(limit),
    ...(v.crewDefinitionId
      ? { isolate: false }
      : v.isolate === undefined
        ? {}
        : { isolate: v.isolate as boolean }),
    ...(workspace ? { workspace } : {}),
    ...(v.position !== undefined ? { position: Number(v.position) } : {}),
    ...(check.trim() ? { verifyCommand: check.trim() } : {}),
    review: v.crewDefinitionId ? false : v.review !== false,
    ...(v.autoMerge === true ? { autoMerge: true } : {}),
    ...(v.continueUntilDone === true ? { continueUntilDone: true } : {}),
    ...(typeof v.goalId === "string" ? { goalId: v.goalId } : {}),
    ...(typeof v.source === "string" ? { source: v.source as TaskSource } : {}),
    ...(typeof v.stewardId === "string" ? { stewardId: v.stewardId } : {}),
    ...(Array.isArray(v.dependsOn) ? { dependsOn: [...new Set(v.dependsOn as string[])] } : {}),
  };
}

/** Why a task in review cannot be merged on its own, or undefined when every
 * configured check ran and passed. */
export function autoMergeBlocker(
  task: Pick<HostTask, "verifyCommand" | "review" | "verification">,
): string | undefined {
  const command = Boolean(task.verifyCommand);
  const reviewer = task.review !== false;
  // Explicit automatic merge also applies when the owner disabled checks.
  const { verification } = task;
  if (command) {
    const result = verification?.command;
    if (!result || result.timedOut || result.exitCode !== 0)
      return "Not merged automatically: the check command did not pass";
  }
  if (reviewer && verification?.review?.verdict !== "pass")
    return "Not merged automatically: the reviewer did not pass it";
  return undefined;
}
