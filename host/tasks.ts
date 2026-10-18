import { runGitText } from "../src/shared/lib/processExecution.node";
import { createHash, randomUUID } from "node:crypto";
import { realpathSync, statSync, readFileSync } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
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
  type TaskVerification,
} from "../src/features/tasks/model/hostTasks";
import { DEFAULT_MAX_RUNNING_TASKS } from "../src/features/tasks/model/hostSettings";
import { blockedHandoff, taskContract } from "./task-handoff";
import {
  addReviewNotes,
  coalesceReviewNotes,
  openReviewNotesPrompt,
  resolveReviewFindings,
  resolveReviewedNotes,
  reviewFindings,
  reviewRepairStop,
} from "../src/features/tasks/model/taskReviewNotes";
import {
  createHostWorktree,
  invalidateHostWorktrees,
  resolveHostWorktreeAsync,
} from "./git-worktrees";
import { taskWorkspace } from "./task-workspace";
import { transferTaskArtifacts } from "./task-artifacts";
import { cleanupTaskWorktree } from "./task-worktree-cleanup";
import { resolve } from "node:path";
import { parseTaskWorkspace } from "../src/features/tasks/model/taskWorkspace";
import type { HostGoal } from "../src/features/tasks/model/hostGoals";
import { HostLimits } from "./limits";
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

const TICK_MS = 30_000;
/** How many tasks a machine works on at once until its owner changes it. */
export const MAX_RUNNING_TASKS = DEFAULT_MAX_RUNNING_TASKS;
/** How long a task's check command may run. */
export const VERIFY_TIMEOUT_MS = 15 * 60_000;
const VERIFY_OUTPUT_LIMIT = 4000;
const DIFF_STAT_LIMIT = 2000;
const RETRY_FEEDBACK_LIMIT = 12_000;
const SHARED_EDITS_LIMIT = 60;
export const MAX_REPAIR_ATTEMPTS = 3;

/** Consume bounded I/O batches in legacy order, including errors and limits. */
async function fingerprintPaths(
  hash: ReturnType<typeof createHash>,
  cwd: string,
  names: string[],
  budget: { entries: number; bytes: number },
  pending?: string[],
): Promise<boolean> {
  for (let offset = 0; offset < names.length;) {
    const count = Math.min(8, pending ? 2000 - budget.entries : 8);
    if (!count) return false;
    const batch = names.slice(offset, offset + count);
    offset += batch.length;
    const metadata = await Promise.allSettled(batch.map((name) => lstat(join(cwd, name))));
    const reads: Array<{ name: string; result: Promise<PromiseSettledResult<Buffer>> }> = [];
    let stop: { error: unknown } | { limit: true } | undefined;
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

class MergeConflict extends Error {
  constructor(
    message: string,
    readonly conflicts: string[],
  ) {
    super(message);
  }
}

class UnresolvedMerge extends Error {}

class ReplacedHistory extends MergeConflict {}

async function git(cwd: string, args: string[], timeout = 30_000): Promise<string> {
  const stdout = await runGitText(args, {
    cwd,
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout.trim();
}

/** What git said when a command failed, on one line. */
function gitError(error: unknown): string {
  const stderr = (error as { stderr?: unknown } | null)?.stderr;
  const text = typeof stderr === "string" && stderr.trim() ? stderr : "";
  return (text || errorMessage(error)).trim().split(/\r?\n/).at(-1)!.trim();
}

function available(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The branch and commit a project checkout is on, or null when the folder is
 * not the top of a git working copy. Throws when it is one a task branch
 * cannot start from or be merged back into. */
async function checkoutBase(cwd: string): Promise<{ baseBranch: string } | null> {
  try {
    const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
    if (realpathSync.native(top) !== realpathSync.native(cwd)) return null;
  } catch {
    return null;
  }
  try {
    await git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  } catch {
    throw new Error(
      "This project has no commits yet. Commit once, or turn off “Run on its own branch”.",
    );
  }
  try {
    return {
      baseBranch: await git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    };
  } catch {
    throw new Error(
      "This project is not on a branch. Check one out, or turn off “Run on its own branch”.",
    );
  }
}

/** Commits whatever the agent left uncommitted, so the task branch holds the
 * whole result. */
async function commitLeftovers(cwd: string, branch: string, title: string): Promise<void> {
  const current = await git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => "");
  if (current !== branch)
    throw new Error(
      `The agent left the working copy on ${current || "no branch"} instead of ${branch}.`,
    );
  if (!(await git(cwd, ["status", "--porcelain"]))) return;
  if (await git(cwd, ["diff", "--name-only", "--diff-filter=U"]))
    throw new UnresolvedMerge("Unresolved merge conflicts remain; the task's work is retained.");
  try {
    await git(cwd, ["add", "-A"]);
    await git(cwd, ["commit", "-q", "-m", title], 120_000);
  } catch (error) {
    throw new Error(`Could not commit the agent’s changes: ${gitError(error)}`);
  }
}

/** Merges a task branch into the branch it started from, in the project
 * checkout. Throws, leaving the checkout as it was, when it cannot. */
async function mergeTaskBranch(cwd: string, branch: string, baseBranch: string): Promise<void> {
  const current = await git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => "");
  if (current !== baseBranch)
    throw new Error(
      `The project is on ${current || "no branch"}. Check out ${baseBranch} there, then merge again.`,
    );
  if (await git(cwd, ["rev-parse", "--verify", "MERGE_HEAD"]).catch(() => ""))
    throw new Error(
      "The project already has a merge in progress. Finish it before delivery retries.",
    );
  // Validate refs separately: a missing ref or Git failure is not evidence of
  // replaced history and must never trigger an automatic replay.
  await git(cwd, ["rev-parse", "--verify", `${branch}^{commit}`]);
  try {
    await git(cwd, ["merge-base", "HEAD", branch]);
  } catch (error) {
    if ((error as { code?: unknown }).code !== 1) throw error;
    throw new ReplacedHistory(
      `${branch} has no common history with ${baseBranch}. The host will replay the recorded task changes in a separate checkout and verify them before delivery.`,
      [],
    );
  }
  // The owner's uncommitted edits stay where they are. Git merges around dirty
  // files it does not touch; when the merge would touch one of them, delivery
  // is blocked instead of stashing or reverting the owner's work.
  const overlap = await overlappingEdits(cwd, branch);
  if (overlap.length)
    throw new Error(
      `Uncommitted edits in ${baseBranch} overlap files this task changes (${overlap.join(", ")}). Commit or stash them, then merge again. Nothing was merged.`,
    );
  try {
    await git(cwd, ["merge", "--no-ff", "--no-edit", branch], 120_000);
  } catch (error) {
    const conflicts = await git(cwd, ["diff", "--name-only", "--diff-filter=U"]).catch(() => "");
    if (await git(cwd, ["rev-parse", "--verify", "MERGE_HEAD"]).catch(() => ""))
      await git(cwd, ["merge", "--abort"]);
    if (conflicts)
      throw new MergeConflict(
        `${branch} conflicts with ${baseBranch} in ${conflicts.split(/\r?\n/).join(", ")}. Nothing was merged.`,
        conflicts.split(/\r?\n/),
      );
    throw new Error(`Could not merge ${branch}: ${gitError(error)}`);
  }
}

/** Files the merge of `branch` would change that the checkout also has
 * uncommitted edits to, including untracked files the merge would create. */
async function overlappingEdits(cwd: string, branch: string): Promise<string[]> {
  const read = (args: string[]) =>
    runGitText(args, { cwd, timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  const incoming = (await read(["diff", "--no-renames", "-z", "--name-only", `HEAD...${branch}`]))
    .split("\0")
    .filter(Boolean);
  if (!incoming.length) return [];
  // Untracked and staged entries are listed too; renames contribute both paths.
  const entries = (await read(["status", "--porcelain", "-z", "--untracked-files=all"])).split(
    "\0",
  );
  const dirty = new Set<string>();
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!entry) continue;
    dirty.add(entry.slice(3));
    if (entry[0] === "R" || entry[0] === "C") dirty.add(entries[++index] ?? "");
  }
  return incoming.filter((path) => dirty.has(path));
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
      `Work only in ${task.worktreeCwd ?? projectCwd}${task.branch ? ` on ${task.branch}` : ""}. The host owns delivery; retain all existing work.`,
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
            `You are working in ${task.worktreeCwd}, a separate checkout of the project at ${projectCwd}${task.branch ? ` on the branch ${task.branch}` : ""}. Make every change in this folder. Do not edit, commit in or switch branches in ${projectCwd}: paths under it in the task below mean the same files under this folder.`,
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
  blocks: ReturnType<HostStore["session"]>["session"]["blocks"],
): ReturnType<typeof parseReviewVerdict> {
  return parseReviewVerdict(reviewerReply(blocks));
}

function reviewerReply(blocks: ReturnType<HostStore["session"]>["session"]["blocks"]): string {
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
  /** Verifications in progress, by task. A task keeps one at most. */
  private readonly jobs = new Map<string, Promise<void>>();
  /** Tasks being merged. */
  private readonly delivering = new Set<string>();
  private readonly mergingProjects = new Set<string>();
  /** Runs on every tick once running tasks are settled, before queued ones
   * start, so work it queues can start in the same tick. */
  private beforeStart?: () => Promise<void> | void;
  /** This machine's work limits and its ledger of agent time, shared with
   * goals and stewards. */
  readonly limits: HostLimits;

  constructor(
    private readonly store: HostStore,
    private readonly engine: SessionRunEngine,
    private readonly now: () => number = Date.now,
    private readonly verifyTimeoutMs = VERIFY_TIMEOUT_MS,
  ) {
    store.db.exec("CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, value TEXT NOT NULL);");
    this.limits = new HostLimits(store, now);
    this.limits.track(() =>
      Array.from(this.taskIndex().values()).flatMap((task) =>
        task.status === "running"
          ? [task.startedAt ?? task.createdAt]
          : task.status === "verifying" && task.reviewer
            ? [task.reviewer.startedAt]
            : [],
      ),
    );
  }

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Lets a layer on top of the board, such as goals, share its timer. */
  onTick(hook: () => Promise<void> | void): void {
    this.beforeStart = hook;
  }

  /** Resolves once no tick or verification is in progress. */
  async idle(): Promise<void> {
    while (this.ticking || this.jobs.size) await Promise.all([this.ticking, ...this.jobs.values()]);
  }

  /** Bumped by every task write or delete made through this board. */
  private revisionCounter = 0;
  onChange?: () => void;
  private etagCache?: { revision: number; etag: string };
  private listCache?: { revision: number; byId: Map<string, HostTask> };
  /** Live task state for one scheduler pass, maintained by write/delete. */
  private schedulerTasks?: Map<string, HostTask>;

  get revision(): number {
    return this.revisionCounter;
  }

  /**
   * Digest of what a remote client shows for the board. Recomputed only after
   * a task changed, so polling it does not parse every stored task.
   */
  changeEtag(): string {
    if (this.etagCache?.revision === this.revisionCounter) return this.etagCache.etag;
    const summaries = this.list().map((task) => ({
      id: task.id,
      status: task.status,
      updatedAt: task.updatedAt,
      sessionId: task.sessionId,
      runId: task.runId,
      error: typeof task.error === "string" ? task.error.slice(0, 512) : undefined,
    }));
    const etag = createHash("sha256").update(JSON.stringify(summaries)).digest("base64url");
    // list() may itself backfill review notes, which bumps the revision.
    this.etagCache = { revision: this.revisionCounter, etag };
    return etag;
  }

  /** Oldest first. */
  list(): HostTask[] {
    if (this.schedulerTasks)
      return Array.from(this.schedulerTasks.values()).sort((a, b) => a.createdAt - b.createdAt);
    const tasks = this.store.db
      .prepare("SELECT value FROM tasks")
      .all()
      .map((row) => JSON.parse(String(row.value)) as HostTask)
      .map((task) => this.withReviewNotes(task))
      .sort((a, b) => a.createdAt - b.createdAt);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    // Review-note backfills above can themselves bump the revision.
    this.listCache = { revision: this.revisionCounter, byId };
    return tasks;
  }

  /** Shared read-only index; task writes invalidate the revision cache. */
  taskIndex(): ReadonlyMap<string, HostTask> {
    if (this.schedulerTasks) return this.schedulerTasks;
    if (this.listCache?.revision !== this.revisionCounter) this.list();
    return this.listCache!.byId;
  }

  /** Keep the live pass consistent with an atomic task/goal batch on rollback. */
  transaction<T>(operation: () => T): T {
    const pass = this.schedulerTasks;
    const before = pass ? new Map(pass) : undefined;
    try {
      return this.store.transaction(operation);
    } catch (error) {
      this.listCache = undefined;
      if (pass && before) {
        pass.clear();
        for (const [id, task] of before) pass.set(id, task);
      }
      throw error;
    }
  }

  /** Re-evaluate existing work and acceptance blockers without a worker rerun. */
  recheckReview(id: string): HostTask {
    const task = this.find(id);
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
    const next = this.write({
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
    this.verify(next);
    return next;
  }

  /** Adds a task to the queue, or as a to-do item when asked to, or edits one
   * that is not running or finished. An edit keeps the task's status. */
  save(raw: unknown): HostTask {
    const input = parseHostTask(raw);
    const graph = this.schedulerTasks
      ? new Map(this.schedulerTasks)
      : new Map(this.list().map((task) => [task.id, task]));
    graph.set(input.id, input as HostTask);
    const cycle = this.dependencyCycle(input.id, graph);
    if (cycle)
      throw new Error(
        `Task dependency cycle: ${cycle.join(" -> ")}. Remove a dependency to continue.`,
      );
    const requested = (raw as { status?: unknown }).status;
    if (requested !== undefined && !isNewTaskStatus(requested))
      throw new Error("A new task starts as to do or queued.");
    const now = this.now();
    const previous = this.find(input.id);
    if (!previous) {
      const status = requested ?? "queued";
      if (status === "queued" && !input.prompt.trim()) throw new Error(EMPTY_PROMPT_ERROR);
      this.store.project(input.projectId);
      return this.write({
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
    this.store.project(previous.projectId);
    const {
      verifyCommand,
      autoMerge,
      continueUntilDone,
      workspace: _workspace,
      ...kept
    } = previous;
    return this.write({
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
  }

  /** Called by the goal's transaction; preserves task identity, checks and recovery gates. */
  updateGoalSettings(
    goalId: string,
    taskIds: readonly string[],
    settings: { autoMerge?: boolean; continueUntilDone?: boolean; maxRunMinutes?: number },
  ): void {
    if (!Object.keys(settings).length) return;
    for (const id of taskIds) {
      const task = this.find(id);
      if (!task || task.goalId !== goalId || task.status === "done") continue;
      if (this.delivering.has(id)) throw new Error("A goal task is being merged. Try again later.");
      const active = task.status === "running" || task.status === "verifying";
      const changedContinue =
        settings.continueUntilDone !== undefined &&
        Boolean(task.continueUntilDone) !== settings.continueUntilDone;
      this.write({
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
  }

  /** Moving a reviewed task to done merges its branch; that can fail, and the
   * task then stays in review. */
  async move(id: string, to: unknown): Promise<HostTask> {
    if (this.delivering.has(id)) throw new Error("This task is being merged.");
    const task = this.find(id);
    if (!task) throw new Error("Task not found.");
    if (!isTaskStatus(to)) throw new Error("Invalid task status");
    if (!canMoveTask(task.status, to))
      throw new Error(`A ${task.status} task cannot be moved to ${to}.`);
    const now = this.now();
    if (to === "queued" && !task.prompt.trim()) throw new Error(EMPTY_PROMPT_ERROR);
    if (to === "queued" && canTakeOverBlockedTask(task)) return this.queueTakeover(task, now);
    if (to === "queued" && taskRequiresInstructions(task)) throw new Error(TASK_INPUT_REQUIRED);
    if (to === "todo" && task.status === "queued") {
      // Only a task nothing has run for can be pulled back.
      if (task.sessionId || task.startedAt || hasUnmergedBranch(task))
        throw new Error("This task already started, so it cannot go back to To do.");
      return this.write({ ...task, status: "todo", updatedAt: now });
    }
    if (to === "done" && task.status === "todo") {
      if (hasUnmergedBranch(task))
        throw new Error(
          `This task’s earlier work is on ${task.branch}. Run it again to review and merge that, or delete it to discard.`,
        );
      // The owner did it by hand: nothing ran, so there is nothing to merge.
      return this.write({
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
        diffStat,
        mergeError,
        mergeRetry,
        autoMerged,
        mergedAt,
        deliveredCommit: _deliveredCommit,
        ...rest
      } = task;
      if (!task.merged)
        return this.write({
          ...rest,
          ...(rest.mergeRepair ? { mergeRepair: { ...rest.mergeRepair, attempts: 0 } } : {}),
          retryFeedback: this.retryFeedback(task),
          repairAttempts: task.repairAttempts,
          repairNote: task.repairNote,
          repairStop: task.repairStop,
          status: to,
          updatedAt: now,
        });
      const {
        branch,
        worktreeCwd,
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
      return this.write({ ...fresh, status: to, updatedAt: now });
    }
    if (to === "blocked") {
      if (task.status === "verifying") {
        // A check command still running finishes unheard.
        this.jobs.delete(id);
        if (
          task.reviewer &&
          sessionRunState(this.store, task.reviewer, 0, now).state === "running"
        ) {
          cancelSessionRun(this.engine, task.reviewer);
          this.limits.record(task.reviewer.startedAt, now);
        }
        return this.block({ ...task, deliveryRequested: undefined }, STOPPED_BY_USER, now);
      }
      const run = { ...task, startedAt: task.startedAt ?? task.createdAt };
      if (sessionRunState(this.store, run, 0, now).state === "running") {
        cancelSessionRun(this.engine, run);
        this.limits.record(run.startedAt, now);
      }
      return this.block({ ...task, deliveryRequested: undefined }, STOPPED_BY_USER, now);
    }
    if (to === "done" && hasUnmergedBranch(task)) {
      try {
        await this.recoverMerge(task, now, false);
      } catch (error) {
        const latest = this.find(id);
        if (latest?.status === "review") this.write({ ...latest, mergeError: errorMessage(error) });
        throw error;
      }
      await this.tick();
      return this.get(id)!;
    }
    return this.write({
      ...task,
      status: to,
      updatedAt: now,
    });
  }

  /** Owner start requests retain scheduler limits and dependency gates. */
  async startTask(id: string): Promise<HostTask> {
    let task = this.get(id);
    if (!task) throw new Error("Task not found.");
    if (task.goalId) {
      if (this.owningGoal(task.goalId)?.status === "cancelled")
        throw new Error(
          "This goal was cancelled. Create a new task to continue its retained work.",
        );
    }
    if (task.status !== "queued") task = await this.move(id, "queued");
    const ordered = this.list().filter((item) => item.status === "queued" && item.id !== id);
    this.transaction(() => {
      this.write({ ...task, position: 0, updatedAt: this.now() });
      ordered.forEach((item, index) =>
        this.write({ ...item, position: index + 1, updatedAt: this.now() }),
      );
    });
    await this.tick();
    return this.get(id)!;
  }

  reorder(ids: unknown): HostTask[] {
    if (
      !Array.isArray(ids) ||
      ids.length > 1000 ||
      ids.some((id) => typeof id !== "string") ||
      new Set(ids).size !== ids.length
    )
      throw new Error("Invalid task order");
    const tasks = ids.map((id) => this.get(id));
    if (tasks.some((task) => !task)) throw new Error("Task not found.");
    if (tasks.some((task) => !["todo", "queued"].includes(task!.status)))
      throw new Error("Only queued or to-do tasks can be reordered");
    if (tasks.some((task) => task!.status !== tasks[0]!.status))
      throw new Error("Reorder tasks within one status");
    return this.transaction(() =>
      tasks.map((task, position) => this.write({ ...task!, position, updatedAt: this.now() })),
    );
  }

  /** Retarget a reviewed result without launching another worker. */
  async retarget(id: string, raw: unknown, autoMerge?: unknown): Promise<HostTask> {
    const task = this.get(id);
    if (!task || task.status !== "review" || !hasUnmergedBranch(task))
      throw new Error("Only a reviewed branch can change its delivery target.");
    if (this.delivering.has(id) || this.mergingProjects.has(task.projectId))
      throw new Error("Wait for the current delivery to finish.");
    if (autoMerge !== undefined && typeof autoMerge !== "boolean")
      throw new Error("Invalid merge option");
    if (raw === undefined && autoMerge !== undefined)
      return this.write({ ...task, autoMerge, mergeRetry: undefined, updatedAt: this.now() });
    const workspace = parseTaskWorkspace(raw);
    const project = this.store.project(task.projectId);
    const target = await taskWorkspace(
      project.cwd,
      workspace ?? {
        checkoutCwd: task.deliveryCwd,
        baseBranch: task.baseBranch,
      },
    );
    if (workspace?.branchName || target.cwd === task.worktreeCwd)
      throw new Error("Choose a delivery worktree separate from the task branch");
    if (this.get(id)?.updatedAt !== task.updatedAt)
      throw new Error("Task changed; refresh before choosing a target.");
    const selected = { checkoutCwd: target.cwd, baseBranch: target.branch };
    return this.transaction(() => {
      // Pending dependent work must inherit the same integration target.
      if (task.goalId) {
        for (const pending of this.list())
          if (
            pending.goalId === task.goalId &&
            pending.projectId === task.projectId &&
            ["todo", "queued"].includes(pending.status) &&
            !pending.startedAt &&
            !pending.branch
          )
            this.write({ ...pending, workspace: selected, updatedAt: this.now() });
        const goal = this.owningGoal(task.goalId);
        if (goal) {
          this.store.db.prepare("UPDATE goals SET value=? WHERE id=?").run(
            JSON.stringify({
              ...goal,
              workspaces: { ...goal.workspaces, [task.projectId]: selected },
              updatedAt: this.now(),
            }),
            task.goalId,
          );
        }
      }
      return this.write({
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

  /** A task whose branch was never merged is only deleted with `discard`,
   * which removes that branch and its worktree. */
  async delete(id: string, discard = false): Promise<void> {
    const task = this.find(id);
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
    this.store.db.prepare("DELETE FROM tasks WHERE id=?").run(id);
    this.revisionCounter++;
    this.onChange?.();
    this.listCache = undefined;
    this.schedulerTasks?.delete(id);
  }

  get(id: string): HostTask | undefined {
    return this.find(id);
  }

  /** Acknowledge precisely the notes shown by a desktop, preserving newer notes. */
  readNotes(id: string, rawIds: unknown): HostTask {
    const task = this.find(id);
    if (!task) throw new Error("Task not found.");
    if (
      !Array.isArray(rawIds) ||
      rawIds.length > 10_000 ||
      rawIds.some((id) => typeof id !== "string")
    )
      throw new Error("Invalid review note IDs.");
    const ids = new Set(rawIds as string[]);
    if ([...ids].some((id) => !task.reviewNotes?.some((note) => note.id === id)))
      throw new Error("Review note not found.");
    if (!task.reviewNotes?.some((note) => ids.has(note.id) && note.readAt === undefined))
      return task;
    const now = this.now();
    return this.write({
      ...task,
      reviewNotes: task.reviewNotes?.map((note) =>
        ids.has(note.id) && note.readAt === undefined ? { ...note, readAt: now } : note,
      ),
      updatedAt: now,
    });
  }

  /** Note status is bookkeeping, never task completion or merge approval. */
  resolveNote(id: string, noteId: unknown, resolved: unknown): HostTask {
    const task = this.find(id);
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
    return this.write({
      ...task,
      reviewNotes: task.reviewNotes.map((note) =>
        note.id === noteId
          ? { ...note, resolvedAt: resolved ? now : undefined, updatedAt: now }
          : note,
      ),
      updatedAt: now,
    });
  }

  /** Recover old review failures only when their owning goal is still active.
   * Re-read the reviewer evidence; never revive an owner stop or failed runtime. */
  recoverGoalReview(id: string, goalId: string): HostTask | undefined {
    const task = this.find(id);
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
      const session = this.store.session(review.sessionId);
      const verdict = reviewerVerdict(session.session.blocks);
      const last = session.session.blocks.at(-1);
      if (
        session.status !== "idle" ||
        last?.role === "system" ||
        verdict.verdict !== "fail" ||
        verdict.note !== review.note
      )
        return task;
      return this.repairOrBlock(task, task.error, this.now());
    } catch {
      return task;
    }
  }

  /** Stops a running or verifying task as Stop does, and blocks a queued one
   * with `reason`. Anything else is left as it is. */
  async cancel(id: string, reason: string): Promise<void> {
    const task = this.find(id);
    if (task?.status === "running" || task?.status === "verifying") await this.move(id, "blocked");
    else if (
      task?.status === "queued" ||
      (task?.status === "review" && (task.autoMerge || task.deliveryRequested))
    )
      this.block({ ...task, deliveryRequested: undefined }, reason, this.now());
  }

  /** Settles running and verifying tasks, stops those past their time limit,
   * then starts queued ones while there is room. A tick already in progress
   * is not joined by a second one. */
  tick(): Promise<void> {
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
    const initial = this.list();
    const byId = this.listCache!.byId;
    this.schedulerTasks = byId;
    const hasUnfinishedDependencies = (task: HostTask) =>
      (task.dependsOn ?? []).some((id) => {
        const dependency = byId.get(id);
        return dependency !== undefined && dependency.status !== "done";
      });
    // A newly failed task remains visibly blocked until the next scheduler tick.
    const takeoverCandidates = new Set(
      initial.filter(canTakeOverBlockedTask).map((task) => task.id),
    );
    for (const task of initial) {
      try {
        const cycle = task.status === "queued" ? this.dependencyCycle(task.id, byId) : undefined;
        if (cycle)
          this.block(
            task,
            `Task dependency cycle: ${cycle.join(" -> ")}. Edit the dependencies before requeuing.`,
            now,
          );
        else if (
          task.status === "blocked" &&
          task.error === HOST_INTERRUPTED &&
          this.canResumeAfterHostStop(task)
        )
          this.requeueInterrupted(task, now);
        else if (task.status === "running") this.settle(task, now);
        else if (task.status === "verifying") await this.settleVerification(task, now);
        else if (
          task.status === "review" &&
          (task.autoMerge || task.deliveryRequested) &&
          hasUnmergedBranch(task)
        )
          await this.recoverMerge(task, now);
        else if (
          task.status === "done" &&
          task.merged &&
          !this.delivering.has(task.id) &&
          (task.worktreeCwd || task.historyRecovery?.some((entry) => entry.worktreeCwd))
        ) {
          this.delivering.add(task.id);
          try {
            await this.cleanupDelivered(task, now);
          } finally {
            this.delivering.delete(task.id);
          }
        }
      } catch (error) {
        console.error("Could not settle a task:", errorMessage(error));
      }
    }
    try {
      await this.beforeStart?.();
    } catch (error) {
      console.error("Could not update goals:", errorMessage(error));
    }
    const tasks = Array.from(byId.values()).sort(
      (a, b) => (a.position ?? a.createdAt) - (b.position ?? b.createdAt),
    );
    const active = tasks.filter((task) => task.status === "running" || task.status === "verifying");
    const { maxRunningTasks } = this.limits.settings();
    for (const candidate of tasks) {
      // An awaited launch may have allowed edits/deletions to later tasks.
      let task = byId.get(candidate.id);
      if (!task) continue;
      if (active.length >= maxRunningTasks) break;
      if (
        takeoverCandidates.has(task.id) &&
        canTakeOverBlockedTask(task) &&
        this.takeoverGoalActive(task)
      ) {
        if (this.limits.reached() || hasUnfinishedDependencies(task)) continue;
        task = this.queueTakeover(task, now);
      }
      if (task.status !== "queued") continue;
      if (task.goalId) {
        const goal = this.owningGoal(task.goalId);
        if (goal?.status === "cancelled") continue;
        if (
          goal?.maxRunningTasks &&
          active.filter((item) => item.goalId === task.goalId).length >= goal.maxRunningTasks
        )
          continue;
      }
      if (taskRequiresInstructions(task)) {
        this.block(task, TASK_INPUT_REQUIRED, now);
        continue;
      }
      // Used-up daily time holds queued work back; running work finishes.
      if (this.limits.reached()) break;
      // A task waits for every task it depends on to be merged, and then
      // starts from the project as it is, with their work in it.
      if (hasUnfinishedDependencies(task)) continue;
      try {
        const started = await this.launch(task, now, active);
        if (started.status === "running" || started.status === "verifying") active.push(started);
      } catch (error) {
        console.error("Could not start a task:", errorMessage(error));
      }
    }
  }

  private find(id: string): HostTask | undefined {
    const row = this.store.db.prepare("SELECT value FROM tasks WHERE id=?").get(id);
    return row ? this.withReviewNotes(JSON.parse(String(row.value)) as HostTask) : undefined;
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

  private owningGoal(id: string): HostGoal | undefined {
    if (
      !this.store.db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='goals'")
        .get()
    )
      return undefined;
    const row = this.store.db.prepare("SELECT value FROM goals WHERE id=?").get(id);
    return row ? (JSON.parse(String(row.value)) as HostGoal) : undefined;
  }

  private takeoverGoalActive(task: HostTask): boolean {
    if (!task.goalId) return true;
    if (
      !this.store.db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='goals'")
        .get()
    )
      return true;
    const row = this.store.db.prepare("SELECT value FROM goals WHERE id=?").get(task.goalId);
    return !row || JSON.parse(String(row.value)).status !== "cancelled";
  }

  private queueTakeover(task: HostTask, now: number): HostTask {
    return this.write({
      ...task,
      status: "queued",
      blockedTakeover: {
        at: now,
        previousSessionId: task.sessionId,
        blocker: task.error ?? "Verification failed.",
      },
      retryFeedback: this.retryFeedback(task),
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
  private withReviewNotes(task: HostTask): HostTask {
    if (task.reviewNotes !== undefined) {
      const notes = coalesceReviewNotes(task.reviewNotes);
      return notes.length === task.reviewNotes.length
        ? task
        : this.write({ ...task, reviewNotes: notes });
    }
    const review = task.verification?.review;
    let notes: HostTask["reviewNotes"] = [];
    if (review) {
      try {
        const session = this.store.session(review.sessionId);
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
    return this.write({ ...task, reviewNotes: notes });
  }

  private write(task: HostTask): HostTask {
    this.store.db
      .prepare("INSERT INTO tasks VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value")
      .run(task.id, JSON.stringify(task));
    this.revisionCounter++;
    this.onChange?.();
    this.listCache = undefined;
    this.schedulerTasks?.set(task.id, task);
    return task;
  }

  private block(task: HostTask, error: string, now: number): HostTask {
    return this.write({
      ...task,
      status: "blocked",
      error,
      needsInput: taskRequiresInstructions({ ...task, status: "blocked", error }) || undefined,
      reviewer: undefined,
      completedAt: now,
      updatedAt: now,
    });
  }

  /** Correct failed deliverables in unattended work without releasing dependencies.
   * Runtime failures, cancellation, missing verdicts and unavailable checks stay stopped. */
  private repairOrBlock(task: HostTask, error: string, now: number): HostTask {
    if (task.blockedTakeover && !task.continueUntilDone)
      return this.block(
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
    if (task.repairStop || task.reviewOnly) return this.block(task, error, now);
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
      return this.block(
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
    return this.write({
      ...task,
      status: "queued",
      retryFeedback: this.retryFeedback(failed),
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
  private canResumeAfterHostStop(run: {
    sessionId?: string;
    runId?: string;
    error?: string;
  }): boolean {
    if (run.error && run.error !== HOST_INTERRUPTED) return false;
    try {
      const session = this.store.session(run.sessionId ?? "");
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

  private requeueInterrupted(task: HostTask, now: number): HostTask {
    // Retain the session, branch, working copy and any previous check feedback.
    // The ordinary scheduler still enforces dependencies, concurrency and limits.
    return this.write({
      ...task,
      status: "queued",
      error: undefined,
      completedAt: undefined,
      needsInput: undefined,
      updatedAt: now,
    });
  }

  /** Capture failed checks before a retry clears the verification record. */
  private retryFeedback(task: HostTask): string | undefined {
    const { command, review } = task.verification ?? {};
    const failedCommand = command && (command.timedOut || command.exitCode !== 0);
    if (review?.verdict !== "fail" && !failedCommand) return task.retryFeedback;
    const parts = [task.error ?? "Previous verification failed."];
    if (failedCommand) {
      parts.push(`Check command: ${task.verifyCommand ?? ""}`, command.output);
    }
    if (review?.verdict === "fail") {
      parts.push(`Reviewer finding: ${review.note}`);
      const structured = (task.reviewNotes ?? []).filter(
        (note) => note.kind === "finding" && note.resolvedAt === undefined,
      );
      if (structured.length && structured.every((note) => !note.details))
        return parts.join("\n\n").slice(0, RETRY_FEEDBACK_LIMIT);
      try {
        const blocks = this.store.session(review.sessionId).session.blocks;
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
    const project = this.store.project(task.projectId);
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
      const dependency = this.schedulerTasks ? this.schedulerTasks.get(id) : this.find(id);
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
    const base = await checkoutBase(targetCwd);
    if (!base) {
      throw new Error(
        "Cannot create an isolated task workspace here. Open the Git repository root and verify Git can read it, or turn off “Run on its own branch”.",
      );
    }
    const branch = task.workspace?.branchName ?? `mc/${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const tree = await createHostWorktree(targetCwd, branch, "HEAD", false);
    return {
      ...task,
      branch,
      worktreeCwd: tree.path,
      baseBranch: base.baseBranch,
      baseCommit: tree.head,
      deliveryCwd: targetCwd,
    };
  }

  private async launch(
    task: HostTask,
    now: number,
    active: readonly HostTask[],
  ): Promise<HostTask> {
    let ready: HostTask;
    try {
      ready = await this.workingCopy(task);
    } catch (error) {
      if (this.find(task.id)?.updatedAt !== task.updatedAt) return task;
      return this.block({ ...task, startedAt: now }, errorMessage(error), now);
    }
    // The task may have been edited or deleted while its worktree was made.
    if (this.find(task.id)?.updatedAt !== task.updatedAt) {
      if (ready.branch && !task.branch) await this.discard(ready);
      return task;
    }
    if (ready.branch && !ready.dependencyArtifactsPrepared) {
      try {
        for (const id of ready.dependsOn ?? []) {
          const dependency = this.schedulerTasks ? this.schedulerTasks.get(id) : this.find(id);
          if (dependency?.projectId !== ready.projectId) continue;
          const source = dependency.deliveryCwd ?? this.store.project(ready.projectId).cwd;
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
        return this.block(ready, errorMessage(error), now);
      }
    }
    // Legacy non-isolated fallbacks retain serialization. Explicit direct tasks
    // may share a checkout within the owner's configured concurrency limits.
    if (
      ready.isolate !== false &&
      active.some(
        (other) =>
          (other.worktreeCwd ?? this.store.project(other.projectId).cwd) ===
          (ready.worktreeCwd ?? this.store.project(ready.projectId).cwd),
      )
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
              if (this.find(task.id)?.updatedAt !== task.updatedAt)
                return this.find(task.id) ?? task;
              task = this.write({
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
                120_000,
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
          if (ready.mergeRepair!.replayCommit)
            await commitLeftovers(cwd, ready.branch!, `Recover delivery: ${ready.title}`);
          if (this.find(task.id)?.updatedAt !== task.updatedAt) return this.find(task.id) ?? task;
          const next = this.write({
            ...ready,
            status: "verifying",
            updatedAt: now,
          });
          this.verify(next);
          return next;
        }
      } catch (error) {
        if (this.find(task.id)?.updatedAt !== task.updatedAt) return this.find(task.id) ?? task;
        return this.block(ready, errorMessage(error), now);
      }
    }
    const projectCwd = this.store.project(ready.projectId).cwd;
    const sharedEdits = ready.worktreeCwd ? await this.sharedEdits(projectCwd) : [];
    if (this.find(task.id)?.updatedAt !== task.updatedAt) return this.find(task.id) ?? task;
    const started = this.canResumeAfterHostStop(ready)
      ? this.resumeInterrupted(ready)
      : launchSessionRun(this.store, this.engine, {
          ...ready,
          prompt: workerPrompt(ready, projectCwd, sharedEdits),
        });
    const next = {
      ...ready,
      awaitingOwnerRestart: undefined,
      sessionId: started.sessionId,
      runId: started.runId,
      startedAt: now,
    };
    if (started.error !== undefined) return this.block(next, started.error, now);
    return this.write({ ...next, status: "running", updatedAt: now });
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

  private resumeInterrupted(task: HostTask): {
    sessionId?: string;
    runId?: string;
    error?: string;
  } {
    try {
      const session = this.store.session(task.sessionId!).session;
      // A queued recovery can be edited, or its worktree recreated elsewhere.
      // Never resume a conversation configured for a different folder or model.
      if (
        session.cwd !== (task.worktreeCwd ?? this.store.project(task.projectId).cwd) ||
        session.harness !== task.harness ||
        session.model !== task.model ||
        session.runtimeMode !== task.runtimeMode ||
        JSON.stringify(session.modelSettings) !== JSON.stringify(task.modelSettings)
      ) {
        return launchSessionRun(this.store, this.engine, {
          ...task,
          prompt: workerPrompt(task, this.store.project(task.projectId).cwd),
        });
      }
      this.engine.command({
        type: "send",
        commandId: randomUUID(),
        sessionId: task.sessionId!,
        text: [
          "The host stopped before this task finished. Continue this task from the existing conversation and working copy. Inspect the current changes and the last tool results first; keep completed work and do not start over. Completion still requires the original task's checks and review.",
          "",
          workerPrompt(task, this.store.project(task.projectId).cwd),
        ].join("\n"),
      });
      return {
        sessionId: task.sessionId,
        runId: this.store.session(task.sessionId!).runId,
      };
    } catch (error) {
      return { sessionId: task.sessionId, error: errorMessage(error) };
    }
  }

  private settle(task: HostTask, now: number): void {
    const outcome = sessionRunState(
      this.store,
      { ...task, startedAt: task.startedAt ?? task.createdAt },
      task.maxRunMinutes,
      now,
    );
    if (outcome.state === "running") {
      if (outcome.needsInput !== Boolean(task.needsInput))
        this.write({
          ...task,
          needsInput: outcome.needsInput || undefined,
          updatedAt: now,
        });
    } else if (outcome.state === "overLimit") {
      // The reason is saved first: the turn settles asynchronously, and a
      // later tick blocks the task with it.
      this.write({ ...task, error: outcome.error });
      cancelSessionRun(this.engine, task);
    } else if (outcome.status === "succeeded") {
      this.limits.record(task.startedAt ?? task.createdAt, now);
      this.verify(
        this.write({
          ...task,
          status: "verifying",
          needsInput: undefined,
          verification: undefined,
          updatedAt: now,
        }),
      );
    } else {
      this.limits.record(task.startedAt ?? task.createdAt, now);
      if (outcome.error === HOST_INTERRUPTED && this.canResumeAfterHostStop(task)) {
        this.requeueInterrupted(task, now);
        return;
      }
      this.block(
        task,
        outcome.status === "cancelled" ? STOPPED_BY_USER : (outcome.error ?? "The run failed."),
        now,
      );
    }
  }

  /** Runs the task's checks in the background: commits what the agent left,
   * runs the check command, then hands over to the reviewer or to review. */
  private verify(task: HostTask): void {
    const { id } = task;
    /** The task, while this job still owns its verification. */
    const current = () => {
      const latest = this.jobs.get(id) === job ? this.find(id) : undefined;
      return latest?.status === "verifying" ? latest : undefined;
    };
    const run = async () => {
      // Lets the job be registered before it first asks whether it owns the task.
      await null;
      const project = this.store.project(task.projectId);
      const cwd = task.worktreeCwd ?? project.cwd;
      if (hasUnmergedBranch(task)) await commitLeftovers(cwd, task.branch!, task.title);
      const verification: TaskVerification = {};
      if (task.verifyCommand) {
        const result = await runHostShell(cwd, task.verifyCommand, this.verifyTimeoutMs);
        verification.command = {
          exitCode: result.exitCode,
          output: result.output.slice(-VERIFY_OUTPUT_LIMIT),
          timedOut: result.timedOut,
        };
        if (result.timedOut || result.exitCode !== 0) {
          const workspace = task.continueUntilDone
            ? await this.workspaceFingerprint(task)
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
          const latest = current();
          if (latest)
            (result.timedOut || result.exitCode === null
              ? this.block.bind(this)
              : this.repairOrBlock.bind(this))(
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
        const latest = current();
        if (latest) await this.enterReview({ ...latest, verification, diffStat });
        return;
      }
      const latest = current();
      if (!latest) return;
      const now = this.now();
      const started = launchSessionRun(this.store, this.engine, {
        ...task,
        title: `Review: ${task.title}`.slice(0, 200),
        prompt: reviewPrompt(task),
      });
      const reviewing = {
        ...latest,
        verification,
        reviewer: {
          sessionId: started.sessionId,
          runId: started.runId,
          startedAt: now,
        },
      };
      if (started.error !== undefined)
        this.block(reviewing, `Could not start the reviewer: ${started.error}`, now);
      else this.write({ ...reviewing, updatedAt: now });
    };
    const job: Promise<void> = run()
      .catch((error) => {
        const latest = current();
        if (latest) {
          if (error instanceof UnresolvedMerge && latest.mergeRepair)
            this.repairOrBlock(
              { ...latest, retryFeedback: error.message },
              error.message,
              this.now(),
            );
          else this.block(latest, errorMessage(error), this.now());
        }
      })
      .catch((error) => console.error("Could not verify a task:", errorMessage(error)))
      .finally(() => {
        if (this.jobs.get(id) === job) this.jobs.delete(id);
      });
    this.jobs.set(id, job);
  }

  /** Follows a verifying task's reviewer to its verdict. */
  private async settleVerification(task: HostTask, now: number): Promise<void> {
    if (this.jobs.has(task.id)) return;
    if (!task.reviewer) {
      // The host stopped during the checks; they start over.
      this.verify(task);
      return;
    }
    if (task.reviewer.verdictRepairPending || task.reviewer.recoveryPending) {
      this.resumeReviewer(task, now);
      return;
    }
    const outcome = sessionRunState(this.store, task.reviewer, task.maxRunMinutes, now);
    if (outcome.state === "running") {
      if (outcome.needsInput !== Boolean(task.needsInput))
        this.write({
          ...task,
          needsInput: outcome.needsInput || undefined,
          updatedAt: now,
        });
      return;
    }
    if (outcome.state === "overLimit") {
      this.write({
        ...task,
        reviewer: { ...task.reviewer, error: outcome.error },
      });
      cancelSessionRun(this.engine, task.reviewer);
      return;
    }
    this.limits.record(task.reviewer.startedAt, now);
    if (outcome.error === HOST_INTERRUPTED && this.canResumeAfterHostStop(task.reviewer)) {
      // Retain the read-only review and its inspected evidence. A host stop
      // is not a failed verdict and must not spend a correction attempt.
      const next = this.write({
        ...task,
        reviewer: { ...task.reviewer, recoveryPending: true },
        needsInput: undefined,
        updatedAt: now,
      });
      this.resumeReviewer(next, now);
      return;
    }
    if (outcome.status === "cancelled") {
      this.block(task, STOPPED_BY_USER, now);
      return;
    }
    const sessionId = task.reviewer.sessionId ?? "";
    const review =
      outcome.status === "succeeded"
        ? reviewerVerdict(this.store.session(sessionId).session.blocks)
        : {
            verdict: "fail" as const,
            note: outcome.error ?? "The reviewer’s run failed.",
          };
    // A clean reviewer turn without the required machine-readable verdict is a
    // format failure, not evidence that the implementation is defective.
    if (
      outcome.status === "succeeded" &&
      review.note === NO_VERDICT &&
      task.continueUntilDone &&
      (task.reviewer.verdictRepairAttempts ?? 0) < 2
    ) {
      const pending = this.write({
        ...task,
        reviewer: { ...task.reviewer, verdictRepairPending: true },
        updatedAt: now,
      });
      this.resumeReviewer(pending, now);
      return;
    }
    const verification = {
      ...task.verification,
      review: { ...review, sessionId },
    };
    const findings =
      outcome.status === "succeeded"
        ? reviewFindings(reviewerReply(this.store.session(sessionId).session.blocks), review)
        : [];
    const previous = task.attemptHistory?.at(-1);
    const workspaceFingerprint = task.continueUntilDone
      ? await this.workspaceFingerprint(task)
      : undefined;
    const currentReview = this.find(task.id);
    if (
      currentReview?.status !== "verifying" ||
      currentReview.updatedAt !== task.updatedAt ||
      currentReview.reviewer?.runId !== task.reviewer.runId
    )
      return;
    // Repeating a broad finding while files are still changing is not itself
    // proof of a stalled correction. A repeated contents/finding pair is.
    const comparable =
      task.continueUntilDone && workspaceFingerprint
        ? task.attemptHistory?.findLast(
            (attempt) =>
              attempt.verdict === "fail" && attempt.workspaceFingerprint === workspaceFingerprint,
          )
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
        const blocks = this.store.session(task.sessionId).session.blocks;
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
                    reviewerReply(this.store.session(sessionId).session.blocks),
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
      (outcome.status === "succeeded" && review.note !== NO_VERDICT
        ? this.repairOrBlock.bind(this)
        : this.block.bind(this))(reviewed, `Review failed: ${review.note}`, now);
      return;
    }
    const diffStat = await this.diffStat(task);
    const latest = this.find(task.id);
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

  private resumeReviewer(task: HostTask, now: number): void {
    if (this.limits.reached()) return;
    try {
      const sessionId = task.reviewer!.sessionId!;
      const session = this.store.session(sessionId);
      const interrupted = task.reviewer!.recoveryPending;
      const last = session.session.blocks.at(-1);
      if (last?.role === "system" && last.text.trim() === STOPPED_BY_USER) {
        this.block(task, STOPPED_BY_USER, now);
        return;
      }
      if (
        session.runId !== task.reviewer!.runId ||
        (interrupted ? !this.canResumeAfterHostStop(task.reviewer!) : session.status !== "idle")
      ) {
        this.block(
          task,
          "The reviewer recovery no longer owns its recorded turn. Recheck the review to continue.",
          now,
        );
        return;
      }
      this.engine.command({
        type: "send",
        commandId: randomUUID(),
        sessionId,
        text:
          (interrupted
            ? "The host interrupted this review. Continue the unfinished review in the existing conversation, preserving the inspected evidence and completed checks. "
            : "") +
          "Complete the existing read-only review using the evidence already inspected. Do not edit files or launch an implementation worker. Include the concrete findings, then end with exactly VERDICT: PASS or VERDICT: FAIL - <specific reason>. Do not invent a passing verdict or claim unavailable checks passed.",
      });
      this.write({
        ...task,
        reviewer: {
          ...task.reviewer!,
          runId: this.store.session(sessionId).runId,
          startedAt: now,
          verdictRepairPending: undefined,
          recoveryPending: undefined,
          verdictRepairAttempts: (task.reviewer!.verdictRepairAttempts ?? 0) + Number(!interrupted),
        },
        updatedAt: now,
      });
    } catch (error) {
      this.block(task, `Could not resume the reviewer: ${errorMessage(error)}`, now);
    }
  }

  /** Moves a verified task to review. An isolated task set to merge on its
   * own is merged right away, when every configured check passed; it then goes
   * straight to done. When it cannot be merged it waits in review, with why. */
  private async enterReview(task: HostTask): Promise<HostTask> {
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
    if (task.isolate === false && !hasUnmergedBranch(task))
      return this.write({ ...reviewing, status: "done", mergeError: undefined });
    if (!(task.autoMerge || task.deliveryRequested) || !hasUnmergedBranch(task))
      return this.write(reviewing);
    const blocker = autoMergeBlocker(task);
    if (blocker) return this.write({ ...reviewing, mergeError: blocker });
    try {
      return await this.deliver(
        { ...task, retryFeedback: undefined, completedAt: now, updatedAt: now },
        Boolean(task.autoMerge),
      );
    } catch (error) {
      return this.write({ ...reviewing, mergeError: errorMessage(error) });
    }
  }

  /** Retry old/stale review cards without rerunning completed work. */
  private async recoverMerge(task: HostTask, now: number, auto = true): Promise<void> {
    const blocker = autoMergeBlocker(task);
    if (blocker) {
      if (!auto) throw new Error(blocker);
      return;
    }
    if (this.mergingProjects.has(task.projectId)) {
      if (!auto)
        throw new Error("Another task is being merged into this project. Delivery will retry.");
      return;
    }
    if (
      task.goalId &&
      this.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='goals'").get()
    ) {
      const owner = this.store.db.prepare("SELECT value FROM goals WHERE id=?").get(task.goalId);
      if (owner && JSON.parse(String(owner.value)).status === "cancelled") return;
    }
    const project = this.store.project(task.projectId);
    const cwd = await resolveHostWorktreeAsync(project.cwd, task.deliveryCwd);
    let baseHead = await git(cwd, ["rev-parse", "--verify", `${task.baseBranch}^{commit}`]);
    const fingerprint = createHash("sha256")
      .update(
        [
          baseHead,
          await git(cwd, ["rev-parse", "--verify", `${task.branch}^{commit}`]),
          await git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => ""),
          await git(cwd, ["status", "--porcelain"]),
        ].join("\n"),
      )
      .digest("hex");
    if (auto && task.mergeRetry?.fingerprint === fingerprint && now < task.mergeRetry.after) return;
    const current = this.find(task.id);
    if (current?.status !== "review" || current.updatedAt !== task.updatedAt) return;
    // Persist before attempting Git, so restarting a host cannot cause a hot loop.
    const retrying = this.write({
      ...task,
      ...(!auto ? { deliveryRequested: true } : {}),
      mergeRetry: { fingerprint, after: now + 5 * 60_000 },
    });
    try {
      await this.deliver(retrying, Boolean(task.autoMerge));
    } catch (error) {
      const latest = this.find(task.id);
      if (latest?.status !== "review" || latest.updatedAt !== retrying.updatedAt) return;
      if (!(error instanceof MergeConflict)) {
        if (!auto) throw error;
        return;
      }
      const attempts = task.mergeRepair?.attempts ?? 0;
      if (attempts >= MAX_REPAIR_ATTEMPTS) {
        this.block(
          {
            ...latest,
            repairStop: {
              reason: "limit",
              message: "Automatic integration correction limit reached. All work is retained.",
            },
          },
          error.message,
          now,
        );
        return;
      }
      let recovered = latest;
      let replayCommit: string | undefined;
      if (error instanceof ReplacedHistory) {
        try {
          if (!task.baseCommit)
            throw new Error(
              "The recorded task base is missing; work is retained and cannot be replayed safely.",
            );
          await git(cwd, ["merge-base", "--is-ancestor", task.baseCommit, task.branch!]);
          if (task.worktreeCwd && available(task.worktreeCwd)) {
            if (
              (await git(task.worktreeCwd, ["symbolic-ref", "--quiet", "--short", "HEAD"])) !==
                task.branch ||
              (await git(task.worktreeCwd, ["status", "--porcelain"]))
            )
              throw new Error(
                "The original task checkout changed after review. All work is retained; history recovery cannot overwrite it.",
              );
          }
          const head = await git(cwd, ["rev-parse", `${task.branch}^{commit}`]);
          // Flatten only the task's recorded delta, not every commit in the old
          // project history. Cherry-pick performs a three-way application.
          replayCommit = await git(cwd, [
            "commit-tree",
            `${head}^{tree}`,
            "-p",
            task.baseCommit,
            "-m",
            `Recover delivery: ${task.title}`,
          ]);
          const branch = `mc/${randomUUID().replace(/-/g, "").slice(0, 8)}`;
          const tree = await createHostWorktree(cwd, branch, task.baseBranch!, false);
          if (task.worktreeCwd) await transferTaskArtifacts(task.worktreeCwd, tree.path);
          // Use the actual captured target head if it advanced during recovery.
          recovered = {
            ...latest,
            branch,
            worktreeCwd: tree.path,
            historyRecovery: [
              ...(task.historyRecovery ?? []),
              {
                branch: task.branch!,
                worktreeCwd: task.worktreeCwd,
                baseCommit: task.baseCommit,
                head,
              },
            ],
          };
          // The replay checkout is pinned; later target changes are handled by
          // the ordinary integration correction flow.
          baseHead = tree.head;
        } catch (recoveryError) {
          this.block(
            { ...latest, repairStop: { reason: "external", message: errorMessage(recoveryError) } },
            errorMessage(recoveryError),
            now,
          );
          return;
        }
      }
      if (
        this.find(task.id)?.updatedAt !== retrying.updatedAt ||
        this.find(task.id)?.status !== "review"
      )
        return;
      this.write({
        ...recovered,
        status: "queued",
        mergeRepair: {
          baseHead,
          conflicts: error.conflicts,
          attempts: attempts + 1,
          replayCommit,
        },
        baseCommit: baseHead,
        sessionId: undefined,
        runId: undefined,
        reviewer: undefined,
        verification: undefined,
        startedAt: undefined,
        completedAt: undefined,
        retryFeedback: undefined,
        reviewOnly: undefined,
        mergeRetry: undefined,
        error: undefined,
        updatedAt: now,
      });
    }
  }

  /** What the task branch changes since it left the project's branch. */
  /** Content evidence for retry progress. Prefer Git's tracked tree and diff;
   * small non-Git project folders use a bounded scan, never following links. */
  private async workspaceFingerprint(task: HostTask): Promise<string | undefined> {
    const cwd = task.worktreeCwd ?? this.store.project(task.projectId).cwd;
    const hash = createHash("sha256");
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
      const stat = await git(this.store.project(task.projectId).cwd, [
        "diff",
        "--stat",
        `${task.baseCommit}...${task.branch}`,
      ]);
      return stat.slice(0, DIFF_STAT_LIMIT) || undefined;
    } catch {
      return undefined;
    }
  }

  /** Merges an approved task's branch into the project, then removes the
   * branch and its worktree. A failed merge leaves the task in review. */
  private async deliver(task: HostTask, auto = false): Promise<HostTask> {
    if (this.delivering.has(task.id)) throw new Error("This task is already being merged.");
    if (this.mergingProjects.has(task.projectId))
      throw new Error("Another task is being merged into this project. Delivery will retry.");
    this.delivering.add(task.id);
    this.mergingProjects.add(task.projectId);
    try {
      const project = this.store.project(task.projectId);
      let cwd: string;
      let artifactPaths: string[] = [];
      let artifactHashes: Record<string, string> = {};
      try {
        cwd = await resolveHostWorktreeAsync(project.cwd, task.deliveryCwd);
        if (!task.baseBranch) throw new Error("This task does not know which branch it left.");
        if (task.worktreeCwd) artifactPaths = await transferTaskArtifacts(task.worktreeCwd, cwd);
        artifactHashes = Object.fromEntries(
          artifactPaths.map((path) => [
            path,
            createHash("sha256")
              .update(readFileSync(join(cwd, path)))
              .digest("hex"),
          ]),
        );
        await mergeTaskBranch(cwd, task.branch!, task.baseBranch);
      } catch (error) {
        const latest = this.find(task.id);
        if (latest?.status === "review") this.write({ ...latest, mergeError: errorMessage(error) });
        throw error;
      }
      const {
        worktreeCwd: removed,
        mergeError,
        mergeRetry,
        mergeRepair,
        cleanupError: previousCleanup,
        deliveryRequested,
        ...rest
      } = task;
      const now = this.now();
      const delivered = this.write({
        ...rest,
        worktreeCwd: task.worktreeCwd,
        status: "done",
        merged: true,
        mergedAt: now,
        deliveredCommit: await git(cwd, ["rev-parse", "HEAD"]),
        deliveryNote: undefined,
        ...(artifactPaths.length ? { artifactPaths, artifactHashes } : {}),
        ...(auto ? { autoMerged: true } : {}),
        updatedAt: now,
      });
      return await this.cleanupDelivered(delivered, now);
    } finally {
      this.delivering.delete(task.id);
      this.mergingProjects.delete(task.projectId);
    }
  }

  /** Retire delivered task checkouts, retrying Windows locks without discarding changed work. */
  private async cleanupDelivered(task: HostTask, now: number): Promise<HostTask> {
    if (task.status !== "done" || !task.merged || (task.cleanupRetryAfter ?? 0) > now) return task;
    const project = this.store.project(task.projectId);
    const same = (a: string | undefined, b: string) =>
      a != null && resolve(a).toLowerCase() === resolve(b).toLowerCase();
    const inUse = (path: string) =>
      Array.from(this.taskIndex().values()).some(
        (other) =>
          other.id !== task.id &&
          other.status !== "done" &&
          (same(other.worktreeCwd, path) ||
            same(other.deliveryCwd, path) ||
            same(other.workspace?.checkoutCwd, path) ||
            other.historyRecovery?.some((entry) => same(entry.worktreeCwd, path))),
      ) ||
      this.store.startupStates().some(
        (session) =>
          (session.running || session.shellRunning) &&
          session.cwd != null &&
          (same(session.cwd, path) ||
            resolve(session.cwd)
              .toLowerCase()
              .startsWith(
                `${resolve(path).toLowerCase()}${process.platform === "win32" ? "\\" : "/"}`,
              )),
      );
    let current = task;
    const errors: string[] = [];
    const candidates = [
      ...(task.worktreeCwd && task.branch
        ? [
            {
              path: task.worktreeCwd,
              branch: task.branch,
              primary: true,
              head: undefined as string | undefined,
            },
          ]
        : []),
      ...(task.historyRecovery ?? []).flatMap((entry) =>
        entry.worktreeCwd
          ? [{ path: entry.worktreeCwd, branch: entry.branch, primary: false, head: entry.head }]
          : [],
      ),
    ];
    for (const candidate of candidates) {
      try {
        if (inUse(candidate.path))
          throw new Error("The task checkout is still in use; cleanup will retry when it is idle.");
        const archives = await cleanupTaskWorktree(
          project.cwd,
          task.id,
          candidate.path,
          candidate.branch,
          candidate.primary
            ? { deliveredCommit: task.deliveredCommit ?? "HEAD" }
            : { head: candidate.head },
          () => inUse(candidate.path),
        );
        current = this.write({
          ...current,
          ...(candidate.primary
            ? { worktreeCwd: undefined }
            : {
                historyRecovery: current.historyRecovery?.map((entry) =>
                  same(entry.worktreeCwd, candidate.path)
                    ? { ...entry, worktreeCwd: undefined }
                    : entry,
                ),
              }),
          cleanupArchives: [...(current.cleanupArchives ?? []), ...archives],
          updatedAt: now,
        });
        if (candidate.primary)
          await git(project.cwd, ["branch", "-d", "--", candidate.branch]).catch(() => {});
      } catch (error) {
        errors.push(errorMessage(error));
      }
    }
    return this.write({
      ...current,
      cleanupError: errors.length ? errors.join("\n") : undefined,
      cleanupRetryAfter: errors.length ? now + 2 * 60_000 : undefined,
      updatedAt: now,
    });
  }

  /** Removes a task's worktree and branch, with whatever is on them. */
  private async discard(task: HostTask): Promise<void> {
    let cwd: string;
    try {
      cwd = this.store.project(task.projectId).cwd;
    } catch {
      // The project is gone from this machine, and its repository with it.
      return;
    }
    if (task.worktreeCwd && available(task.worktreeCwd))
      await git(cwd, ["worktree", "remove", "--force", "--", task.worktreeCwd]).catch((error) =>
        console.error("Could not remove a task worktree:", gitError(error)),
      );
    await git(cwd, ["worktree", "prune"]).catch(() => {});
    invalidateHostWorktrees(cwd);
    await git(cwd, ["branch", "-D", "--", task.branch!]).catch((error) =>
      console.error("Could not delete a task branch:", gitError(error)),
    );
  }
}
