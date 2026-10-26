import { forEachAsync, mapAsync, someAsync } from "./async-collections";
import { runGitText } from "../src/shared/lib/processExecution.node";
import { assertExpectedConfiguration } from "./configurationConflict";
import { createHash, randomUUID } from "node:crypto";
import { constants, statSync } from "node:fs";
import { access, lstat, readdir, readFile } from "node:fs/promises";
import { setImmediate as yieldFingerprint } from "node:timers/promises";
import { join } from "node:path";
import {
  autoMergeBlocker,
  canEditTask,
  canMoveTask,
  canTakeOverBlockedTask,
  EMPTY_PROMPT_ERROR,
  MAX_TASK_REVIEW_FAILURES,
  TASK_INPUT_REQUIRED,
  taskReviewFailureCount,
  taskRequiresInstructions,
  hasUnmergedBranch,
  isNewTaskStatus,
  isTaskStatus,
  NO_VERDICT,
  parseHostTask,
  parseReviewVerdict,
  type HostTask,
  type HostTaskInput,
  type TaskDeliveryReview,
  type TaskVerification,
} from "../src/features/tasks/model/hostTasks";
import { DEFAULT_MAX_RUNNING_TASKS } from "../src/features/tasks/model/hostSettings";
import { blockedHandoff, taskContract } from "./task-handoff";
import { readTaskInstructions } from "../src/features/tasks/model/taskInstructions";
import {
  acceptanceReviewInstructions,
  hasTaskAcceptanceReport,
  parseTaskAcceptance,
} from "../src/features/tasks/model/taskAcceptance";
import {
  addReviewNotes,
  coalesceReviewNotes,
  openReviewNotesPrompt,
  resolveReviewFindings,
  resolveReviewedNotes,
  reviewFindings,
  reviewRepairStop,
} from "../src/features/tasks/model/taskReviewNotes";
import { createHostWorktree } from "./git-worktrees";
import { taskWorkspace } from "./task-workspace";
import { transferTaskArtifacts } from "./task-artifacts";
import {
  previewTaskDeliveryArtifacts,
  validateTaskDeliveryArtifacts,
} from "./task-delivery-artifacts";
import { acceptanceOutputFingerprint } from "./task-acceptance-snapshot";
import { parseTaskWorkspace } from "../src/features/tasks/model/taskWorkspace";
import type { HostGoal } from "../src/features/tasks/model/hostGoals";
import type {
  SprintSourceEvent,
  SprintTaskSnapshot,
} from "../src/features/tasks/model/hostSprints";
import { HostLimits } from "./limits";
import { hostGitRepositoryKey, withHostGitMutation } from "./git-mutations";
import { HostTaskBudgets } from "./task-budgets";
import { checkTaskPreflight } from "./task-preflight";
import { evaluateTaskPreflight } from "../src/features/tasks/model/taskPreflight";
import { parseTaskEvaluation } from "../src/features/tasks/model/taskMetrics";
import {
  HOST_INTERRUPTED,
  STOPPED_BY_USER,
  cancelSessionRun,
  errorMessage,
  launchSessionRun,
  sessionRunState,
  type SessionRunEngine,
} from "./sessionRuns";
import { runHostShell } from "./shell";
import type { HostStore } from "./store";
import {
  previewTaskFinalization,
  suspendedTaskDelivery,
  type TaskWorkspaceServices,
} from "./task-workspace-runtime";
import type { WorkspaceOwnerAuthorization } from "./workspace-service-contracts";
import type { WorkspaceRpcRequest } from "./workspace-rpc-contracts";
import type { BranchMergeReceipt } from "./workspace-contracts";
const TICK_MS = 30000;
/** How many tasks a machine works on at once until its owner changes it. */
export const MAX_RUNNING_TASKS = DEFAULT_MAX_RUNNING_TASKS;
/** How long a task's check command may run. */
export const VERIFY_TIMEOUT_MS = 15 * 60000;
const VERIFY_OUTPUT_LIMIT = 4000;
const DIFF_STAT_LIMIT = 2000;
const RETRY_FEEDBACK_LIMIT = 12000;
const SHARED_EDITS_LIMIT = 60;
export const MAX_REPAIR_ATTEMPTS = 3;
/** Consume bounded I/O batches in legacy order, including errors and limits. */
async function fingerprintPaths(
  hash: ReturnType<typeof createHash>,
  cwd: string,
  names: string[],
  budget: {
    entries: number;
    bytes: number;
  },
  pending?: string[],
): Promise<boolean> {
  for (let offset = 0; offset < names.length;) {
    const count = Math.min(8, pending ? 2000 - budget.entries : 8);
    if (!count) return false;
    const batch = names.slice(offset, offset + count);
    offset += batch.length;
    const metadata = await Promise.allSettled(batch.map((name) => lstat(join(cwd, name))));
    const reads: Array<{
      name: string;
      result: Promise<PromiseSettledResult<Buffer>>;
    }> = [];
    let stop:
      | {
          error: unknown;
        }
      | {
          limit: true;
        }
      | undefined;
    for (let index = 0; index < batch.length; index++) {
      if (pending) budget.entries++;
      const name = batch[index];
      const entry = metadata[index];
      if (entry.status === "rejected") {
        stop = { error: entry.reason };
        break;
      }
      const info = entry.value;
      if (pending && info.isSymbolicLink()) continue;
      if (pending && info.isDirectory()) pending.push(name);
      else if (info.isFile()) {
        if ((budget.bytes += info.size) > 16 * 1024 * 1024) {
          stop = { limit: true };
          break;
        }
        // Attach rejection handling immediately; consume each result in order.
        reads.push({
          name,
          result: readFile(join(cwd, name)).then(
            (value) => ({ status: "fulfilled" as const, value }),
            (reason: unknown) => ({ status: "rejected" as const, reason }),
          ),
        });
      } else if (!pending) {
        stop = { limit: true };
        break;
      }
    }
    // Drain the batch before propagating an error into the Git fallback, so
    // failed reads cannot leave extra I/O running alongside its next batch.
    const contents = await Promise.all(reads.map(({ result }) => result));
    for (let index = 0; index < reads.length; index++) {
      // The old implementation adds the name even if reading then fails.
      hash.update(reads[index].name);
      const content = contents[index];
      if (content.status === "rejected") throw content.reason;
      for (let offset = 0; offset < content.value.length; offset += 256 * 1024) {
        hash.update(content.value.subarray(offset, offset + 256 * 1024));
        await yieldFingerprint();
      }
    }
    if (stop) {
      if ("error" in stop) throw stop.error;
      return false;
    }
  }
  return true;
}
class UnresolvedMerge extends Error {}
class TaskPreparationSuperseded extends Error {}
async function git(cwd: string, args: string[], timeout = 30000): Promise<string> {
  const stdout = await runGitText(args, {
    cwd,
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout.trim();
}
function available(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
function reviewPrompt(task: HostTask): string {
  const changes =
    hasUnmergedBranch(task) && task.baseCommit
      ? `the changes made since commit ${task.baseCommit} (\`git diff ${task.baseCommit}\`)`
      : "the uncommitted changes in this folder (`git status`, `git diff`)";
  return [
    "You are reviewing work another agent just finished. Only inspect: do not edit, create or delete files, and do not commit.",
    "This is an unattended task review. Review both correctness and repository standards yourself, in one agent; do not spawn subagents or invoke a multi-agent review workflow. The task below is the complete spec, so do not set up an issue tracker or ask for another spec.",
    "Read the changed files and only the relevant dependencies and guidance. Reuse evidence within this review. Run focused checks once; repeat only after a change, failure or unresolved concern. Check whether added gates break development workflows. Report incomplete acceptance checks explicitly; passing this task does not imply release or physical-device approval.",
    "",
    `Task: ${task.title}`,
    "",
    "What was asked:",
    taskContract(task),
    "",
    `Review ${changes} and judge whether they do what was asked, completely and correctly.`,
    "Fail for concrete missing or incorrect deliverables and explain actionable fixes. A worker reporting an unavailable physical-device, release or external-service acceptance check is not by itself a code defect: inspect the implementation and available evidence. Fail for missing acceptance evidence only when the task explicitly requires that evidence; never claim an unperformed check passed.",
    openReviewNotesPrompt(task.reviewNotes),
    acceptanceReviewInstructions(readTaskInstructions(task.prompt)?.acceptance ?? []),
    'Before the final verdict, include a fenced json block {"reviewNotes":[{"finding":"specific defect, with file/location when known","suggestion":"actionable correction","kind":"finding"}]}. Use one entry per distinct finding. Use kind "suggestion" for optional improvements, which must not cause FAIL. On PASS all earlier open findings must be verified fixed; only optional suggestions may remain. Do not invent notes when there are none.',
    "Reuse the wording of an earlier finding when the same defect remains, so its history is retained rather than creating a duplicate.",
    'In that same JSON block include "resolvedNoteIds":["earlier-note-id"] only for earlier findings you verified fixed against code and checks. Resolve verified fixes even when another finding keeps this review at FAIL. Never resolve an unavailable acceptance check or a worker claim without verification. Absence from the new findings does not automatically resolve an old note.',
    'For every required finding add category "code" (locally fixable deliverable) or "external" (only an explicitly required acceptance check needs unavailable device/access/user input), and an actionable suggestion. Use external only after checking that no local implementation or test fix can address that finding. An external finding must name the unavailable resource and the exact next check. Mixed reviews keep code defects as code; never hide missing functionality as external. Both categories still require FAIL until satisfied.',
    "",
    "End your reply with exactly one final line, either",
    "VERDICT: PASS",
    "or",
    "VERDICT: FAIL - <one sentence saying why>",
  ].join("\n");
}
/** The task's prompt, led by where to work when the task has a worktree of
 * its own: an agent told to work in the project folder would otherwise edit
 * the main checkout, leaving the task's branch empty. */
function workerPrompt(task: HostTask, projectCwd: string, sharedEdits: string[] = []): string {
  const shared = sharedEdits.length
    ? `Files with uncommitted edits by other sessions in ${projectCwd} (information only; they are not part of your base and must not be copied): ${sharedEdits.join(", ")}. Avoid editing these unless the task requires it; then keep your change minimal and self-contained so both can be reconciled on delivery.`
    : "";
  if (task.blockedTakeover)
    return [
      `Work only in ${task.worktreeCwd ?? projectCwd}${task.branch ? ` on ${task.branch}` : ""}. Commit scoped changes on your assigned branch and finish with a clean source tree. Never merge into the integration checkout, push or create PRs. The owner approves delivery separately; retain all existing work.`,
      taskContract(task),
      blockedHandoff(task),
      task.retryFeedback ?? "",
    ]
      .filter(Boolean)
      .join("\n\n");
  if (task.mergeRepair)
    return [
      `Continue the existing task in ${task.worktreeCwd} on ${task.branch}. Do not edit or switch branches in ${projectCwd}.`,
      `Task: ${task.title}`,
      taskContract(task),
      task.mergeRepair.replayCommit
        ? `The delivery history was replaced. The host replayed only the recorded task changes onto base commit ${task.mergeRepair.baseHead} in this new checkout. The original result is retained. Resolve integration defects${task.mergeRepair.conflicts.length ? ` and conflicts in: ${task.mergeRepair.conflicts.join(", ")}` : ""}, and regenerate source-derived records against this checkout.`
        : `The host merged base commit ${task.mergeRepair.baseHead} into this task checkout. Resolve only the integration defects and conflicts in: ${task.mergeRepair.conflicts.join(", ")}.`,
      "Keep both the completed task and the newer base-branch functionality. Inspect each conflict; never blindly choose ours/theirs, reset, rebase, or discard work. Stage the resolved files and commit the integration result. Do not restart the task or broaden its scope. The host will rerun the configured checks and review before delivery.",
      openReviewNotesPrompt(task.reviewNotes),
      task.retryFeedback ?? "",
    ]
      .filter(Boolean)
      .join("\n\n");
  const original =
    task.isolate === false
      ? `Work directly in ${task.worktreeCwd ?? projectCwd}, the selected checkout shared with other sessions. Preserve their uncommitted work and change only your assigned scope. Do not create another worktree or switch branches. Leave changes uncommitted for the owner's review; do not stage, commit, merge or push.\n\n${taskContract(task)}`
      : task.worktreeCwd
        ? [
            `You are working in ${task.worktreeCwd}, a separate checkout of the project at ${projectCwd}${task.branch ? ` on the branch ${task.branch}` : ""}. Make every change in this folder. Commit scoped changes on this branch and finish with a clean source tree. Never merge into the integration checkout, push or create PRs. Do not edit, commit in or switch branches in ${projectCwd}: paths under it in the task below mean the same files under this folder.`,
            ...(shared ? [shared] : []),
            "",
            taskContract(task),
          ].join("\n")
        : taskContract(task);
  const notes = openReviewNotesPrompt(task.reviewNotes);
  const prompt = notes ? `${original}\n\n${notes}` : original;
  if (!task.retryFeedback) return prompt;
  return [
    prompt,
    "",
    "The previous attempt did not pass verification. Continue from the existing work and fix the findings below before finishing. Check them against the source and the original task; do not bypass checks or broaden the task to make it pass.",
    "",
    "Previous verification feedback:",
    task.retryFeedback,
    "Summarize the changes actually made, checks run with their results, which findings remain, and any unavailable resource plus the concrete next action. If an earlier correction did not address a finding, explain why and choose a different approach. Do not just repeat the previous completion claim or retry an unavailable physical acceptance test.",
  ].join("\n");
}
/** The verdict of the reviewer's last turn: from its latest message that
 * ends with one, since a short message may follow the verdict. */
function reviewerVerdict(
  blocks: Awaited<ReturnType<HostStore["session"]>>["session"]["blocks"],
): ReturnType<typeof parseReviewVerdict> {
  return parseReviewVerdict(reviewerReply(blocks));
}
function reviewerReply(
  blocks: Awaited<ReturnType<HostStore["session"]>>["session"]["blocks"],
): string {
  const lastUser = blocks.findLastIndex((block) => block.role === "user");
  const replies = blocks
    .slice(lastUser + 1)
    .filter((block) => block.role === "assistant" && block.text.trim());
  for (let at = replies.length - 1; at >= 0; at--) {
    const reply = replies[at];
    const review = parseReviewVerdict(reply.text);
    if (review.note !== NO_VERDICT)
      return replies
        .slice(0, at + 1)
        .map((block) => block.text)
        .join("\n\n");
  }
  return "";
}
/** Works through this machine's task backlog with no desktop open. Explicit
 * direct tasks share the selected checkout; other tasks require an isolated
 * Git worktree and wait for approval before delivery to the project checkout. */
export class HostTasks {
  private timer?: ReturnType<typeof setInterval>;
  private ticking?: Promise<void>;
  private closing = false;
  get admissionClosed(): boolean {
    return this.closing;
  }
  private disposal?: Promise<void>;
  /** Verifications in progress, by task. A task keeps one at most. */
  private readonly jobs = new Map<string, Promise<void>>();
  private readonly jobControllers = new Map<string, AbortController>();
  /** Tasks being merged. */
  private readonly delivering = new Set<string>();
  /** Runs on every tick once running tasks are settled, before queued ones
   * start, so work it queues can start in the same tick. */
  private beforeStart?: () => Promise<void> | void;
  /** Crew policy shares this scheduler; it cannot bypass ordinary task gates. */
  crewCanStart?: (task: HostTask) => boolean | Promise<boolean>;
  crewRunner?: {
    validate: (task: HostTaskInput) => void | Promise<void>;
    start: (task: HostTask) => Promise<{
      sessionId: string;
      harness: HostTask["harness"];
      model: string;
      modelSettings: Record<string, string>;
    }>;
    state: (task: HostTask) =>
      | {
          status: "active" | "paused" | "finished";
          error?: string;
        }
      | Promise<{
          status: "active" | "paused" | "finished";
          error?: string;
        }>;
    stop: (task: HostTask) => Promise<void>;
  };
  /** This machine's work limits and its ledger of agent time, shared with
   * goals and stewards. */
  readonly limits!: HostLimits;
  readonly budgets!: HostTaskBudgets;
  private readonly externalRunSources: Array<() => number | Promise<number>> = [];
  private readonly registeredBudgetRuns = new Set<string>();
  trackExternalRuns(source: () => number | Promise<number>): void {
    this.externalRunSources.push(source);
  }
  async resultFingerprint(task: HostTask): Promise<string | undefined> {
    await this.ready;

    return await this.acceptanceFingerprint({
      ...task,
      worktreeCwd: task.merged
        ? (task.deliveryCwd ?? (await this.store.project(task.projectId)).cwd)
        : task.worktreeCwd,
    });
  }
  async preflight(raw: unknown) {
    await this.ready;

    const task = parseHostTask(raw);
    const project = await this.store.project(task.projectId);
    const cwd = task.workspace
      ? (await taskWorkspace(project.cwd, task.workspace)).cwd
      : project.cwd;
    return await this.preflightAt(task, cwd);
  }
  private async preflightAt(task: HostTaskInput, cwd: string) {
    const resources = await checkTaskPreflight(cwd, task.preflightRequirements ?? [], {
      now: this.now,
    });
    let readableProject = false;
    try {
      await access(cwd, constants.R_OK);
      readableProject = (await lstat(cwd)).isDirectory();
    } catch {
      /* Keep failed reads visible. */
    }
    const now = this.now();
    const report = evaluateTaskPreflight(
      task.preflightRequirements ?? [],
      {
        host: { state: "ready", origin: "runtime", checkedAt: now },
        project: {
          state: readableProject ? "ready" : "missing",
          origin: "runtime",
          checkedAt: now,
        },
        provider: {
          state: "unknown",
          origin: "configuration",
          checkedAt: now,
          detail: "Provider authentication is checked when its run starts.",
        },
        model: {
          state: "unknown",
          origin: "configuration",
          checkedAt: now,
          detail: "The selected model has not been contacted by this preparation check.",
        },
        resources,
      },
      now,
    );
    // These checks are deferred to provider execution, never inferred from inventory.
    const items = report.items.map((item) =>
      item.key === "provider" || item.key === "model" ? { ...item, required: false } : item,
    );
    const required = items.filter((item) => item.required);
    return {
      ...report,
      items,
      state: required.some((item) => item.state === "blocked")
        ? ("blocked" as const)
        : required.some((item) => item.state === "unknown")
          ? ("unknown" as const)
          : ("ready" as const),
    };
  }
  async recordEvaluation(id: string, raw: unknown, expectedUpdatedAt: unknown): Promise<HostTask> {
    await this.ready;
    return this.store.db.scope(async () => {
      await this.ready;

      const task = await this.get(id);
      if (!task || task.updatedAt !== expectedUpdatedAt)
        throw new Error("Task changed. Refresh before recording the outcome.");
      if (task.status !== "done" && task.status !== "review")
        throw new Error("Record an outcome after task checks finish.");
      const evaluation = parseTaskEvaluation(raw);
      return await this.write({
        ...task,
        evaluation: { ...evaluation, recordedAt: this.now() },
        updatedAt: Math.max(this.now(), task.updatedAt + 1),
      });
    });
  }
  private async budgetReason(task: HostTask, starting = false): Promise<string | undefined> {
    const own = await this.budgets.evaluate({ taskId: task.id }, task.budget, { starting });
    const parent = await this.budgetParent(task);
    const parentLimit = parent?.budget
      ? await this.budgets.evaluate({ taskId: parent.id }, parent.budget, { starting })
      : undefined;
    const goalId = task.goalId ?? parent?.goalId;
    const goal = goalId ? await this.owningGoal(goalId) : undefined;
    const family = goal?.budget
      ? await this.budgets.evaluate({ goalId: goal.id }, goal.budget, { starting })
      : undefined;
    return own.blocked
      ? `Task ${task.title}: ${own.reasons.join(" ")}`
      : parentLimit?.blocked
        ? `Crew task ${parent!.title}: ${parentLimit.reasons.join(" ")}`
        : family?.blocked
          ? `Goal ${goal!.title}: ${family.reasons.join(" ")}`
          : undefined;
  }
  private async budgetParent(task: HostTask): Promise<HostTask | undefined> {
    if (!task.crewRunId) return;
    const row = await this.store.db
      .prepare("SELECT value FROM tasks WHERE json_extract(value, '$.crewExecutionId')=? LIMIT 1")
      .get(task.crewRunId);
    return row ? (JSON.parse(String(row.value)) as HostTask) : undefined;
  }
  private async budgetBlock(task: HostTask, reason: string, now: number): Promise<HostTask> {
    return await this.block(
      { ...task, budgetStop: reason, awaitingOwnerRestart: true },
      `Run budget: ${reason}`,
      now,
      true,
    );
  }
  readonly ready: Promise<void>;
  constructor(
    private readonly store: HostStore,
    private readonly engine: SessionRunEngine,
    private readonly now: () => number = Date.now,
    private readonly verifyTimeoutMs = VERIFY_TIMEOUT_MS,
    private readonly managed?: TaskWorkspaceServices,
  ) {
    this.limits = new HostLimits(store, now);
    this.budgets = new HostTaskBudgets(store, now);
    this.ready = (async () => {
      await store.ready;
      await this.limits.ready;
      await this.budgets.ready;
      await store.db.scope(async () => {
        await store.db.exec(
          "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE INDEX IF NOT EXISTS tasks_project ON tasks(json_extract(value, '$.projectId'));",
        );
        // Database-owned revisions also see recovery edits and another board's
        // writes, without discarding every historical JSON object on every tick.
        await store.db.exec(`
      CREATE TABLE IF NOT EXISTS task_cache_revision (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
      INSERT OR IGNORE INTO task_cache_revision VALUES (1, 0);
      CREATE TRIGGER IF NOT EXISTS task_cache_insert AFTER INSERT ON tasks BEGIN UPDATE task_cache_revision SET version=version+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS task_cache_update AFTER UPDATE ON tasks BEGIN UPDATE task_cache_revision SET version=version+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS task_cache_delete AFTER DELETE ON tasks BEGIN UPDATE task_cache_revision SET version=version+1 WHERE id=1; END;
      CREATE INDEX IF NOT EXISTS tasks_scheduler_status ON tasks(json_extract(value, '$.status'));
      CREATE INDEX IF NOT EXISTS tasks_scheduler_cleanup ON tasks(id)
        WHERE json_extract(value, '$.status')='done' AND json_extract(value, '$.merged')=1
          AND (json_extract(value, '$.worktreeCwd') IS NOT NULL OR json_array_length(value, '$.historyRecovery')>0);
    `);
        // SQLite owns the journal so every writer (including recovery and DELETE)
        // commits the task change and its history together. Do not journal prompts,
        // credentials or session output: planning only needs this compact projection.
        await store.db.exec(`
          CREATE TABLE IF NOT EXISTS task_history_meta (id INTEGER PRIMARY KEY CHECK(id=1), available_from INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS task_history (sequence INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, task_id TEXT NOT NULL, status TEXT NOT NULL, effective_at INTEGER NOT NULL, deleted INTEGER NOT NULL, task TEXT NOT NULL);
          CREATE TRIGGER IF NOT EXISTS task_history_insert AFTER INSERT ON tasks BEGIN
            INSERT INTO task_history(project_id,task_id,status,effective_at,deleted,task) VALUES (
              json_extract(NEW.value,'$.projectId'),NEW.id,json_extract(NEW.value,'$.status'),json_extract(NEW.value,'$.updatedAt'),0,
              json_object('id',NEW.id,'projectId',json_extract(NEW.value,'$.projectId'),'title',json_extract(NEW.value,'$.title'),'status',json_extract(NEW.value,'$.status'),'updatedAt',json_extract(NEW.value,'$.updatedAt'),'goalId',json_extract(NEW.value,'$.goalId')));
          END;
          CREATE TRIGGER IF NOT EXISTS task_history_update AFTER UPDATE ON tasks BEGIN
            INSERT INTO task_history(project_id,task_id,status,effective_at,deleted,task) VALUES (
              json_extract(NEW.value,'$.projectId'),NEW.id,json_extract(NEW.value,'$.status'),json_extract(NEW.value,'$.updatedAt'),0,
              json_object('id',NEW.id,'projectId',json_extract(NEW.value,'$.projectId'),'title',json_extract(NEW.value,'$.title'),'status',json_extract(NEW.value,'$.status'),'updatedAt',json_extract(NEW.value,'$.updatedAt'),'goalId',json_extract(NEW.value,'$.goalId')));
          END;
          CREATE TRIGGER IF NOT EXISTS task_history_transfer BEFORE UPDATE ON tasks
          WHEN json_extract(OLD.value,'$.projectId') IS NOT json_extract(NEW.value,'$.projectId') BEGIN
            INSERT INTO task_history(project_id,task_id,status,effective_at,deleted,task) VALUES (
              json_extract(OLD.value,'$.projectId'),OLD.id,json_extract(OLD.value,'$.status'),json_extract(NEW.value,'$.updatedAt'),1,
              json_object('id',OLD.id,'projectId',json_extract(OLD.value,'$.projectId'),'title',json_extract(OLD.value,'$.title'),'status',json_extract(OLD.value,'$.status'),'updatedAt',json_extract(OLD.value,'$.updatedAt'),'goalId',json_extract(OLD.value,'$.goalId')));
          END;
          CREATE TRIGGER IF NOT EXISTS task_history_delete AFTER DELETE ON tasks BEGIN
            INSERT INTO task_history(project_id,task_id,status,effective_at,deleted,task) VALUES (
              json_extract(OLD.value,'$.projectId'),OLD.id,json_extract(OLD.value,'$.status'),CAST(unixepoch('subsec')*1000 AS INTEGER),1,
              json_object('id',OLD.id,'projectId',json_extract(OLD.value,'$.projectId'),'title',json_extract(OLD.value,'$.title'),'status',json_extract(OLD.value,'$.status'),'updatedAt',json_extract(OLD.value,'$.updatedAt'),'goalId',json_extract(OLD.value,'$.goalId')));
          END;
        `);
        await store.db
          .prepare("INSERT OR IGNORE INTO task_history_meta VALUES (1, ?)")
          .run(this.now());
        await store.db
          .exec(`UPDATE tasks SET value=json_set(json_remove(value, '$.autoMerge', '$.deliveryRequested'),
          '$.deliveryApprovalRequired', json('true'), '$.deliveryState', CASE WHEN json_extract(value, '$.merged')=1 THEN 'merged' ELSE 'awaitingOwner' END)
          WHERE json_extract(value, '$.autoMerge')=1 OR json_extract(value, '$.deliveryRequested')=1;`);
        const legacyRuns = await store.db
          .prepare(`SELECT value FROM tasks WHERE
      (json_extract(value, '$.startedAt') IS NOT NULL OR json_extract(value, '$.sessionId') IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM task_run_budget_ledger ledger WHERE ledger.task_id=tasks.id)`)
          .all();
        await store.db.exec("SAVEPOINT mark_legacy_task_usage");
        try {
          for (const row of legacyRuns) {
            const task = JSON.parse(String(row.value)) as HostTask;
            await this.budgets.markUnknownHistory({ taskId: task.id });
            const parent = await this.budgetParent(task);
            if (parent) await this.budgets.markUnknownHistory({ taskId: parent.id });
            const goalId = task.goalId ?? parent?.goalId;
            if (goalId) await this.budgets.markUnknownHistory({ goalId });
          }
          await store.db.exec("RELEASE mark_legacy_task_usage");
        } catch (error) {
          await store.db.exec("ROLLBACK TO mark_legacy_task_usage; RELEASE mark_legacy_task_usage");
          throw error;
        }
        this.limits.track(async () =>
          Array.from(
            (this.schedulerTasks ?? (await this.schedulerSnapshot(false))).values(),
          ).flatMap((task) =>
            task.status === "running"
              ? [task.startedAt ?? task.createdAt]
              : task.status === "verifying" && task.reviewer
                ? [task.reviewer.startedAt]
                : [],
          ),
        );
      });
    })();
  }
  start(): void {
    if (this.closing || this.timer) return;
    this.store.db.outsideScope(() => {
      const kick = () =>
        void this.ready
          .then(() => this.tick())
          .catch((error) => console.error("Task scheduling failed:", error));
      kick();
      this.timer = setInterval(kick, TICK_MS);
      this.timer.unref?.();
    });
  }
  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
  /** Close admission synchronously and join work before the store closes. */
  close(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.closing = true;
    this.stop();
    for (const controller of this.jobControllers.values()) controller.abort();
    this.disposal = this.idle();
    return this.disposal;
  }
  async acceptCrewTask(id: string): Promise<HostTask> {
    await this.ready;

    const task = await this.find(id);
    if (
      !task?.crewRunId ||
      task.status !== "review" ||
      task.verification?.review?.verdict !== "pass"
    )
      throw new Error("Independent review must pass before acceptance");
    const fingerprint = await this.workspaceFingerprint(task);
    const latest = await this.find(id);
    if (!latest || latest.updatedAt !== task.updatedAt || latest.status !== "review")
      throw new Error("Task changed while accepting it");
    if (!fingerprint || fingerprint !== task.crewReviewFingerprint) {
      const reason =
        "The working copy changed or its review snapshot cannot be verified. Recheck the independent review before accepting.";
      await this.block(
        {
          ...latest,
          verification: {
            ...latest.verification,
            review: { ...latest.verification!.review!, verdict: "fail", note: reason },
          },
        },
        reason,
        this.now(),
      );
      throw new Error(reason);
    }
    // Only this acceptance path may complete a crew assignment. Ordinary board
    // moves must not bypass the reviewed snapshot or coordinator checks.
    return await this.write({ ...latest, status: "done", updatedAt: this.now() });
  }
  /** Lets a layer on top of the board, such as goals, share its timer. */
  onTick(hook: () => Promise<void> | void): void {
    this.beforeStart = hook;
  }
  /** Resolves once no tick or verification is in progress. */
  async idle(): Promise<void> {
    await this.ready;
    const failures: unknown[] = [];
    while (this.ticking || this.jobs.size) {
      const results = await Promise.allSettled([
        ...(this.ticking ? [this.ticking] : []),
        ...this.jobs.values(),
      ]);
      for (const result of results) if (result.status === "rejected") failures.push(result.reason);
    }
    if (failures.length) throw new AggregateError(failures, "Task work failed while draining.");
  }
  /** Boards reopened over the same store must invalidate each other's caches. */
  private async revisionCounter(): Promise<number> {
    return Number(
      (await this.store.db.prepare("SELECT version FROM task_cache_revision WHERE id=1").get())!
        .version,
    );
  }
  onChange?: () => void;
  private etagCache?: {
    revision: number;
    etag: string;
  };
  private listCache?: {
    revision: number;
    byId: Map<string, HostTask>;
    tasks: HostTask[];
  };
  private projectListCache = new Map<
    string,
    {
      revision: number;
      tasks: HostTask[];
    }
  >();
  /** Live task state for one scheduler pass, maintained by write/delete. */
  private schedulerTasks?: Map<string, HostTask>;
  private pointIndex?: {
    revision: number;
    entries: Map<
      string,
      {
        value?: HostTask;
        bytes: number;
      }
    >;
    bytes: number;
  };
  async revision(): Promise<number> {
    await this.ready;

    return await this.store.db.scope(async () => {
      return await this.revisionCounter();
    });
  }
  /**
   * Digest of what a remote client shows for the board. Recomputed only after
   * a task changed, so polling it does not parse every stored task.
   */
  async changeEtag(): Promise<string> {
    await this.ready;

    return await this.store.db.scope(async () => {
      if (this.etagCache?.revision === (await this.revisionCounter())) return this.etagCache.etag;
      const summaries = (await this.list()).map((task) => ({
        id: task.id,
        status: task.status,
        updatedAt: task.updatedAt,
        sessionId: task.sessionId,
        runId: task.runId,
        usageStamp: task.budgetUsage?.measuredAt,
        evaluation: task.evaluation,
        error: typeof task.error === "string" ? task.error.slice(0, 512) : undefined,
      }));
      const etag = createHash("sha256").update(JSON.stringify(summaries)).digest("base64url");
      // list() may itself backfill review notes, which bumps the revision.
      if (!this.store.transactionActive)
        this.etagCache = { revision: await this.revisionCounter(), etag };
      return etag;
    });
  }
  /** Oldest first. */
  async snapshotWithCursor(): Promise<{
    tasks: SprintTaskSnapshot[];
    cursor: number;
    historyAvailableFrom: number;
  }> {
    await this.ready;
    return this.store.transaction(async () => {
      const rows = await this.store.db
        .prepare(
          "SELECT id, json_extract(value,'$.projectId') AS projectId, json_extract(value,'$.title') AS title, json_extract(value,'$.status') AS status, json_extract(value,'$.updatedAt') AS updatedAt, json_extract(value,'$.goalId') AS goalId FROM tasks ORDER BY id",
        )
        .all();
      const watermark = await this.store.db
        .prepare("SELECT coalesce(max(sequence),0) AS cursor FROM task_history")
        .get();
      const meta = await this.store.db
        .prepare("SELECT available_from FROM task_history_meta WHERE id=1")
        .get();
      return {
        tasks: rows.map(({ goalId, ...task }) => ({
          ...task,
          ...(typeof goalId === "string" ? { goalId } : {}),
        })) as SprintTaskSnapshot[],
        cursor: Number(watermark!.cursor),
        historyAvailableFrom: Number(meta!.available_from),
      };
    });
  }
  async events(
    after: number,
    limit = 500,
  ): Promise<{
    events: SprintSourceEvent[];
    cursor: number;
    hasMore: boolean;
    historyAvailableFrom: number;
  }> {
    await this.ready;
    if (!Number.isSafeInteger(after) || after < 0) throw new Error("Invalid task history cursor.");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new Error("Task history page size must be between 1 and 1000.");
    return this.store.transaction(async () => {
      const watermark = await this.store.db
        .prepare("SELECT coalesce(max(sequence),0) AS cursor FROM task_history")
        .get();
      if (after > Number(watermark!.cursor))
        throw new Error(
          "Task history cursor is ahead of this source. Reconnect the original environment.",
        );
      const rows = await this.store.db
        .prepare("SELECT * FROM task_history WHERE sequence>? ORDER BY sequence LIMIT ?")
        .all(after, limit + 1);
      const events: SprintSourceEvent[] = rows.slice(0, limit).map((row) => ({
        sequence: Number(row.sequence),
        projectId: String(row.project_id),
        taskId: String(row.task_id),
        status: row.status,
        effectiveAt: Number(row.effective_at),
        deleted: row.deleted === 1,
        task: (() => {
          const task = JSON.parse(String(row.task));
          if (task.goalId === null) delete task.goalId;
          return task as SprintTaskSnapshot;
        })(),
      }));
      const meta = await this.store.db
        .prepare("SELECT available_from FROM task_history_meta WHERE id=1")
        .get();
      return {
        events,
        cursor: events.at(-1)?.sequence ?? after,
        hasMore: rows.length > limit,
        historyAvailableFrom: Number(meta!.available_from),
      };
    });
  }
  async list(projectId?: string): Promise<HostTask[]> {
    await this.ready;

    return await this.store.db.scope(async () => {
      if (projectId !== undefined) {
        const cached = this.projectListCache.get(projectId);
        if (cached?.revision === (await this.revisionCounter())) return cached.tasks.slice();
        const tasks = (
          await mapAsync(
            await this.store.db
              .prepare("SELECT value FROM tasks WHERE json_extract(value, '$.projectId')=?")
              .all(projectId),
            async (row) => await this.withReviewNotes(JSON.parse(String(row.value)) as HostTask),
          )
        ).sort((a, b) => a.createdAt - b.createdAt);
        if (this.projectListCache.size >= 32) this.projectListCache.clear();
        if (!this.store.transactionActive)
          this.projectListCache.set(projectId, { revision: await this.revisionCounter(), tasks });
        return tasks.slice();
      }
      if (this.listCache?.revision === (await this.revisionCounter()))
        return this.listCache.tasks.slice();
      const tasks = (
        await mapAsync(
          (await this.store.db.prepare("SELECT value FROM tasks").all()).map(
            (row) => JSON.parse(String(row.value)) as HostTask,
          ),
          async (task) => await this.withReviewNotes(task),
        )
      ).sort((a, b) => a.createdAt - b.createdAt);
      const byId = new Map(tasks.map((task) => [task.id, task]));
      // Review-note backfills above can themselves bump the revision.
      if (!this.store.transactionActive)
        this.listCache = { revision: await this.revisionCounter(), byId, tasks };
      return tasks.slice();
    });
  }
  /** Shared read-only index; task writes invalidate the revision cache. */
  async taskIndex(ids?: readonly string[]): Promise<ReadonlyMap<string, HostTask>> {
    await this.ready;

    return await this.store.db.scope(async () => {
      if (ids) {
        const revision = await this.revisionCounter();
        if (!this.store.transactionActive && this.pointIndex?.revision !== revision)
          this.pointIndex = { revision, entries: new Map(), bytes: 0 };
        const cache = this.store.transactionActive
          ? {
              revision,
              entries: new Map<
                string,
                {
                  value?: HostTask;
                  bytes: number;
                }
              >(),
              bytes: 0,
            }
          : this.pointIndex!;
        const result = new Map<string, HostTask>();
        for (const id of ids) {
          let value = this.schedulerTasks?.get(id);
          if (!value) {
            let cached = cache.entries.get(id);
            if (!cached) {
              const row = await this.store.db.prepare("SELECT value FROM tasks WHERE id=?").get(id);
              const raw = row ? String(row.value) : undefined;
              value =
                raw === undefined
                  ? undefined
                  : await this.withReviewNotes(JSON.parse(raw) as HostTask);
              // A legacy review-note backfill can itself write a task.
              const current = await this.revisionCounter();
              if (cache.revision !== current) {
                cache.entries.clear();
                cache.bytes = 0;
                cache.revision = current;
              }
              cached = { value, bytes: raw === undefined ? 64 : Buffer.byteLength(raw) + 64 };
              cache.entries.set(id, cached);
              cache.bytes += cached.bytes;
              while (cache.entries.size > 256 || cache.bytes > 16 * 1024 * 1024) {
                const first = cache.entries.keys().next().value;
                if (first === undefined) break;
                cache.bytes -= cache.entries.get(first)!.bytes;
                cache.entries.delete(first);
              }
            }
            value = cached.value;
          }
          if (value) result.set(id, value);
        }
        return result;
      }
      if (this.schedulerTasks) return this.schedulerTasks;
      if (this.store.transactionActive)
        return new Map((await this.list()).map((task) => [task.id, task]));
      if (this.listCache?.revision !== (await this.revisionCounter())) await this.list();
      return this.listCache!.byId;
    });
  }
  /** Keep the live pass consistent with an atomic task/goal batch on rollback. */
  async transaction<T>(operation: () => T | Promise<T>): Promise<T> {
    await this.ready;

    const pass = this.schedulerTasks;
    const before = pass ? new Map(pass) : undefined;
    try {
      return await this.store.transaction(operation);
    } catch (error) {
      this.listCache = undefined;
      this.projectListCache.clear();
      if (pass && before) {
        pass.clear();
        for (const [id, task] of before) pass.set(id, task);
      }
      throw error;
    }
  }
  /** Re-evaluate existing work and acceptance blockers without a worker rerun. */
  async recheckReview(id: string): Promise<HostTask> {
    await this.ready;

    const task = await this.find(id);
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
    const next = await this.write({
      ...task,
      status: "verifying",
      reviewOnly: true,
      awaitingOwnerRestart: undefined,
      repairStop: undefined,
      error: undefined,
      needsInput: undefined,
      reviewer: undefined,
      verification: undefined,
      completedAt: undefined,
      updatedAt: this.now(),
    });
    await this.verify(next);
    return next;
  }
  /** Adds a task to the queue, or as a to-do item when asked to, or edits one
   * that is not running or finished. An edit keeps the task's status. */
  async save(raw: unknown): Promise<HostTask> {
    await this.ready;
    return this.store.db.scope(async () => {
      await this.ready;

      const input = parseHostTask(raw);
      if (input.crewDefinitionId) {
        if (!this.crewRunner) throw new Error("Update this host to run tasks with a crew.");
        await this.crewRunner.validate(input);
      }
      const graph = this.schedulerTasks
        ? new Map(this.schedulerTasks)
        : new Map((await this.list()).map((task) => [task.id, task]));
      graph.set(input.id, input as HostTask);
      await this.hydrateDependencies(graph, [input as HostTask]);
      const cycle = this.dependencyCycle(input.id, graph);
      if (cycle)
        throw new Error(
          `Task dependency cycle: ${cycle.join(" -> ")}. Remove a dependency to continue.`,
        );
      const requested = (
        raw as {
          status?: unknown;
        }
      ).status;
      if (requested !== undefined && !isNewTaskStatus(requested))
        throw new Error("A new task starts as to do or queued.");
      const now = this.now();
      const previous = await this.find(input.id);
      assertExpectedConfiguration(raw, previous, parseHostTask);
      if (input.crewDefinitionId && previous && (previous.crewRunId || hasUnmergedBranch(previous)))
        throw new Error(
          "Create a separate crew task; this task already belongs to a crew or has retained branch work.",
        );
      if (!previous) {
        const status = requested ?? "queued";
        if (status === "queued" && !input.prompt.trim()) throw new Error(EMPTY_PROMPT_ERROR);
        await this.store.project(input.projectId);
        return await this.write({
          ...input,
          status,
          createdAt: now,
          updatedAt: now,
          reviewNotes: [],
        });
      }
      if (previous.status === "running" || previous.status === "verifying")
        throw new Error("Stop this task before editing it.");
      if (!canEditTask(previous.status))
        throw new Error("Only a to-do, queued or blocked task can be edited.");
      if (previous.status === "queued" && !input.prompt.trim()) throw new Error(EMPTY_PROMPT_ERROR);
      await this.store.project(previous.projectId);
      const {
        verifyCommand,
        autoMerge,
        continueUntilDone,
        crewDefinitionId: _crewDefinitionId,
        workspace: _workspace,
        ...kept
      } = previous;
      return await this.write({
        ...kept,
        ...input,
        projectId: previous.projectId,
        // Work already on a branch stays there.
        ...(hasUnmergedBranch(previous) ? { isolate: true } : {}),
        ...(previous.sessionId || previous.branch ? { workspace: previous.workspace } : {}),
        ...(previous.status === "blocked" &&
        Boolean(input.continueUntilDone) !== Boolean(previous.continueUntilDone)
          ? { awaitingOwnerRestart: true }
          : {}),
        ...(input.continueUntilDone &&
        !previous.continueUntilDone &&
        previous.repairStop?.reason === "limit"
          ? { repairStop: undefined, needsInput: undefined, awaitingOwnerRestart: true }
          : {}),
        ...(input.prompt.trim().replace(/\s+/g, " ") !== previous.prompt.trim().replace(/\s+/g, " ")
          ? {
              reviewFailureCount: 0,
              blockedTakeover: undefined,
              awaitingOwnerRestart: true,
              // Zero records owner input; undefined lets legacy goal recovery run.
              repairAttempts: 0,
              repairStop: undefined,
              repairNote: undefined,
              checkFailureFingerprint: undefined,
              needsInput: undefined,
            }
          : {}),
        updatedAt: now,
      });
    });
  }
  /** Called by the goal's transaction; preserves task identity, checks and recovery gates. */
  async updateGoalSettings(
    goalId: string,
    taskIds: readonly string[],
    settings: {
      autoMerge?: boolean;
      continueUntilDone?: boolean;
      maxRunMinutes?: number;
    },
  ): Promise<void> {
    await this.ready;
    return this.store.db.scope(async () => {
      await this.ready;

      if (!Object.keys(settings).length) return;
      for (const id of taskIds) {
        const task = await this.find(id);
        if (!task || task.goalId !== goalId || task.status === "done") continue;
        if (this.delivering.has(id))
          throw new Error("A goal task is being merged. Try again later.");
        const active = task.status === "running" || task.status === "verifying";
        const changedContinue =
          settings.continueUntilDone !== undefined &&
          Boolean(task.continueUntilDone) !== settings.continueUntilDone;
        await this.write({
          ...task,
          ...(settings.autoMerge !== undefined
            ? { autoMerge: settings.autoMerge && task.isolate !== false ? true : undefined }
            : {}),
          ...(settings.continueUntilDone !== undefined
            ? { continueUntilDone: settings.continueUntilDone || undefined }
            : {}),
          // Do not shorten a run that is already in progress.
          ...(!active && settings.maxRunMinutes !== undefined
            ? { maxRunMinutes: settings.maxRunMinutes }
            : {}),
          ...(task.status === "blocked" && changedContinue ? { awaitingOwnerRestart: true } : {}),
          ...(settings.continueUntilDone &&
          !task.continueUntilDone &&
          task.repairStop?.reason === "limit"
            ? { repairStop: undefined, needsInput: undefined, awaitingOwnerRestart: true }
            : {}),
          updatedAt: this.now(),
        });
      }
    });
  }
  /** Moving a reviewed task to done merges its branch; that can fail, and the
   * task then stays in review. */
  async move(id: string, to: unknown): Promise<HostTask> {
    await this.ready;

    if (this.delivering.has(id)) throw new Error("This task is being merged.");
    const task = await this.find(id);
    if (!task) throw new Error("Task not found.");
    if (!isTaskStatus(to)) throw new Error("Invalid task status");
    if (task.artifactDeliveryPending && ["todo", "queued", "done"].includes(to))
      throw new Error(
        "Finish the recorded artifact delivery before restarting or completing this task.",
      );
    if ((task.crewRunId || task.crewDefinitionId) && to === "done")
      throw new Error(
        "Accept this assignment through its crew coordinator after independent review.",
      );
    if (!canMoveTask(task.status, to))
      throw new Error(`A ${task.status} task cannot be moved to ${to}.`);
    const now = this.now();
    if ((to === "queued" || to === "todo") && this.jobs.has(id))
      throw new Error("The previous verification is still stopping. Retry after it finishes.");
    if (to === "queued" && !task.prompt.trim()) throw new Error(EMPTY_PROMPT_ERROR);
    if (to === "queued" && canTakeOverBlockedTask(task)) return await this.queueTakeover(task, now);
    if (to === "queued" && taskRequiresInstructions(task)) throw new Error(TASK_INPUT_REQUIRED);
    if (to === "todo" && task.status === "queued") {
      // Only a task nothing has run for can be pulled back.
      if (task.sessionId || task.startedAt || hasUnmergedBranch(task))
        throw new Error("This task already started, so it cannot go back to To do.");
      return await this.write({ ...task, status: "todo", updatedAt: now });
    }
    if (to === "done" && task.status === "todo") {
      if (hasUnmergedBranch(task))
        throw new Error(
          `This task’s earlier work is on ${task.branch}. Run it again to review and merge that, or delete it to discard.`,
        );
      // The owner did it by hand: nothing ran, so there is nothing to merge.
      return await this.write({
        ...task,
        status: "done",
        retryFeedback: undefined,
        completedAt: now,
        updatedAt: now,
      });
    }
    if (to === "queued" || to === "todo") {
      // A task that runs again starts over in a fresh session. Unmerged work
      // stays on its branch, and the next run continues there. A task put
      // back to to-do is cleared the same way.
      const {
        sessionId,
        runId,
        error,
        needsInput,
        startedAt,
        completedAt,
        verification,
        reviewOnly,
        awaitingOwnerRestart,
        reviewer,
        crewExecutionId: _crewExecutionId,
        diffStat,
        mergeError,
        mergeRetry,
        autoMerged,
        mergedAt,
        deliveredCommit: _deliveredCommit,
        ...rest
      } = task;
      if (!task.merged)
        return await this.write({
          ...rest,
          ...(rest.mergeRepair ? { mergeRepair: { ...rest.mergeRepair, attempts: 0 } } : {}),
          retryFeedback: await this.retryFeedback(task),
          repairAttempts: task.repairAttempts,
          repairNote: task.repairNote,
          repairStop: task.repairStop,
          status: to,
          updatedAt: now,
        });
      const {
        branch,
        worktreeCwd,
        workspaceId: _workspaceId,
        workspaceGenerationId: _workspaceGenerationId,
        workspaceActivityId: _workspaceActivityId,
        deliveryState: _deliveryState,
        deliveryOperationId: _deliveryOperationId,
        deliveryArtifacts: _deliveryArtifacts,
        artifactDeliveryPending: _artifactDeliveryPending,
        artifactDeliveryActivityId: _artifactDeliveryActivityId,
        finalization: _finalization,
        baseBranch,
        baseCommit,
        deliveryCwd: _deliveryCwd,
        merged,
        retryFeedback,
        repairAttempts,
        repairNote,
        repairStop,
        attemptHistory,
        mergeRepair,
        cleanupError,
        cleanupRetryAfter,
        dependencyArtifactsPrepared,
        artifactPaths,
        artifactHashes,
        deliveryRequested,
        ...fresh
      } = rest;
      return await this.write({ ...fresh, status: to, updatedAt: now });
    }
    if (to === "blocked") {
      if (task.crewDefinitionId && this.crewRunner) {
        await this.crewRunner.stop(task);
        return await this.block({ ...task, deliveryRequested: undefined }, STOPPED_BY_USER, now);
      }
      if (task.status === "verifying") {
        // Keep the job registered until its shell and descendants have exited.
        this.jobControllers.get(id)?.abort();
        if (
          task.reviewer &&
          (await sessionRunState(this.store, task.reviewer, 0, now)).state === "running"
        ) {
          await cancelSessionRun(this.engine, task.reviewer);
          await this.limits.record(task.reviewer.startedAt, now);
        }
        return await this.block({ ...task, deliveryRequested: undefined }, STOPPED_BY_USER, now);
      }
      const run = { ...task, startedAt: task.startedAt ?? task.createdAt };
      if ((await sessionRunState(this.store, run, 0, now)).state === "running") {
        await cancelSessionRun(this.engine, run);
        await this.limits.record(run.startedAt, now);
      }
      return await this.block({ ...task, deliveryRequested: undefined }, STOPPED_BY_USER, now);
    }
    if (to === "done" && hasUnmergedBranch(task)) {
      throw new Error(
        "Task completion does not authorize delivery. Review changes and approve the exact delivery plan.",
      );
    }
    return await this.write({
      ...task,
      status: to,
      updatedAt: now,
    });
  }
  /** Owner start requests retain scheduler limits and dependency gates. */
  async startTask(id: string): Promise<HostTask> {
    await this.ready;

    let task = await this.get(id);
    if (!task) throw new Error("Task not found.");
    if (task.goalId) {
      if ((await this.owningGoal(task.goalId))?.status === "cancelled")
        throw new Error(
          "This goal was cancelled. Create a new task to continue its retained work.",
        );
    }
    if (task.status !== "queued") task = await this.move(id, "queued");
    const ordered = (await this.list()).filter(
      (item) => item.status === "queued" && item.id !== id,
    );
    await this.transaction(async () => {
      await this.write({ ...task, position: 0, updatedAt: this.now() });
      await forEachAsync(
        ordered,
        async (item, index) =>
          await this.write({ ...item, position: index + 1, updatedAt: this.now() }),
      );
    });
    await this.tick();
    return (await this.get(id))!;
  }
  async reorder(ids: unknown): Promise<HostTask[]> {
    await this.ready;
    return this.store.db.scope(async () => {
      await this.ready;

      if (
        !Array.isArray(ids) ||
        ids.length > 1000 ||
        ids.some((id) => typeof id !== "string") ||
        new Set(ids).size !== ids.length
      )
        throw new Error("Invalid task order");
      const tasks = await mapAsync(ids, async (id) => await this.get(id));
      if (tasks.some((task) => !task)) throw new Error("Task not found.");
      if (tasks.some((task) => !["todo", "queued"].includes(task!.status)))
        throw new Error("Only queued or to-do tasks can be reordered");
      if (tasks.some((task) => task!.status !== tasks[0]!.status))
        throw new Error("Reorder tasks within one status");
      return await this.transaction(
        async () =>
          await mapAsync(
            tasks,
            async (task, position) =>
              await this.write({ ...task!, position, updatedAt: this.now() }),
          ),
      );
    });
  }
  /** Retarget a reviewed result without launching another worker. */
  async retarget(
    id: string,
    raw: unknown,
    autoMerge?: unknown,
    owner?: WorkspaceOwnerAuthorization,
  ): Promise<HostTask> {
    await this.ready;

    const task = await this.get(id);
    const expected = await this.taskValue(id);
    if (!task || task.status !== "review" || !hasUnmergedBranch(task))
      throw new Error("Only a reviewed branch can change its delivery target.");
    if (this.delivering.has(id)) throw new Error("Wait for the current delivery to finish.");
    if (autoMerge !== undefined && typeof autoMerge !== "boolean")
      throw new Error("Invalid merge option");
    if (raw === undefined && autoMerge !== undefined)
      return await this.write({ ...task, autoMerge, mergeRetry: undefined, updatedAt: this.now() });
    const workspace = parseTaskWorkspace(raw);
    const project = await this.store.project(task.projectId);
    const target = await taskWorkspace(
      project.cwd,
      workspace ?? {
        checkoutCwd: task.deliveryCwd,
        baseBranch: task.baseBranch,
      },
    );
    if (workspace?.branchName || target.cwd === task.worktreeCwd)
      throw new Error("Choose a delivery worktree separate from the task branch");
    if ((await this.get(id))?.updatedAt !== task.updatedAt)
      throw new Error("Task changed; refresh before choosing a target.");
    const selected = { checkoutCwd: target.cwd, baseBranch: target.branch };
    if (task.workspaceId) {
      if (!this.managed?.retargetWorkspace || !owner)
        throw new Error(
          "Update this host to retarget a managed workspace with authenticated owner approval.",
        );
      const registered = await this.managed.registry.get({ workspaceId: task.workspaceId });
      if (!registered) throw new Error("Managed task workspace is unavailable.");
      const changed = await this.managed.retargetWorkspace(
        {
          workspaceId: registered.id,
          expectedRevision: registered.revision,
          idempotencyKey: `task-retarget:${task.id}:${registered.revision}:${target.branch}`,
          targetBranchRef: `refs/heads/${target.branch}`,
          targetDirectory: target.cwd,
        },
        owner,
      );
      if (
        changed.id !== registered.id ||
        changed.branchRef !== registered.branchRef ||
        changed.targetBranchRef !== `refs/heads/${target.branch}` ||
        changed.revision <= registered.revision
      )
        throw new Error("The registry did not record the selected delivery target.");
    }
    return await this.transaction(async () => {
      if (!(await this.unchangedTask(id, expected)))
        throw new Error("Task changed; refresh the recorded workspace target.");
      // Pending dependent work must inherit the same integration target.
      if (task.goalId) {
        for (const pending of await this.list())
          if (
            pending.goalId === task.goalId &&
            pending.projectId === task.projectId &&
            ["todo", "queued"].includes(pending.status) &&
            !pending.startedAt &&
            !pending.branch
          )
            await this.write({ ...pending, workspace: selected, updatedAt: this.now() });
        const goal = await this.owningGoal(task.goalId);
        if (goal) {
          await this.store.db.prepare("UPDATE goals SET value=? WHERE id=?").run(
            JSON.stringify({
              ...goal,
              workspaces: { ...goal.workspaces, [task.projectId]: selected },
              updatedAt: this.now(),
            }),
            task.goalId,
          );
        }
      }
      return await this.write({
        ...task,
        deliveryCwd: target.cwd,
        baseBranch: target.branch,
        workspace: { ...task.workspace, ...selected },
        mergeError: undefined,
        mergeRetry: undefined,
        ...(autoMerge !== undefined
          ? {
              autoMerge: autoMerge as boolean,
              ...(!autoMerge ? { deliveryRequested: undefined } : {}),
            }
          : {}),
        updatedAt: this.now(),
      });
    });
  }
  /** Discard explicitly closes the managed workspace; branch and recovery refs remain. */
  async delete(id: string, discard = false, expectedUpdatedAt?: number): Promise<void> {
    await this.ready;

    const task = await this.find(id);
    if (task?.artifactDeliveryPending || task?.artifactDeliveryActivityId)
      throw new Error(
        "Reconcile the recorded artifact delivery before deleting this task; its source is retained.",
      );
    if (
      expectedUpdatedAt !== undefined &&
      (!Number.isSafeInteger(expectedUpdatedAt) || expectedUpdatedAt < 0)
    )
      throw new Error("Invalid task revision.");
    if (task && expectedUpdatedAt !== undefined && task.updatedAt !== expectedUpdatedAt)
      throw new Error("This task changed. Refresh it before deleting.");
    if (
      task &&
      task.status !== "done" &&
      (await this.list()).some(
        (other) => other.id !== id && other.status !== "done" && other.dependsOn?.includes(id),
      )
    )
      throw new Error("Other unfinished tasks depend on this task. Remove those tasks first.");
    if (this.jobs.has(id))
      throw new Error("The previous verification is still stopping. Retry after it finishes.");
    if (task?.status === "running" || task?.status === "verifying")
      throw new Error("Stop this task before deleting it.");
    if (task && hasUnmergedBranch(task)) {
      if (this.delivering.has(id)) throw new Error("This task is being merged.");
      if (!discard)
        throw new Error(
          `This task’s work is on ${task.branch} and was never merged. Deleting it discards that branch.`,
        );
      await this.discard(task);
    }
    await this.store.db.prepare("DELETE FROM tasks WHERE id=?").run(id);
    this.store.afterCommit(() => this.onChange?.());
    this.listCache = undefined;
    this.projectListCache.clear();
    this.schedulerTasks?.delete(id);
  }
  /** Transfer only unstarted independent work; never move branches or execution identity. */
  async validateTransfer(
    id: string,
    targetProjectId: string,
    expectedUpdatedAt: number,
  ): Promise<HostTask> {
    await this.ready;

    const task = await this.get(id);
    if (!task || task.updatedAt !== expectedUpdatedAt)
      throw new Error("Task changed; read it before transferring.");
    if (task.projectId === targetProjectId) throw new Error("Choose a different project.");
    await this.store.project(targetProjectId);
    if (
      task.status !== "todo" ||
      task.startedAt ||
      task.sessionId ||
      task.branch ||
      task.worktreeCwd ||
      task.goalId ||
      task.stewardId ||
      task.crewDefinitionId ||
      task.crewRunId ||
      task.workspace ||
      task.deliveryCwd ||
      task.reviewer ||
      task.dependsOn?.length ||
      (await this.list()).some((other) => other.dependsOn?.includes(id))
    )
      throw new Error("Only an unstarted independent to-do task can move between projects.");
    if (this.jobs.has(id)) throw new Error("Wait for task verification to stop.");
    return task;
  }
  async transfer(
    id: string,
    targetProjectId: string,
    expectedUpdatedAt: number,
  ): Promise<HostTask> {
    await this.ready;

    return await this.transaction(async () => {
      const task = await this.validateTransfer(id, targetProjectId, expectedUpdatedAt);
      return await this.write({ ...task, projectId: targetProjectId, updatedAt: this.now() });
    });
  }
  async get(id: string): Promise<HostTask | undefined> {
    await this.ready;

    return await this.store.db.scope(async () => {
      return await this.find(id);
    });
  }
  /** Acknowledge precisely the notes shown by a desktop, preserving newer notes. */
  async readNotes(id: string, rawIds: unknown): Promise<HostTask> {
    await this.ready;
    return this.store.db.scope(async () => {
      await this.ready;

      const task = await this.find(id);
      if (!task) throw new Error("Task not found.");
      if (
        !Array.isArray(rawIds) ||
        rawIds.length > 10000 ||
        rawIds.some((id) => typeof id !== "string")
      )
        throw new Error("Invalid review note IDs.");
      const ids = new Set(rawIds as string[]);
      if ([...ids].some((id) => !task.reviewNotes?.some((note) => note.id === id)))
        throw new Error("Review note not found.");
      if (!task.reviewNotes?.some((note) => ids.has(note.id) && note.readAt === undefined))
        return task;
      const now = this.now();
      return await this.write({
        ...task,
        reviewNotes: task.reviewNotes?.map((note) =>
          ids.has(note.id) && note.readAt === undefined ? { ...note, readAt: now } : note,
        ),
        updatedAt: now,
      });
    });
  }
  /** Note status is bookkeeping, never task completion or merge approval. */
  async resolveNote(id: string, noteId: unknown, resolved: unknown): Promise<HostTask> {
    await this.ready;
    return this.store.db.scope(async () => {
      await this.ready;

      const task = await this.find(id);
      if (!task) throw new Error("Task not found.");
      if (typeof resolved !== "boolean") throw new Error("Invalid review note status.");
      if (typeof noteId !== "string" || !task.reviewNotes?.some((note) => note.id === noteId))
        throw new Error("Review note not found.");
      if (
        (task.reviewNotes.find((note) => note.id === noteId)!.resolvedAt !== undefined) ===
        resolved
      )
        return task;
      const now = this.now();
      return await this.write({
        ...task,
        reviewNotes: task.reviewNotes.map((note) =>
          note.id === noteId
            ? { ...note, resolvedAt: resolved ? now : undefined, updatedAt: now }
            : note,
        ),
        updatedAt: now,
      });
    });
  }
  /** Recover old review failures only when their owning goal is still active.
   * Re-read the reviewer evidence; never revive an owner stop or failed runtime. */
  async recoverGoalReview(id: string, goalId: string): Promise<HostTask | undefined> {
    await this.ready;

    const task = await this.find(id);
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
      const session = await this.store.session(review.sessionId);
      const verdict = reviewerVerdict(session.session.blocks);
      const last = session.session.blocks.at(-1);
      if (
        session.status !== "idle" ||
        last?.role === "system" ||
        verdict.verdict !== "fail" ||
        verdict.note !== review.note
      )
        return task;
      return await this.repairOrBlock(task, task.error, this.now());
    } catch {
      return task;
    }
  }
  /** Stops a running or verifying task as Stop does, and blocks a queued one
   * with `reason`. Anything else is left as it is. */
  async cancel(id: string, reason: string): Promise<void> {
    await this.ready;

    const task = await this.find(id);
    // Active verification must reach Stop so its controller is aborted. The job
    // stays registered during process-tree cleanup, retaining retry/delete gates.
    if (this.jobs.has(id) && task?.status !== "running" && task?.status !== "verifying")
      throw new Error("The previous verification is still stopping. Retry after it finishes.");
    if (task?.status === "running" || task?.status === "verifying") await this.move(id, "blocked");
    else if (
      task?.status === "queued" ||
      (task?.status === "review" && (task.autoMerge || task.deliveryRequested))
    )
      await this.block({ ...task, deliveryRequested: undefined }, reason, this.now());
  }
  /** Settles running and verifying tasks, stops those past their time limit,
   * then starts queued ones while there is room. A tick already in progress
   * is not joined by a second one. */
  tick(): Promise<void> {
    if (this.closing) return Promise.resolve();
    this.ticking ??= this.work().finally(() => {
      this.schedulerTasks = undefined;
      this.ticking = undefined;
    });
    return this.ticking;
  }
  private async work(): Promise<void> {
    const now = this.now();
    // Refresh once per tick, including persisted recovery edits made outside
    // this board. All later reads in this pass use the live index below.
    const maintenanceRows = new Map<string, string>();
    const byId = await this.schedulerSnapshot(true, maintenanceRows);
    const initial = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
    this.schedulerTasks = byId;
    const maintenance: Promise<void>[] = [];
    const maintenanceLanes = new Map<string, Promise<void>>();
    let maintenanceAdmission: Promise<unknown> = Promise.resolve();
    let maintenanceActive = 0;
    const maintenanceWaiters: (() => void)[] = [];
    const maintain = (task: HostTask, work: (fresh: HostTask) => Promise<unknown>) => {
      const expected = maintenanceRows.get(task.id);
      // Resolve aliases in enqueue order without holding admission for the work.
      const admitted = maintenanceAdmission.then(async () => {
        const key = await hostGitRepositoryKey((await this.store.project(task.projectId)).cwd);
        const operation = (maintenanceLanes.get(key) ?? Promise.resolve()).then(async () => {
          if (maintenanceActive >= 4)
            await new Promise<void>((resolve) => maintenanceWaiters.push(resolve));
          else maintenanceActive++;
          try {
            // A goal hook, owner edit or another board may have stopped/replaced
            // this task while its lane was queued, even at the same timestamp.
            const fresh = await this.unchangedTask(task.id, expected);
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
        const dependency = await this.scheduledTask(id);
        return (
          dependency !== undefined &&
          (dependency.status !== "done" || hasUnmergedBranch(dependency))
        );
      });
    // A newly failed task remains visibly blocked until the next scheduler tick.
    const takeoverCandidates = new Set(
      initial.filter(canTakeOverBlockedTask).map((task) => task.id),
    );
    for (let task of initial) {
      try {
        const activeStatus = task.status === "running" || task.status === "verifying";
        const parent = activeStatus ? await this.budgetParent(task) : undefined;
        const goalId = task.goalId ?? parent?.goalId;
        const configuredBudget =
          task.budget ??
          parent?.budget ??
          (activeStatus && goalId ? (await this.owningGoal(goalId))?.budget : undefined);
        if (activeStatus && configuredBudget && task.budgetUsage?.measuredAt !== now) {
          const fresh = await this.unchangedTask(task.id, maintenanceRows.get(task.id));
          if (!fresh) continue;
          // This scheduler-owned refresh advances the exact expected row. Owner
          // edits made by onChange still invalidate the queued operation.
          task = await this.write(fresh, maintenanceRows);
        }
        const budgetReason = activeStatus ? await this.budgetReason(task) : undefined;
        const budgetRun = task.status === "verifying" && task.reviewer ? task.reviewer : task;
        const budgetRunActive =
          (task.status === "running" || task.status === "verifying") &&
          (
            await sessionRunState(
              this.store,
              { ...budgetRun, startedAt: budgetRun.startedAt ?? task.createdAt },
              0,
              now,
            )
          ).state === "running";
        if (budgetReason && budgetRunActive) {
          if (task.crewDefinitionId) await this.crewRunner?.stop(task);
          else
            await cancelSessionRun(
              this.engine,
              task.status === "verifying" && task.reviewer ? task.reviewer : task,
            );
          this.jobControllers.get(task.id)?.abort();
          await this.budgetBlock(task, budgetReason, now);
          continue;
        }
        const cycle = task.status === "queued" ? this.dependencyCycle(task.id, byId) : undefined;
        if (cycle)
          await this.block(
            task,
            `Task dependency cycle: ${cycle.join(" -> ")}. Edit the dependencies before requeuing.`,
            now,
          );
        else if (
          task.status === "blocked" &&
          task.error === HOST_INTERRUPTED &&
          (await this.canResumeAfterHostStop(task))
        )
          await this.requeueInterrupted(task, now);
        else if (task.status === "running" && task.crewDefinitionId)
          maintain(task, async (fresh) => await this.settleCrew(fresh, now));
        else if (task.status === "running") await this.settle(task, now);
        else if (task.status === "verifying")
          maintain(task, async (fresh) => await this.settleVerification(fresh, now));
        else if (
          task.status === "review" &&
          (task.autoMerge || task.deliveryRequested) &&
          hasUnmergedBranch(task)
        )
          maintain(task, async (fresh) => await this.recoverMerge(fresh, now));
        else if (
          task.status === "done" &&
          task.merged &&
          !this.delivering.has(task.id) &&
          (task.worktreeCwd || task.historyRecovery?.some((entry) => entry.worktreeCwd))
        ) {
          this.delivering.add(task.id);
          maintain(task, async (fresh) => await this.cleanupDelivered(fresh, now)).finally(() => {
            this.delivering.delete(task.id);
          });
        }
      } catch (error) {
        console.error("Could not settle a task:", errorMessage(error));
      }
    }
    try {
      if (!this.closing) await this.beforeStart?.();
    } catch (error) {
      console.error("Could not update goals:", errorMessage(error));
    }
    const launchQueued = async () => {
      if (this.closing) return;
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
      const { maxRunningTasks } = await this.limits.settings();
      const launches: Promise<void>[] = [];
      for (const candidate of tasks) {
        if (this.closing) return;
        // An awaited launch may have allowed edits/deletions to later tasks.
        let task = byId.get(candidate.id);
        if (!task || this.jobs.has(task.id)) continue;
        if (
          (task.crewDefinitionId ? teams : active).length +
            (task.crewDefinitionId
              ? 0
              : (await Promise.all(this.externalRunSources.map((source) => source()))).reduce(
                  (sum, value) => sum + value,
                  0,
                )) >=
          maxRunningTasks
        )
          continue;
        if (
          takeoverCandidates.has(task.id) &&
          canTakeOverBlockedTask(task) &&
          (await this.takeoverGoalActive(task))
        ) {
          if ((await this.limits.reached()) || (await hasUnfinishedDependencies(task))) continue;
          task = await this.queueTakeover(task, now);
        }
        if (task.status !== "queued") continue;
        if (this.crewCanStart && !(await this.crewCanStart(task))) continue;
        if (task.goalId) {
          const goal = await this.owningGoal(task.goalId);
          if (goal?.status === "cancelled") continue;
          if (
            goal?.maxRunningTasks &&
            active.filter((item) => item.goalId === task.goalId).length >= goal.maxRunningTasks
          )
            continue;
        }
        if (taskRequiresInstructions(task)) {
          await this.block(task, TASK_INPUT_REQUIRED, now);
          continue;
        }
        // Used-up daily time holds queued work back; running work finishes.
        if (await this.limits.reached()) break;
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
          this.launch(task, now, active)
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
        if (!this.closing) await this.beforeStart?.();
      } catch (error) {
        console.error("Could not update goals:", errorMessage(error));
      }
      await launchQueued();
    }
  }
  private async find(id: string): Promise<HostTask | undefined> {
    const value = await this.taskValue(id);
    return value === undefined
      ? undefined
      : await this.withReviewNotes(JSON.parse(value) as HostTask);
  }
  private async taskValue(id: string): Promise<string | undefined> {
    const row = await this.store.db.prepare("SELECT value FROM tasks WHERE id=?").get(id);
    return row ? String(row.value) : undefined;
  }
  /** Compare the persisted row, including edits that keep updatedAt unchanged. */
  private async unchangedTask(
    id: string,
    expected: string | undefined,
  ): Promise<HostTask | undefined> {
    const value = await this.taskValue(id);
    return expected !== undefined && value === expected
      ? await this.withReviewNotes(JSON.parse(value) as HostTask)
      : undefined;
  }
  /** A task can acquire a new dependency while a tick awaits another worker.
   * Resolve only its required closure, including inactive/completed records. */
  private async hydrateDependencies(
    graph: Map<string, HostTask>,
    roots: Iterable<Pick<HostTask, "id" | "dependsOn">>,
  ): Promise<void> {
    const queue = [...roots];
    const visited = new Set<string>();
    for (let index = 0; index < queue.length; index++) {
      const task = queue[index];
      if (visited.has(task.id)) continue;
      visited.add(task.id);
      for (const id of task.dependsOn ?? []) {
        const dependency = graph.get(id) ?? (await this.find(id));
        if (!dependency) continue;
        graph.set(id, dependency);
        queue.push(dependency);
      }
    }
  }
  private async scheduledTask(id: string): Promise<HostTask | undefined> {
    const known = this.schedulerTasks?.get(id);
    if (known) return known;
    const value = await this.find(id);
    if (value && this.schedulerTasks) {
      this.schedulerTasks.set(id, value);
      await this.hydrateDependencies(this.schedulerTasks, [value]);
    }
    return value;
  }
  /** Only schedulable/recovery work and its dependency closure need full JSON.
   * Owner-facing list() remains a complete history even during an awaited tick. */
  private async schedulerSnapshot(
    dependencies = true,
    persisted?: Map<string, string>,
  ): Promise<Map<string, HostTask>> {
    return await this.store.db.scope(async () => {
      const rows = await this.store.db
        .prepare(`
      SELECT value FROM tasks WHERE json_extract(value, '$.status') IN ('queued','running','verifying','review','blocked')
      UNION ALL SELECT value FROM tasks WHERE json_extract(value, '$.status')='done' AND json_extract(value, '$.merged')=1
        AND (json_extract(value, '$.worktreeCwd') IS NOT NULL OR json_array_length(value, '$.historyRecovery')>0)
    `)
        .all();
      const result = new Map<string, HostTask>();
      const queue = await mapAsync(rows, async (row) => {
        const value = String(row.value);
        const task = await this.withReviewNotes(JSON.parse(value) as HostTask);
        persisted?.set(task.id, value);
        return task;
      });
      for (let index = 0; index < queue.length; index++) {
        const task = queue[index];
        if (result.has(task.id)) continue;
        result.set(task.id, task);
        if (!dependencies) continue;
        for (const id of task.dependsOn ?? []) {
          if (result.has(id)) continue;
          const dependency = await this.find(id);
          if (dependency) queue.push(dependency);
        }
      }
      return result;
    });
  }
  /** Missing forward references are valid; only a closed dependency path blocks. */
  private dependencyCycle(
    id: string,
    graph: ReadonlyMap<string, Pick<HostTask, "dependsOn">>,
  ): string[] | undefined {
    const visited = new Set<string>();
    const path: string[] = [];
    const visit = (current: string): string[] | undefined => {
      const index = path.indexOf(current);
      if (index !== -1) return [...path.slice(index), current];
      if (visited.has(current)) return;
      path.push(current);
      for (const dependency of graph.get(current)?.dependsOn ?? []) {
        const cycle = visit(dependency);
        if (cycle) return cycle;
      }
      path.pop();
      visited.add(current);
    };
    return visit(id);
  }
  private async owningGoal(id: string): Promise<HostGoal | undefined> {
    if (
      !(await this.store.db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='goals'")
        .get())
    )
      return undefined;
    const row = await this.store.db.prepare("SELECT value FROM goals WHERE id=?").get(id);
    return row ? (JSON.parse(String(row.value)) as HostGoal) : undefined;
  }
  private async takeoverGoalActive(task: HostTask): Promise<boolean> {
    if (!task.goalId) return true;
    if (
      !(await this.store.db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='goals'")
        .get())
    )
      return true;
    const row = await this.store.db.prepare("SELECT value FROM goals WHERE id=?").get(task.goalId);
    return !row || JSON.parse(String(row.value)).status !== "cancelled";
  }
  private async queueTakeover(task: HostTask, now: number): Promise<HostTask> {
    return await this.write({
      ...task,
      status: "queued",
      blockedTakeover: {
        at: now,
        previousSessionId: task.sessionId,
        blocker: task.error ?? "Verification failed.",
      },
      retryFeedback: await this.retryFeedback(task),
      review: true,
      sessionId: undefined,
      runId: undefined,
      reviewer: undefined,
      verification: undefined,
      reviewOnly: undefined,
      repairStop: undefined,
      error: undefined,
      needsInput: undefined,
      completedAt: undefined,
      updatedAt: now,
    });
  }
  /** Backfill the available legacy review once; runtime/missing-verdict
   * failures are not defects. Only trusted correction summaries replace missing sessions. */
  private async withReviewNotes(task: HostTask): Promise<HostTask> {
    if (task.reviewNotes !== undefined) {
      const notes = coalesceReviewNotes(task.reviewNotes);
      return notes.length === task.reviewNotes.length
        ? task
        : await this.write({ ...task, reviewNotes: notes });
    }
    const review = task.verification?.review;
    let notes: HostTask["reviewNotes"] = [];
    if (review) {
      try {
        const session = await this.store.session(review.sessionId);
        const reply = reviewerReply(session.session.blocks);
        const verdict = parseReviewVerdict(reply);
        if (verdict.verdict === review.verdict && verdict.note === review.note)
          notes = addReviewNotes(
            [],
            reviewFindings(reply, review),
            review.sessionId,
            task.completedAt ?? task.updatedAt,
            randomUUID,
          );
      } catch {
        if (
          review.verdict === "fail" &&
          review.note !== NO_VERDICT &&
          task.repairNote === `Review failed: ${review.note}`
        )
          notes = addReviewNotes(
            [],
            reviewFindings("", review),
            undefined,
            task.completedAt ?? task.updatedAt,
            randomUUID,
          );
      }
    } else if (task.repairNote?.startsWith("Review failed: ")) {
      notes = addReviewNotes(
        [],
        [
          {
            finding: task.repairNote.slice("Review failed: ".length),
            kind: "finding",
          },
        ],
        undefined,
        task.updatedAt,
        randomUUID,
      );
    }
    return await this.write({ ...task, reviewNotes: notes });
  }
  private async write(task: HostTask, persisted?: Map<string, string>): Promise<HostTask> {
    task = suspendedTaskDelivery(task);
    task = { ...task, workspaceGenerationId: task.workspaceGenerationId ?? randomUUID() };
    return await this.store.db.scope(async () => {
      if (task.evaluation && task.status !== "done" && task.status !== "review")
        task = { ...task, evaluation: undefined };
      const run =
        task.status === "running" ? task : task.status === "verifying" ? task.reviewer : undefined;
      if (run?.sessionId && run.runId && run.startedAt !== undefined) {
        const key = JSON.stringify([run.sessionId, run.runId]);
        if (!this.registeredBudgetRuns.has(key)) {
          const parent = await this.budgetParent(task);
          const goalId = task.goalId ?? parent?.goalId;
          await this.budgets.register({
            taskId: task.id,
            ...(goalId ? { goalId } : {}),
            ...(parent ? { parentTaskId: parent.id } : {}),
            role:
              task.status === "verifying"
                ? "reviewer"
                : task.blockedTakeover
                  ? "recovery"
                  : task.repairAttempts
                    ? "repair"
                    : "worker",
            sessionId: run.sessionId,
            runId: run.runId,
            startedAt: run.startedAt,
          });
          this.registeredBudgetRuns.add(key);
        }
      }
      task = { ...task, budgetUsage: await this.budgets.read({ taskId: task.id }) };
      const value = JSON.stringify(task);
      await this.store.db
        .prepare(
          "INSERT INTO tasks VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
        )
        .run(task.id, value);
      persisted?.set(task.id, value);
      this.store.afterCommit(() => this.onChange?.());
      this.listCache = undefined;
      this.projectListCache.clear();
      this.schedulerTasks?.set(task.id, task);
      if (this.schedulerTasks) await this.hydrateDependencies(this.schedulerTasks, [task]);
      return task;
    });
  }
  private async block(
    task: HostTask,
    error: string,
    now: number,
    retainReviewer = false,
  ): Promise<HostTask> {
    if (task.workspaceActivityId && this.managed && !this.jobs.has(task.id)) {
      const run = task.reviewer ?? task;
      if (
        (
          await sessionRunState(
            this.store,
            { ...run, startedAt: run.startedAt ?? task.createdAt },
            0,
            now,
          )
        ).state === "finished"
      ) {
        await this.stopWorkspaceActivity(task);
        task = { ...task, workspaceActivityId: undefined };
      }
    }
    return await this.write({
      ...task,
      status: "blocked",
      error,
      needsInput: taskRequiresInstructions({ ...task, status: "blocked", error }) || undefined,
      reviewer: retainReviewer ? task.reviewer : undefined,
      completedAt: now,
      updatedAt: now,
    });
  }
  /** Correct failed deliverables in unattended work without releasing dependencies.
   * Runtime failures, cancellation, missing verdicts and unavailable checks stay stopped. */
  private async repairOrBlock(task: HostTask, error: string, now: number): Promise<HostTask> {
    if (task.blockedTakeover && !task.continueUntilDone)
      return await this.block(
        {
          ...task,
          repairStop: {
            reason: "no_progress",
            message:
              "The independent recovery agent could not complete this task. Provide the missing resource or update the instructions using the worker's concrete request.",
          },
        },
        error,
        now,
      );
    if (
      !task.continueUntilDone &&
      taskReviewFailureCount(task) >= MAX_TASK_REVIEW_FAILURES &&
      !task.repairStop
    )
      task = { ...task, repairStop: { reason: "limit", message: TASK_INPUT_REQUIRED } };
    if (task.reviewOnly && !task.repairStop)
      task = { ...task, repairStop: { reason: "no_progress", message: TASK_INPUT_REQUIRED } };
    const attempts = task.repairAttempts ?? 0;
    if (task.repairStop || task.reviewOnly) return await this.block(task, error, now);
    if (
      !(
        task.continueUntilDone ||
        task.autoMerge ||
        task.goalId ||
        task.source === "goal" ||
        task.source === "steward"
      ) ||
      (!task.continueUntilDone && attempts >= MAX_REPAIR_ATTEMPTS)
    )
      return await this.block(
        {
          ...task,
          ...(!task.continueUntilDone && attempts >= MAX_REPAIR_ATTEMPTS
            ? {
                repairStop: {
                  reason: "limit" as const,
                  message:
                    "Automatic correction limit reached. Inspect the attempt history and remaining findings before retrying.",
                },
              }
            : {}),
        },
        error,
        now,
      );
    const failed = { ...task, error };
    return await this.write({
      ...task,
      status: "queued",
      retryFeedback: await this.retryFeedback(failed),
      repairAttempts: attempts + 1,
      repairNote: error,
      sessionId: undefined,
      runId: undefined,
      startedAt: undefined,
      completedAt: undefined,
      error: undefined,
      reviewer: undefined,
      verification: undefined,
      needsInput: undefined,
      updatedAt: now,
    });
  }
  /** Only infrastructure interruptions may resume without owner intervention.
   * A persistence failure also interrupts a session, but must stay stopped. */
  private async canResumeAfterHostStop(run: {
    sessionId?: string;
    runId?: string;
    error?: string;
  }): Promise<boolean> {
    if (run.error && run.error !== HOST_INTERRUPTED) return false;
    try {
      const session = await this.store.session(run.sessionId ?? "");
      if (session.status !== "interrupted") return false;
      if (run.runId && session.runId !== run.runId) return false;
      const last = session.session.blocks.at(-1);
      const note = last?.role === "system" ? last.text.trim() : "";
      return (
        note === "Host stopped. This turn was interrupted." ||
        note === "Host restarted. This turn was interrupted; inspect its work before continuing."
      );
    } catch {
      return false;
    }
  }
  private async requeueInterrupted(task: HostTask, now: number): Promise<HostTask> {
    // Retain the session, branch, working copy and any previous check feedback.
    // The ordinary scheduler still enforces dependencies, concurrency and limits.
    return await this.write({
      ...task,
      status: "queued",
      error: undefined,
      completedAt: undefined,
      needsInput: undefined,
      updatedAt: now,
    });
  }
  /** Capture failed checks before a retry clears the verification record. */
  private async retryFeedback(task: HostTask): Promise<string | undefined> {
    const { command, review } = task.verification ?? {};
    const failedCommand = command && (command.timedOut || command.exitCode !== 0);
    if (review?.verdict !== "fail" && !failedCommand) return task.retryFeedback;
    const parts = [task.error ?? "Previous verification failed."];
    if (failedCommand) {
      parts.push(`Check command: ${task.verifyCommand ?? ""}`, command.output);
    }
    const acceptance = task.verification?.acceptance;
    if (acceptance) {
      parts.push(
        "Recorded acceptance evidence from the previous result. Inspect current files before reusing it:",
        JSON.stringify({
          checkedAt: acceptance.checkedAt,
          sessionId: acceptance.sessionId,
          criteria: [...acceptance.criteria]
            .sort((a, b) => Number(a.verdict === "verified") - Number(b.verdict === "verified"))
            .slice(0, 4)
            .map((entry) => ({
              criterionIndex: entry.criterionIndex,
              criterion: entry.criterion.slice(0, 200),
              verdict: entry.verdict,
              evidence: entry.evidence.slice(0, 2).map((reference) => reference.slice(0, 200)),
              note: entry.note?.slice(0, 200),
            })),
          omittedCriteria: Math.max(0, acceptance.criteria.length - 4),
        }),
      );
    }
    if (review?.verdict === "fail") {
      parts.push(`Reviewer finding: ${review.note}`);
      const structured = (task.reviewNotes ?? []).filter(
        (note) => note.kind === "finding" && note.resolvedAt === undefined,
      );
      if (structured.length && structured.every((note) => !note.details))
        return parts.join("\n\n").slice(0, RETRY_FEEDBACK_LIMIT);
      try {
        const blocks = (await this.store.session(review.sessionId)).session.blocks;
        const lastUser = blocks.findLastIndex((block) => block.role === "user");
        const replies = blocks
          .slice(lastUser + 1)
          .filter((block) => block.role === "assistant" && block.text.trim());
        const verdictReply = replies.findLast(
          (block) => parseReviewVerdict(block.text).note !== NO_VERDICT,
        );
        const details = verdictReply?.text ?? replies.at(-1)?.text;
        if (details) parts.push(details);
      } catch {
        // An unavailable review session must not prevent retrying its finding.
      }
    }
    return parts.join("\n\n").slice(0, RETRY_FEEDBACK_LIMIT);
  }
  /** Gives the task its working copy: the worktree it already has, a new one
   * on a new branch, or none when it runs in the project folder. */
  private async workingCopy(task: HostTask): Promise<HostTask> {
    const expected = await this.taskValue(task.id);
    const project = await this.store.project(task.projectId);
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
    if (this.managed && (task.isolate !== false || task.workspaceId)) {
      const selected = task.workspace
        ? await taskWorkspace(project.cwd, task.workspace)
        : undefined;
      if (!task.workspaceId && task.workspace?.branchName)
        throw new Error(
          "Managed tasks generate an owned branch name. Remove the legacy custom branch name before starting.",
        );
      let workspace = task.workspaceId
        ? await this.managed.registry.get({ workspaceId: task.workspaceId })
        : (
            await this.managed.registry.prepare({
              idempotencyKey: `task-workspace:${task.id}:${task.workspaceGenerationId ?? task.createdAt}`,
              projectId: task.projectId,
              environmentId: this.managed.environmentId,
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
        workspace = await this.managed.registry.resume({
          workspaceId: workspace.id,
          expectedRevision: workspace.revision,
          idempotencyKey: `task-resume:${task.id}:${workspace.revision}`,
        });
      for (const id of task.dependsOn ?? []) {
        const dependency = await this.scheduledTask(id);
        if (dependency?.projectId === task.projectId && dependency.deliveredCommit)
          await git(workspace.path, [
            "merge-base",
            "--is-ancestor",
            dependency.deliveredCommit,
            "HEAD",
          ]);
      }
      return this.transaction(async () => {
        const current = await this.unchangedTask(task.id, expected);
        if (!current)
          throw new TaskPreparationSuperseded("Task changed during workspace preparation.");
        return this.write({
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
      const dependency = await this.scheduledTask(id);
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
  async finalizationPreview(id: string) {
    const task = await this.get(id);
    if (!task?.branch || !task.worktreeCwd)
      throw new Error("This task has no materialized branch to finalize.");
    return previewTaskFinalization(task.worktreeCwd, task.branch);
  }
  private async requireFinalized(task: HostTask, cwd: string): Promise<void> {
    const preview = await previewTaskFinalization(cwd, task.branch!);
    const latest = await this.find(task.id);
    if (!latest || latest.updatedAt !== task.updatedAt)
      throw new Error("Task changed during finalization.");
    await this.write({ ...latest, finalization: preview });
    if (!preview.clean)
      throw new Error(
        "Finalization requires review: uncommitted task changes remain. Inspect the finalization preview, commit only the intended files on the assigned branch, and retry. The Host did not stage or commit any files.",
      );
  }
  private async stopWorkspaceActivity(task: HostTask): Promise<void> {
    if (this.managed && task.workspaceActivityId)
      await this.managed.activity.stop(task.workspaceActivityId);
  }
  private async launch(
    task: HostTask,
    now: number,
    active: readonly HostTask[],
  ): Promise<HostTask> {
    if (this.closing) return task;
    const budgetReason = await this.budgetReason(task, true);
    if (budgetReason) return await this.budgetBlock(task, budgetReason, now);
    if (task.crewDefinitionId) {
      if (!this.crewRunner)
        return await this.block(task, "Crew execution is unavailable on this host.", now);
      if (task.preflightRequirements?.length) {
        const report = await this.preflightAt(task, (await this.store.project(task.projectId)).cwd);
        const latest = await this.find(task.id);
        if (!latest || latest.status !== "queued" || latest.updatedAt !== task.updatedAt)
          return latest ?? task;
        task = { ...task, preflight: report };
        if (report.items.some((item) => item.required && item.state !== "ready"))
          return await this.block(
            task,
            "Preparation requires checked resources before starting the crew.",
            now,
          );
      }
      const pending = task.crewExecutionId
        ? task
        : await this.write({
            ...task,
            crewExecutionId: randomUUID(),
            updatedAt: this.now(),
          });
      try {
        if (this.closing) return pending;
        const coordinator = await this.crewRunner.start(pending);
        const latest = await this.find(task.id);
        if (
          this.closing ||
          !latest ||
          latest.status !== "queued" ||
          latest.updatedAt !== pending.updatedAt
        ) {
          await this.crewRunner.stop(pending);
          return latest ?? task;
        }
        return await this.write({
          ...latest,
          ...coordinator,
          status: "running",
          startedAt: now,
          updatedAt: this.now(),
          error: undefined,
          needsInput: undefined,
        });
      } catch (error) {
        const latest = await this.find(task.id);
        if (!latest || latest.status !== "queued" || latest.updatedAt !== pending.updatedAt)
          return latest ?? task;
        return await this.block(latest, errorMessage(error), this.now());
      }
    }
    let ready: HostTask;
    try {
      ready = await this.workingCopy(task);
    } catch (error) {
      if (error instanceof TaskPreparationSuperseded) return (await this.find(task.id)) ?? task;
      if ((await this.find(task.id))?.updatedAt !== task.updatedAt) return task;
      return await this.block({ ...task, startedAt: now }, errorMessage(error), now);
    }
    // The task may have been edited or deleted while its worktree was made.
    if ((await this.find(task.id))?.updatedAt !== task.updatedAt) {
      if (ready.branch && !task.branch) await this.discard(ready);
      return task;
    }
    if (this.closing) return await this.write({ ...ready, status: "queued" });
    if (ready.branch && !ready.dependencyArtifactsPrepared) {
      try {
        for (const id of ready.dependsOn ?? []) {
          const dependency = await this.scheduledTask(id);
          if (dependency?.projectId !== ready.projectId) continue;
          const source = dependency.deliveryCwd ?? (await this.store.project(ready.projectId)).cwd;
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
        return await this.block(ready, errorMessage(error), now);
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
          (other.worktreeCwd ?? (await this.store.project(other.projectId)).cwd) ===
            (ready.worktreeCwd ?? (await this.store.project(ready.projectId)).cwd),
      ))
    )
      return task;
    if (ready.mergeRepair && !ready.mergeRepair.prepared) {
      try {
        const cwd = ready.worktreeCwd!;
        if (
          !cwd ||
          (await git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"])) !== ready.branch
        )
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
              if ((await this.find(task.id))?.updatedAt !== task.updatedAt)
                return (await this.find(task.id)) ?? task;
              task = await this.write({
                ...ready,
                mergeRepair: { ...ready.mergeRepair, replayStarted: true },
                updatedAt: now,
              });
              ready = task;
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
          if (ready.mergeRepair!.replayCommit) await this.requireFinalized(ready, cwd);
          if ((await this.find(task.id))?.updatedAt !== task.updatedAt)
            return (await this.find(task.id)) ?? task;
          const next = await this.write({
            ...ready,
            status: "verifying",
            updatedAt: now,
          });
          await this.verify(next);
          return next;
        }
      } catch (error) {
        if ((await this.find(task.id))?.updatedAt !== task.updatedAt)
          return (await this.find(task.id)) ?? task;
        return await this.block(ready, errorMessage(error), now);
      }
    }
    const projectCwd = (await this.store.project(ready.projectId)).cwd;
    const sharedEdits = ready.worktreeCwd ? await this.sharedEdits(projectCwd) : [];
    if ((await this.find(task.id))?.updatedAt !== task.updatedAt)
      return (await this.find(task.id)) ?? task;
    const launchBudget = await this.budgetReason(ready, true);
    if (launchBudget) return await this.budgetBlock(ready, launchBudget, this.now());
    if (ready.preflightRequirements?.length) {
      const report = await this.preflightAt(ready, ready.worktreeCwd ?? projectCwd);
      const current = await this.find(task.id);
      if (!current || current.status !== "queued" || current.updatedAt !== task.updatedAt)
        return current ?? task;
      ready = { ...ready, preflight: report };
      const missing = report.items.filter((item) => item.required && item.state !== "ready");
      if (missing.length)
        return await this.block(
          ready,
          `Preparation requires checked resources: ${missing.map((item) => item.label).join(", ")}.`,
          this.now(),
        );
    }
    const finalLaunchBudget = await this.budgetReason(ready, true);
    if (finalLaunchBudget) return await this.budgetBlock(ready, finalLaunchBudget, this.now());
    const resumable = await this.canResumeAfterHostStop(ready);
    if (this.closing) return await this.write({ ...ready, status: "queued" });
    if (ready.workspaceId && this.managed && !ready.workspaceActivityId) {
      const activity = await this.managed.activity.start({
        workspaceId: ready.workspaceId,
        kind: "provider",
        ownerId: ready.id,
      });
      try {
        ready = await this.write({ ...ready, workspaceActivityId: activity.id });
      } catch (error) {
        await this.managed.activity.stop(activity.id);
        throw error;
      }
    }
    const started = resumable
      ? await this.resumeInterrupted(ready)
      : await launchSessionRun(
          this.store,
          this.engine,
          {
            ...ready,
            prompt: workerPrompt(ready, projectCwd, sharedEdits),
          },
          () => !this.closing,
        );
    if (started.deferred) {
      await this.stopWorkspaceActivity(ready);
      return await this.write({ ...ready, workspaceActivityId: undefined, status: "queued" });
    }
    const next = {
      ...ready,
      awaitingOwnerRestart: undefined,
      sessionId: started.sessionId,
      runId: started.runId,
      startedAt: now,
    };
    if (started.error !== undefined) return await this.block(next, started.error, now);
    return await this.write({ ...next, status: "running", updatedAt: now });
  }
  /** Tracked files other sessions have edited but not committed in the
   * project checkout, so an isolated worker knows what delivery will meet. */
  private async sharedEdits(projectCwd: string): Promise<string[]> {
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
  private async resumeInterrupted(task: HostTask): Promise<{
    sessionId?: string;
    runId?: string;
    error?: string;
    deferred?: boolean;
  }> {
    try {
      const session = (await this.store.session(task.sessionId!)).session;
      // A queued recovery can be edited, or its worktree recreated elsewhere.
      // Never resume a conversation configured for a different folder or model.
      if (
        session.cwd !== (task.worktreeCwd ?? (await this.store.project(task.projectId)).cwd) ||
        session.harness !== task.harness ||
        (session.providerAccountId ?? "default") !== (task.providerAccountId ?? "default") ||
        session.model !== task.model ||
        session.runtimeMode !== task.runtimeMode ||
        JSON.stringify(session.modelSettings) !== JSON.stringify(task.modelSettings)
      ) {
        return await launchSessionRun(
          this.store,
          this.engine,
          {
            ...task,
            prompt: workerPrompt(task, (await this.store.project(task.projectId)).cwd),
          },
          () => !this.closing,
        );
      }
      const project = await this.store.project(task.projectId);
      if (this.closing) return { deferred: true };
      await this.engine.command({
        type: "send",
        commandId: randomUUID(),
        sessionId: task.sessionId!,
        text: [
          "The host stopped before this task finished. Continue this task from the existing conversation and working copy. Inspect the current changes and the last tool results first; keep completed work and do not start over. Completion still requires the original task's checks and review.",
          "",
          workerPrompt(task, project.cwd),
        ].join("\n"),
      });
      return {
        sessionId: task.sessionId,
        runId: (await this.store.session(task.sessionId!)).runId,
      };
    } catch (error) {
      return { sessionId: task.sessionId, error: errorMessage(error) };
    }
  }
  private async settleCrew(task: HostTask, now: number): Promise<void> {
    if (!this.crewRunner) return;
    try {
      const run = await this.crewRunner.state(task);
      if (run.status === "finished") {
        await this.write({
          ...task,
          status: "done",
          completedAt: now,
          updatedAt: now,
          needsInput: undefined,
          error: undefined,
        });
      } else if (
        task.maxRunMinutes > 0 &&
        now - (task.startedAt ?? now) >= task.maxRunMinutes * 60000
      ) {
        await this.crewRunner.stop(task);
        const latest = await this.find(task.id);
        if (latest?.status === "running" && latest.crewExecutionId === task.crewExecutionId)
          await this.block(latest, "The crew task exceeded its time limit.", now);
      } else {
        const needsInput = run.status === "paused" || !!run.error;
        if (Boolean(task.needsInput) !== needsInput || task.error !== run.error)
          await this.write({
            ...task,
            needsInput: needsInput || undefined,
            error: run.error,
            updatedAt: now,
          });
      }
    } catch (error) {
      await this.block(task, errorMessage(error), now);
    }
  }
  private async settle(task: HostTask, now: number): Promise<void> {
    const outcome = await sessionRunState(
      this.store,
      { ...task, startedAt: task.startedAt ?? task.createdAt },
      task.maxRunMinutes,
      now,
    );
    if (outcome.state === "running") {
      if (outcome.needsInput !== Boolean(task.needsInput))
        await this.write({
          ...task,
          needsInput: outcome.needsInput || undefined,
          updatedAt: now,
        });
    } else if (outcome.state === "overLimit") {
      // The reason is saved first: the turn settles asynchronously, and a
      // later tick blocks the task with it.
      await this.write({ ...task, error: outcome.error });
      await cancelSessionRun(this.engine, task);
    } else if (outcome.status === "succeeded") {
      await this.limits.record(task.startedAt ?? task.createdAt, now);
      await this.verify(
        await this.write({
          ...task,
          status: "verifying",
          needsInput: undefined,
          verification: undefined,
          updatedAt: now,
        }),
      );
    } else {
      await this.limits.record(task.startedAt ?? task.createdAt, now);
      if (outcome.error === HOST_INTERRUPTED && (await this.canResumeAfterHostStop(task))) {
        await this.requeueInterrupted(task, now);
        return;
      }
      await this.block(
        task,
        outcome.status === "cancelled" ? STOPPED_BY_USER : (outcome.error ?? "The run failed."),
        now,
      );
    }
  }
  /** Runs the task's checks in the background: commits what the agent left,
   * runs the check command, then hands over to the reviewer or to review. */
  private async verify(task: HostTask): Promise<void> {
    if (this.closing) return;
    const { id } = task;
    if (this.jobs.has(id)) return;
    const controller = new AbortController();
    let expected = await this.taskValue(id);
    if (this.closing) return;
    this.jobControllers.set(id, controller);
    /** The task, while this job still owns its verification. */
    const current = async () => {
      const latest = this.jobs.get(id) === job ? await this.find(id) : undefined;
      return latest?.status === "verifying" ? latest : undefined;
    };
    const run = async () => {
      // Lets the job be registered before it first asks whether it owns the task.
      await null;
      if (
        controller.signal.aborted ||
        !(await current()) ||
        !(await this.unchangedTask(id, expected))
      )
        return;
      const project = await this.store.project(task.projectId);
      const cwd = task.worktreeCwd ?? project.cwd;
      if (hasUnmergedBranch(task))
        await withHostGitMutation(cwd, async () => {
          if (
            controller.signal.aborted ||
            !(await current()) ||
            !(await this.unchangedTask(id, expected))
          )
            return;
          await this.requireFinalized(task, cwd);
          expected = await this.taskValue(id);
        });
      // The repository lease can wait behind another operation. Stop must still
      // prevent a new check command or reviewer from starting after that wait.
      if (
        controller.signal.aborted ||
        !(await current()) ||
        !(await this.unchangedTask(id, expected))
      )
        return;
      const verification: TaskVerification = {};
      if (task.verifyCommand) {
        const result = await runHostShell(
          cwd,
          task.verifyCommand,
          this.verifyTimeoutMs,
          undefined,
          controller.signal,
          async (message) => {
            const latest = await this.find(id);
            if (latest?.status === "blocked")
              await this.write({
                ...latest,
                error: `The verification command tree could not be stopped. ${message} Inspect host diagnostics before retrying.`,
                updatedAt: this.now(),
              });
          },
        );
        if (controller.signal.aborted) return;
        verification.command = {
          exitCode: result.exitCode,
          output: result.output.slice(-VERIFY_OUTPUT_LIMIT),
          timedOut: result.timedOut,
        };
        if (result.timedOut || result.exitCode !== 0) {
          const workspace = task.continueUntilDone
            ? readTaskInstructions(task.prompt)?.acceptance.length
              ? await this.acceptanceFingerprint(task)
              : await this.workspaceFingerprint(task)
            : undefined;
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
                ? this.block.bind(this)
                : this.repairOrBlock.bind(this)
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
              this.now(),
            );
          return;
        }
      }
      if (task.review === false) {
        const diffStat = await this.diffStat(task);
        const latest = await current();
        if (latest) await this.enterReview({ ...latest, verification, diffStat });
        return;
      }
      const latest = await current();
      if (!latest) return;
      const reviewBudget = await this.budgetReason(latest, true);
      if (reviewBudget) {
        await this.budgetBlock(latest, reviewBudget, this.now());
        return;
      }
      const now = this.now();
      const acceptanceRequired = Boolean(readTaskInstructions(task.prompt)?.acceptance.length);
      const crewReviewFingerprint = task.crewRunId
        ? await this.workspaceFingerprint(task)
        : undefined;
      const acceptanceFingerprint = acceptanceRequired
        ? await this.acceptanceFingerprint(task)
        : undefined;
      if ((await current())?.updatedAt !== latest.updatedAt) return;
      if (task.crewRunId && !crewReviewFingerprint) {
        await this.block(
          latest,
          "Cannot snapshot this crew assignment for independent review.",
          now,
        );
        return;
      }
      const finalReviewBudget = await this.budgetReason(latest, true);
      if (finalReviewBudget) {
        await this.budgetBlock(latest, finalReviewBudget, this.now());
        return;
      }
      const started = await launchSessionRun(
        this.store,
        this.engine,
        {
          ...task,
          title: `Review: ${task.title}`.slice(0, 200),
          ...(task.reviewerConfig
            ? {
                harness: task.reviewerConfig.harness,
                // A profile belongs to one provider; never reuse it for a different reviewer.
                providerAccountId:
                  task.reviewerConfig.harness === task.harness ? task.providerAccountId : undefined,
                model: task.reviewerConfig.model,
                modelSettings: task.reviewerConfig.modelSettings,
              }
            : {}),
          prompt: `${task.reviewerConfig?.instructions ?? ""}\n${reviewPrompt(task)}`,
        },
        () => !this.closing && !controller.signal.aborted,
      );
      if (started.deferred) return;
      const reviewing = {
        ...latest,
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
        await this.block(reviewing, `Could not start the reviewer: ${started.error}`, now);
      else await this.write({ ...reviewing, updatedAt: now });
    };
    const job: Promise<void> = this.store.db.outsideScope(() =>
      run()
        .catch(async (error) => {
          const latest = await current();
          if (latest) {
            if (error instanceof UnresolvedMerge && latest.mergeRepair)
              await this.repairOrBlock(
                { ...latest, retryFeedback: error.message },
                error.message,
                this.now(),
              );
            else await this.block(latest, errorMessage(error), this.now());
          }
        })
        .catch((error) => console.error("Could not verify a task:", errorMessage(error)))
        .finally(async () => {
          const latest = await this.find(id);
          if (latest?.workspaceActivityId && latest.status === "blocked") {
            const run = latest.reviewer ?? latest;
            if (
              (
                await sessionRunState(
                  this.store,
                  { ...run, startedAt: run.startedAt ?? latest.createdAt },
                  0,
                  this.now(),
                )
              ).state === "finished"
            ) {
              await this.stopWorkspaceActivity(latest);
              await this.write({ ...latest, workspaceActivityId: undefined });
            }
          }
          if (this.jobs.get(id) === job) {
            this.jobs.delete(id);
            this.jobControllers.delete(id);
          }
        }),
    );
    this.jobs.set(id, job);
  }
  /** Follows a verifying task's reviewer to its verdict. */
  private async settleVerification(task: HostTask, now: number): Promise<void> {
    if (this.jobs.has(task.id)) return;
    if (!task.reviewer) {
      // The host stopped during the checks; they start over.
      await this.verify(task);
      return;
    }
    if (task.reviewer.verdictRepairPending || task.reviewer.recoveryPending) {
      await this.resumeReviewer(task, now);
      return;
    }
    const outcome = await sessionRunState(this.store, task.reviewer, task.maxRunMinutes, now);
    if (outcome.state === "running") {
      if (outcome.needsInput !== Boolean(task.needsInput))
        await this.write({
          ...task,
          needsInput: outcome.needsInput || undefined,
          updatedAt: now,
        });
      return;
    }
    if (outcome.state === "overLimit") {
      await this.write({
        ...task,
        reviewer: { ...task.reviewer, error: outcome.error },
      });
      await cancelSessionRun(this.engine, task.reviewer);
      return;
    }
    await this.limits.record(task.reviewer.startedAt, now);
    if (outcome.error === HOST_INTERRUPTED && (await this.canResumeAfterHostStop(task.reviewer))) {
      // Retain the read-only review and its inspected evidence. A host stop
      // is not a failed verdict and must not spend a correction attempt.
      const next = await this.write({
        ...task,
        reviewer: { ...task.reviewer, recoveryPending: true },
        needsInput: undefined,
        updatedAt: now,
      });
      await this.resumeReviewer(next, now);
      return;
    }
    if (outcome.status === "cancelled") {
      await this.block(task, STOPPED_BY_USER, now);
      return;
    }
    const sessionId = task.reviewer.sessionId ?? "";
    let review =
      outcome.status === "succeeded"
        ? reviewerVerdict((await this.store.session(sessionId)).session.blocks)
        : {
            verdict: "fail" as const,
            note: outcome.error ?? "The reviewer’s run failed.",
          };
    const reply =
      outcome.status === "succeeded"
        ? reviewerReply((await this.store.session(sessionId)).session.blocks)
        : "";
    const acceptanceCriteria = readTaskInstructions(task.prompt)?.acceptance ?? [];
    const acceptanceRequired = task.reviewer.acceptanceRequired && acceptanceCriteria.length > 0;
    // A clean reviewer turn without the required machine-readable verdict is a
    // format failure, not evidence that the implementation is defective.
    if (
      outcome.status === "succeeded" &&
      (review.note === NO_VERDICT ||
        (acceptanceRequired && !hasTaskAcceptanceReport(reply, acceptanceCriteria))) &&
      task.continueUntilDone &&
      (task.reviewer.verdictRepairAttempts ?? 0) < 2
    ) {
      const pending = await this.write({
        ...task,
        reviewer: { ...task.reviewer, verdictRepairPending: true },
        updatedAt: now,
      });
      await this.resumeReviewer(pending, now);
      return;
    }
    const acceptance = acceptanceRequired
      ? parseTaskAcceptance(reply, acceptanceCriteria, { checkedAt: now, sessionId })
      : undefined;
    if (acceptance && review.verdict === "pass") {
      const incomplete = acceptance.criteria.filter(
        (criterion) => criterion.verdict !== "verified",
      );
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
            reviewerReply((await this.store.session(sessionId)).session.blocks),
            review,
          )
        : [];
    const previous = task.attemptHistory?.at(-1);
    const repositoryFingerprint =
      task.continueUntilDone || task.crewRunId ? await this.workspaceFingerprint(task) : undefined;
    const acceptanceFingerprint = acceptance ? await this.acceptanceFingerprint(task) : undefined;
    const workspaceFingerprint = acceptanceRequired ? acceptanceFingerprint : repositoryFingerprint;
    const currentReview = await this.find(task.id);
    if (
      currentReview?.status !== "verifying" ||
      currentReview.updatedAt !== task.updatedAt ||
      currentReview.reviewer?.runId !== task.reviewer.runId
    )
      return;
    if (
      task.crewRunId &&
      (!repositoryFingerprint || repositoryFingerprint !== task.crewReviewFingerprint)
    ) {
      const reason =
        "The working copy changed during independent review. Recheck the review on the current result.";
      await this.block(
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
        task.reviewer.workspaceFingerprint &&
        acceptanceFingerprint !== task.reviewer.workspaceFingerprint
      ) {
        const reason =
          "The working copy changed during acceptance review. Recheck the current result.";
        acceptance.criteria = acceptance.criteria.map((criterion) => ({
          ...criterion,
          verdict: "unresolved",
          note: reason,
        }));
        await this.block(
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
    const comparable = task.continueUntilDone
      ? workspaceFingerprint
        ? task.attemptHistory?.findLast(
            (attempt) =>
              attempt.verdict === "fail" && attempt.workspaceFingerprint === workspaceFingerprint,
          )
        : undefined
      : previous;
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
        const blocks = (await this.store.session(task.sessionId)).session.blocks;
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
                    reviewerReply((await this.store.session(sessionId)).session.blocks),
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
          ? this.repairOrBlock.bind(this)
          : this.block.bind(this)
      )(reviewed, `Review failed: ${review.note}`, now);
      return;
    }
    const diffStat = await this.diffStat(task);
    const latest = await this.find(task.id);
    if (latest?.status === "verifying" && latest.updatedAt === task.updatedAt)
      await this.enterReview({
        ...latest,
        verification,
        reviewNotes: reviewed.reviewNotes,
        repairStop: undefined,
        attemptHistory,
        diffStat,
      });
  }
  private async resumeReviewer(task: HostTask, now: number): Promise<void> {
    if (this.closing) return;
    if (await this.limits.reached()) return;
    const budgetReason = await this.budgetReason(task, true);
    if (budgetReason) {
      await this.budgetBlock(task, budgetReason, now);
      return;
    }
    try {
      const sessionId = task.reviewer!.sessionId!;
      const session = await this.store.session(sessionId);
      const interrupted = task.reviewer!.recoveryPending;
      const last = session.session.blocks.at(-1);
      if (last?.role === "system" && last.text.trim() === STOPPED_BY_USER) {
        await this.block(task, STOPPED_BY_USER, now);
        return;
      }
      if (
        session.runId !== task.reviewer!.runId ||
        (interrupted
          ? !(await this.canResumeAfterHostStop(task.reviewer!))
          : session.status !== "idle")
      ) {
        await this.block(
          task,
          "The reviewer recovery no longer owns its recorded turn. Recheck the review to continue.",
          now,
        );
        return;
      }
      await this.engine.command({
        type: "send",
        commandId: randomUUID(),
        sessionId,
        text:
          (interrupted
            ? "The host interrupted this review. Continue the unfinished review in the existing conversation, preserving the inspected evidence and completed checks. "
            : "") +
          "Complete the existing read-only review using the evidence already inspected. Do not edit files or launch an implementation worker. Include the concrete findings, then end with exactly VERDICT: PASS or VERDICT: FAIL - <specific reason>. Do not invent a passing verdict or claim unavailable checks passed.\n" +
          (task.reviewer!.acceptanceRequired
            ? acceptanceReviewInstructions(readTaskInstructions(task.prompt)?.acceptance ?? [])
            : ""),
      });
      await this.write({
        ...task,
        reviewer: {
          ...task.reviewer!,
          runId: (await this.store.session(sessionId)).runId,
          startedAt: now,
          verdictRepairPending: undefined,
          recoveryPending: undefined,
          verdictRepairAttempts: (task.reviewer!.verdictRepairAttempts ?? 0) + Number(!interrupted),
        },
        updatedAt: now,
      });
    } catch (error) {
      await this.block(task, `Could not resume the reviewer: ${errorMessage(error)}`, now);
    }
  }
  /** Moves a verified task to review. An isolated task set to merge on its
   * own is merged right away, when every configured check passed; it then goes
   * straight to done. When it cannot be merged it waits in review, with why. */
  private async enterReview(task: HostTask): Promise<HostTask> {
    if (task.workspaceId && this.managed) {
      await this.stopWorkspaceActivity(task);
      const workspace = await this.managed.registry.get({ workspaceId: task.workspaceId });
      if (!workspace) throw new Error("The task workspace is unavailable.");
      await this.managed.registry.finish({
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
    const now = this.now();
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
      return await this.write({ ...reviewing, status: "done", mergeError: undefined });
    return await this.write(reviewing);
  }
  /** Old persisted approval booleans cannot authorize Git mutations. */
  private async recoverMerge(task: HostTask, _now: number, _auto = true): Promise<void> {
    if (task.autoMerge || task.deliveryRequested)
      await this.write({ ...suspendedTaskDelivery(task), mergeRetry: undefined });
  }
  /** What the task branch changes since it left the project's branch. */
  /** Covers the repository snapshot plus explicit local deliverables, including ignored outputs.
   * External URLs and prose descriptions remain the reviewer's evidence, not a filesystem check. */
  private async acceptanceFingerprint(task: HostTask): Promise<string | undefined> {
    const cwd = task.worktreeCwd ?? (await this.store.project(task.projectId)).cwd;
    const [workspace, outputs] = await Promise.all([
      await this.workspaceFingerprint(task),
      acceptanceOutputFingerprint(
        cwd,
        readTaskInstructions(task.prompt)?.deliverables ?? [],
        task.artifactPaths,
      ),
    ]);
    if (!workspace || !outputs) return undefined;
    return createHash("sha256")
      .update(workspace)
      .update("\0")
      .update(outputs.fingerprint)
      .digest("hex");
  }
  /** Content evidence for retry progress. Prefer Git's tracked tree and diff;
   * small non-Git project folders use a bounded scan, never following links. */
  private async workspaceFingerprint(task: HostTask): Promise<string | undefined> {
    const cwd = task.worktreeCwd ?? (await this.store.project(task.projectId)).cwd;
    const hash = createHash("sha256");
    if (task.crewScopes?.length && !task.crewScopes.includes(".")) {
      const pending = [...task.crewScopes].sort().reverse();
      const visited = new Set<string>();
      let bytes = 0;
      try {
        while (pending.length) {
          const name = pending.pop()!;
          if (visited.has(name)) continue;
          visited.add(name);
          if (visited.size > 2000) return undefined;
          hash.update(name).update("\0");
          let info;
          try {
            info = await lstat(join(cwd, name));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
              hash.update("missing\0");
              continue;
            }
            throw error;
          }
          if (info.isSymbolicLink()) return undefined;
          if (info.isDirectory()) {
            hash.update("directory\0");
            const children = (await readdir(join(cwd, name)))
              .filter((child) => ![".git", "node_modules", "temp"].includes(child))
              .sort()
              .reverse();
            pending.push(...children.map((child) => `${name}/${child}`));
          } else if (info.isFile()) {
            bytes += info.size;
            if (bytes > 16 * 1024 * 1024) return undefined;
            hash.update("file\0").update(await readFile(join(cwd, name)));
            await yieldFingerprint();
          } else return undefined;
        }
        return hash.digest("hex");
      } catch {
        return undefined;
      }
    }
    try {
      const tree = await git(cwd, ["rev-parse", "HEAD^{tree}"]);
      hash.update(tree).update(await git(cwd, ["diff", "--binary", "HEAD"]));
      const untracked = await git(cwd, ["ls-files", "--others", "--exclude-standard"]);
      if (
        !(await fingerprintPaths(hash, cwd, untracked.split(/\r?\n/).filter(Boolean).sort(), {
          entries: 0,
          bytes: 0,
        }))
      )
        return undefined;
      return hash.digest("hex");
    } catch {
      // A non-Git project may be a small report/artifact folder. Keep this
      // fallback bounded so large projects cannot stall the scheduler.
      const pending = [""];
      const budget = { entries: 0, bytes: 0 };
      try {
        while (pending.length) {
          const directory = pending.pop()!;
          const names = (await readdir(join(cwd, directory)))
            .sort()
            .filter((name) => ![".git", "node_modules", "temp"].includes(name))
            .map((name) => join(directory, name));
          if (!(await fingerprintPaths(hash, cwd, names, budget, pending))) return undefined;
        }
        return hash.digest("hex");
      } catch {
        return undefined;
      }
    }
  }
  private async diffStat(task: HostTask): Promise<string | undefined> {
    if (!hasUnmergedBranch(task) || !task.baseCommit) return undefined;
    try {
      const stat = await git((await this.store.project(task.projectId)).cwd, [
        "diff",
        "--stat",
        `${task.baseCommit}...${task.branch}`,
      ]);
      return stat.slice(0, DIFF_STAT_LIMIT) || undefined;
    } catch {
      return undefined;
    }
  }
  /** Review implementation and delivery independently; this read never authorizes a merge. */
  async reviewDelivery(id: string): Promise<TaskDeliveryReview> {
    const task = await this.get(id);
    if (!task?.workspaceId || !this.managed)
      throw new Error("Update this host to review managed task delivery.");
    const workspace = await this.managed.registry.get({ workspaceId: task.workspaceId });
    if (!workspace) throw new Error("The task workspace is unavailable.");
    const plan = await this.managed.delivery.review({
      workspaceId: workspace.id,
      expectedRevision: workspace.revision,
      action: "merge",
    });
    if (workspace.directoryState === "removed") return plan;
    const targetDirectory =
      (plan as typeof plan & { targetDirectory?: string }).targetDirectory ??
      task.deliveryCwd ??
      (await this.store.project(task.projectId)).cwd;
    const artifacts = await previewTaskDeliveryArtifacts(workspace.path, targetDirectory);
    const latest = await this.get(id);
    if (!latest || latest.workspaceId !== workspace.id || latest.updatedAt !== task.updatedAt)
      throw new Error("Task changed while reviewing its delivery artifacts.");
    if (
      artifacts.paths.length ||
      artifacts.blockers.length ||
      task.artifactDeliveryPending ||
      task.deliveryArtifacts
    ) {
      await this.write({
        ...latest,
        deliveryArtifacts: {
          ...artifacts,
          planToken: plan.token,
          sourceHead: plan.sourceHead,
          targetDirectory,
        },
      });
      return { ...plan, artifacts, blockers: [...plan.blockers, ...artifacts.blockers] };
    }
    return plan;
  }
  /** Owner transport must supply proof separately. No persistent boolean authorizes this method. */
  async mergeDelivery(
    id: string,
    request: WorkspaceRpcRequest<"workspaces.delivery.merge">,
    owner: WorkspaceOwnerAuthorization,
  ): Promise<HostTask> {
    const task = await this.get(id);
    if (!task?.workspaceId || !this.managed || request.workspaceId !== task.workspaceId)
      throw new Error("The delivery plan does not belong to this task.");
    if (!["review", "done"].includes(task.status))
      throw new Error("Finish task verification before delivery.");
    const blocker = autoMergeBlocker(task);
    if (blocker) throw new Error(blocker);
    if (this.delivering.has(id)) throw new Error("This task is already being delivered.");
    this.delivering.add(id);
    try {
      const artifacts = task.deliveryArtifacts;
      if (artifacts) {
        if (artifacts.planToken !== request.planToken || !task.worktreeCwd)
          throw new Error("Review task artifacts again before delivery.");
        const previous = await this.managed.registry.findOperation({
          workspaceId: task.workspaceId,
          kind: "delivery",
          idempotencyKey: request.idempotencyKey,
        });
        await validateTaskDeliveryArtifacts(
          artifacts,
          task.worktreeCwd,
          artifacts.targetDirectory,
          { allowCopied: previous?.kind === "delivery" && Boolean(previous.merge) },
        );
      }
      const receipt = await this.managed.delivery.merge(request, owner);
      const latest = await this.get(id);
      if (!latest || latest.workspaceId !== task.workspaceId)
        throw new Error("Task changed during delivery; the workspace receipt is retained.");
      return await this.finishDeliveryReceipt(latest, receipt, request.planToken);
    } finally {
      this.delivering.delete(id);
    }
  }
  private async finishDeliveryReceipt(
    task: HostTask,
    receipt: BranchMergeReceipt,
    planToken: string,
  ): Promise<HostTask> {
    const delivered: HostTask = {
      ...task,
      status: "review",
      merged: true,
      deliveredCommit: receipt.targetHead,
      mergedAt: this.now(),
      deliveryState: "merged",
      deliveryOperationId: receipt.operationId,
      deliveryApprovalRequired: undefined,
      mergeError: undefined,
      updatedAt: this.now(),
    };
    await this.write(delivered);
    const target =
      task.deliveryArtifacts?.targetDirectory ??
      task.deliveryCwd ??
      (await this.store.project(task.projectId)).cwd;
    if (!task.worktreeCwd)
      return this.write(
        task.artifactDeliveryPending
          ? {
              ...delivered,
              artifactDeliveryPending: true,
              mergeError: "The artifact source is unavailable; the Git receipt is retained.",
            }
          : { ...delivered, status: "done" },
      );
    let activityId = task.artifactDeliveryActivityId;
    try {
      activityId ??= (
        await this.managed!.activity.start({
          workspaceId: task.workspaceId!,
          kind: "operation",
          ownerId: `task-artifacts:${receipt.operationId}`,
        })
      ).id;
      await this.write({
        ...delivered,
        artifactDeliveryPending: true,
        artifactDeliveryActivityId: activityId,
      });
      const preview = await previewTaskDeliveryArtifacts(task.worktreeCwd, target);
      if (preview.blockers.length) throw new Error(preview.blockers.join("; "));
      let artifactPaths: string[] = [];
      const approved = task.deliveryArtifacts;
      if (preview.paths.length) {
        if (
          !approved ||
          approved.planToken !== planToken ||
          approved.sourceHead !== receipt.sourceHead
        ) {
          return this.write({
            ...delivered,
            artifactDeliveryPending: true,
            artifactDeliveryActivityId: activityId,
            mergeError:
              "The Git receipt is retained. Review local task artifacts before completing delivery.",
          });
        }
        await validateTaskDeliveryArtifacts(approved, task.worktreeCwd, target, {
          allowCopied: true,
        });
        artifactPaths = await transferTaskArtifacts(
          task.worktreeCwd,
          target,
          approved.paths,
          approved.hashes,
        );
      } else if (approved?.paths.length) {
        throw new Error(
          "Reviewed artifact sources disappeared. The Git receipt and directory reservation are retained.",
        );
      }
      const completed = await this.write({
        ...delivered,
        status: "done",
        artifactDeliveryPending: undefined,
        cleanupError: undefined,
        cleanupRetryAfter: undefined,
        artifactDeliveryActivityId: activityId,
        ...(artifactPaths.length ? { artifactPaths, artifactHashes: approved!.hashes } : {}),
      });
      await this.managed!.activity.stop(activityId);
      return await this.write({ ...completed, artifactDeliveryActivityId: undefined });
    } catch (error) {
      await this.write({
        ...delivered,
        artifactDeliveryPending: true,
        artifactDeliveryActivityId: activityId,
        mergeError: `Git delivery is recorded; artifact delivery must resume: ${errorMessage(error)}`,
      });
      // A pending operation retains its activity fence: global retention must not race recovery.
      throw error;
    }
  }
  /** Called by S1 after generic workspace delivery and on recovery. Trust only the durable registry receipt. */
  async reconcileDelivery(workspaceId: string): Promise<HostTask | undefined> {
    if (!this.managed) throw new Error("Managed task delivery is unavailable.");
    const workspace = await this.managed.registry.get({ workspaceId });
    if (
      !workspace ||
      workspace.owner.kind !== "task" ||
      !["finished", "merged"].includes(workspace.state)
    )
      return;
    const task = await this.get(workspace.owner.id);
    if (!task || task.workspaceId !== workspace.id || !["review", "done"].includes(task.status))
      return;
    const operations = await this.managed.registry.listOperations(workspace.id);
    const delivery = operations.find(
      (entry) =>
        entry.kind === "delivery" &&
        entry.phase === "complete" &&
        workspace.state === "merged" &&
        entry.merge?.targetHead === workspace.deliveredCommit,
    );
    if (!delivery || delivery.kind !== "delivery" || !delivery.merge) {
      const publication = operations.find(
        (entry) =>
          entry.kind === "delivery" &&
          entry.phase === "complete" &&
          entry.plan.action === "publish" &&
          entry.publication?.status === "complete" &&
          entry.expectedRevision === workspace.revision,
      );
      if (!publication || publication.kind !== "delivery") return task;
      return this.write({
        ...task,
        status: "done",
        deliveryState: "published",
        deliveryOperationId: publication.id,
        deliveryApprovalRequired: undefined,
        updatedAt: this.now(),
      });
    }
    return this.finishDeliveryReceipt(task, delivery.merge, delivery.plan.token);
  }
  /** Retire delivered task checkouts, retrying Windows locks without discarding changed work. */
  private async cleanupDelivered(task: HostTask, now: number): Promise<HostTask> {
    if (!task.workspaceId || !this.managed || (task.cleanupRetryAfter ?? 0) > now) return task;
    try {
      const workspace = await this.managed.registry.get({ workspaceId: task.workspaceId });
      if (!workspace || workspace.directoryState === "removed") return task;
      if (task.artifactDeliveryPending)
        throw new Error(
          "Task artifacts have not been delivered; the source directory is retained.",
        );
      const target =
        task.deliveryArtifacts?.targetDirectory ??
        task.deliveryCwd ??
        (await this.store.project(task.projectId)).cwd;
      const artifacts = await previewTaskDeliveryArtifacts(workspace.path, target);
      if (artifacts.blockers.length) throw new Error(artifacts.blockers.join("; "));
      if (artifacts.paths.length) {
        if (!task.deliveryArtifacts)
          throw new Error(
            "Ignored task outputs require an owner-reviewed delivery before retirement.",
          );
        await validateTaskDeliveryArtifacts(task.deliveryArtifacts, workspace.path, target, {
          allowCopied: true,
        });
        if (
          artifacts.paths.some(
            (path) => artifacts.targetHashes[path] !== task.deliveryArtifacts!.hashes[path],
          )
        )
          throw new Error(
            "Task artifacts are not safely delivered; the source directory is retained.",
          );
      }
      const plan = await this.managed.removal.plan({
        workspaceId: workspace.id,
        expectedRevision: workspace.revision,
      });
      if (plan.blockers.length || plan.dirty) return task;
      await this.managed.removal.apply(
        {
          workspaceId: workspace.id,
          expectedRevision: workspace.revision,
          idempotencyKey: `task-retire:${task.id}:${plan.token}`,
          planToken: plan.token,
        },
        { kind: "retentionScheduler" },
      );
      return this.write({
        ...task,
        worktreeCwd: undefined,
        cleanupError: undefined,
        cleanupRetryAfter: undefined,
      });
    } catch (error) {
      return this.write({
        ...task,
        cleanupError: errorMessage(error),
        cleanupRetryAfter: now + 2 * 60000,
      });
    }
  }
  /** Closing preserves the local branch and recovery refs. S4 alone owns directory retirement. */
  private async discard(task: HostTask): Promise<void> {
    if (!task.workspaceId || !this.managed)
      throw new Error(
        "This legacy branch is retained. Register it as a managed workspace before directory retirement.",
      );
    let workspace = await this.managed.registry.get({ workspaceId: task.workspaceId });
    if (!workspace)
      throw new Error("The managed task workspace is unavailable; its branch is retained.");
    workspace = await this.managed.registry.close({
      workspaceId: workspace.id,
      expectedRevision: workspace.revision,
      idempotencyKey: `task-close:${task.id}:${workspace.revision}`,
    });
    const plan = await this.managed.removal.plan({
      workspaceId: workspace.id,
      expectedRevision: workspace.revision,
    });
    if (plan.blockers.length || plan.dirty)
      throw new Error(
        `The task branch is retained. Directory removal blocked: ${plan.blockers.join("; ") || "uncommitted changes"}`,
      );
    await this.managed.removal.apply(
      {
        workspaceId: workspace.id,
        expectedRevision: workspace.revision,
        idempotencyKey: `task-discard:${task.id}:${plan.token}`,
        planToken: plan.token,
      },
      { kind: "retentionScheduler" },
    );
  }
}
