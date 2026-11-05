import type { TaskFinalizationPreview } from "./task-workspace-runtime";
import type { TaskPreflightItem } from "../../src/features/tasks/model/taskPreflight";
import type { CommandReceipt } from "../../src/features/connections/model/protocol";
import { type AssistantRecoverySource } from "../assistant/work/assistant-worker-recovery";
import {
  type HostTask,
  type HostTaskInput,
  type TaskDeliveryReview,
} from "../../src/features/tasks/model/hostTasks";
import type { HostEngine } from "../engine";
import type { HostGoal } from "../../src/features/tasks/model/hostGoals";
import type {
  SprintSourceEvent,
  SprintTaskSnapshot,
} from "../../src/features/tasks/model/hostSprints";
import { HostLimits } from "../limits";
import { HostTaskBudgets } from "./task-budgets";
import { type SessionRunEngine } from "../sessions/sessionRuns";
import type { HostStore } from "../store";
import { type TaskWorkspaceServices } from "./task-workspace-runtime";
import type { WorkspaceOwnerAuthorization } from "../workspaces/workspace-service-contracts";
import type { WorkspaceRpcRequest } from "../workspaces/workspace-rpc-contracts";
import type { BranchMergeReceipt } from "../workspaces/workspace-contracts";
import { VERIFY_TIMEOUT_MS } from "./constants";
import * as goalBudget from "./goal-budget";
import * as assistantRecovery from "./assistant-recovery";
import * as taskActions from "./task-actions";
import * as managedSession from "./managed-session";
import * as assistantHolds from "./assistant-holds";
import * as fingerprint from "./fingerprint";
import * as preflight from "./preflight";
import * as scheduler from "./scheduler";
import * as verification from "./verification";
import * as storage from "./storage";
import * as delivery from "./delivery";
import * as recovery from "./recovery";
import * as launch from "./launch";
import * as review from "./review";
import { initialize, createTaskEngine } from "./initialize";
import type { TaskContext } from "./context";
import type {
  TaskAssistantMetadataCache,
  TaskEtagCache,
  TaskListCache,
  TaskPointIndex,
  TaskProjectListCache,
} from "./cache-state";
export {
  MAX_RUNNING_TASKS,
  VERIFY_TIMEOUT_MS,
  MAX_REPAIR_ATTEMPTS,
  MAX_RUNTIME_RETRIES,
  MAX_QUESTION_CONTINUATIONS,
} from "./constants";
export class HostTasks {
  /** All fields remain on this instance. The internal view only relaxes protected visibility across modules. */
  private get context(): TaskContext {
    return this as unknown as TaskContext;
  }

  /** Internal runtime composition, never accepted from an RPC request. */
  assistantRecoveryAdmission?: (
    task: HostTask,
    stage?: { sessionId: string; runId?: string; phase: "command" | "provider" },
  ) => Promise<void>;

  assistantGoalAdmission?: (goalId: string) => Promise<boolean>;

  goalExecutionAllowed(goalId?: string): Promise<boolean> {
    return goalBudget.goalExecutionAllowed(this.context, goalId);
  }

  assistantRecoveryFailed?: (task: HostTask, message: string) => Promise<void>;

  protected readonly assistantRecoveryQueue = new Set<string>();

  captureAssistantRecovery(
    input: Parameters<typeof assistantRecovery.captureAssistantRecovery>[1],
  ): Promise<AssistantRecoverySource> {
    return assistantRecovery.captureAssistantRecovery(this.context, input);
  }

  protected waitAssistantRetirement(
    sessionId: string,
    runId: string,
    signal: AbortSignal,
  ): Promise<void> {
    return assistantRecovery.waitAssistantRetirement(this.context, sessionId, runId, signal);
  }

  recoverAssistantWorker(
    input: Parameters<typeof assistantRecovery.recoverAssistantWorker>[1],
  ): Promise<HostTask> {
    return assistantRecovery.recoverAssistantWorker(this.context, input);
  }

  protected resolveAssistantRecoveryForOwner(task: HostTask): Promise<void> {
    return assistantRecovery.resolveAssistantRecoveryForOwner(this.context, task);
  }

  protected taskMessage<T>(task: HostTask, reason: string, work: () => Promise<T>): Promise<T> {
    return taskActions.taskMessage(this.context, task, reason, work);
  }

  protected readonly continuingSessions = new Set<string>();

  protected readonly continueHistory?: HostEngine["continueSessionHistory"];

  protected readonly admitCommand?: HostEngine["withCommandAdmission"];

  protected readonly waitRecoveryRun?: HostEngine["waitForRun"];

  protected readonly retireRecoveryWriter?: HostEngine["withRetiredProviderWriter"];

  protected readonly activeRecoveryRun?: HostEngine["hasActiveRun"];

  protected readonly retainedDeletionWriter?: HostEngine["hasRetainedProviderWriter"];

  /** Only the canonical running worker may receive supervisor sends/compaction.
   * Its accepted run and budget ledger move in the engine's same transaction. */
  managedSessionCommand(
    input: Parameters<typeof managedSession.managedSessionCommand>[1],
    command: unknown,
  ): Promise<CommandReceipt> {
    return managedSession.managedSessionCommand(this.context, input, command);
  }

  /** A managed worker retains its task/workspace and model while the engine
   * starts fresh provider history. Only its current, idle attempt may move. */
  continueManagedSession(
    input: Parameters<typeof managedSession.continueManagedSession>[1],
  ): Promise<CommandReceipt> {
    return managedSession.continueManagedSession(this.context, input);
  }

  protected readonly pausedGoals = new Set<string>();

  protected readonly assistantDeletionGoals = new Set<string>();

  protected readonly invalidatedAssistantGenerations = new Map<string, Set<string | undefined>>();

  protected invalidateAssistantGeneration(task: HostTask): void {
    return assistantHolds.invalidateAssistantGeneration(this.context, task);
  }

  isAssistantDeletionHeld(goalId: string): boolean {
    return assistantHolds.isAssistantDeletionHeld(this.context, goalId);
  }

  setAssistantDeletionHold(goalId: string, operationId: string, held: boolean): Promise<void> {
    return assistantHolds.setAssistantDeletionHold(this.context, goalId, operationId, held);
  }

  assertAssistantDeletionStopped(taskIds: readonly string[]): Promise<void> {
    return assistantHolds.assertAssistantDeletionStopped(this.context, taskIds);
  }

  markAssistantDeletionQuiescent(id: string, expectedValue: string): Promise<void> {
    return assistantHolds.markAssistantDeletionQuiescent(this.context, id, expectedValue);
  }

  assistantDeletionRunRetired(
    source: Parameters<typeof assistantHolds.assistantDeletionRunRetired>[1],
  ): Promise<boolean> {
    return assistantHolds.assistantDeletionRunRetired(this.context, source);
  }

  assertAssistantDeletionSourceStable(
    source: Parameters<typeof assistantHolds.assertAssistantDeletionSourceStable>[1],
  ): Promise<void> {
    return assistantHolds.assertAssistantDeletionSourceStable(this.context, source);
  }

  restoreAssistantDeletedTask(snapshot: HostTask, goalId: string): Promise<HostTask> {
    return assistantHolds.restoreAssistantDeletedTask(this.context, snapshot, goalId);
  }

  /** Durable admission hold: running work finishes, queued goal work cannot start. */
  setGoalPaused(goalId: string, paused: boolean): Promise<void> {
    return goalBudget.setGoalPaused(this.context, goalId, paused);
  }

  /** Automatic admission holds remain independent of the owner's manual pause. */
  setGoalPauseReason(
    goalId: string,
    reason: "assistant-budget" | "assistant-hours",
    paused: boolean,
  ): Promise<void> {
    return goalBudget.setGoalPauseReason(this.context, goalId, reason, paused);
  }

  protected publishGoalPause(goalId: string): Promise<void> {
    return goalBudget.publishGoalPause(this.context, goalId);
  }

  hasRunningGoalWork(goalIds: readonly string[]): Promise<boolean> {
    return goalBudget.hasRunningGoalWork(this.context, goalIds);
  }

  protected timer?: ReturnType<typeof setInterval>;

  protected ticking?: Promise<void>;

  protected closing = false;

  get admissionClosed(): boolean {
    return this.closing;
  }

  protected disposal?: Promise<void>;

  /** Verifications in progress, by task. A task keeps one at most. */
  protected readonly jobs = new Map<string, Promise<void>>();

  protected readonly jobControllers = new Map<string, AbortController>();

  /** Tasks being merged. */
  protected readonly delivering = new Set<string>();

  /** Runs on every tick once running tasks are settled, before queued ones
   * start, so work it queues can start in the same tick. */
  protected beforeStart?: () => Promise<void> | void;

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

  protected readonly externalRunSources: Array<() => number | Promise<number>> = [];

  protected readonly registeredBudgetRuns = new Set<string>();

  trackExternalRuns(source: () => number | Promise<number>): void {
    return taskActions.trackExternalRuns(this.context, source);
  }

  resultFingerprint(task: HostTask): Promise<string | undefined> {
    return fingerprint.resultFingerprint(this.context, task);
  }

  preflight(raw: unknown): Promise<{
    items: TaskPreflightItem[];
    state: "ready" | "blocked" | "unknown";
    checkedAt: number;
  }> {
    return preflight.preflight(this.context, raw);
  }

  protected preflightAt(
    task: HostTaskInput,
    cwd: string,
  ): Promise<{
    items: TaskPreflightItem[];
    state: "ready" | "blocked" | "unknown";
    checkedAt: number;
  }> {
    return preflight.preflightAt(this.context, task, cwd);
  }

  recordEvaluation(id: string, raw: unknown, expectedUpdatedAt: unknown): Promise<HostTask> {
    return preflight.recordEvaluation(this.context, id, raw, expectedUpdatedAt);
  }

  protected budgetReason(task: HostTask, starting = false): Promise<string | undefined> {
    return goalBudget.budgetReason(this.context, task, starting);
  }

  protected budgetParent(task: HostTask): Promise<HostTask | undefined> {
    return goalBudget.budgetParent(this.context, task);
  }

  protected budgetBlock(task: HostTask, reason: string, now: number): Promise<HostTask> {
    return goalBudget.budgetBlock(this.context, task, reason, now);
  }

  readonly ready: Promise<void>;

  protected readonly engine: SessionRunEngine;

  constructor(
    protected readonly store: HostStore,
    engine: SessionRunEngine,
    protected readonly now: () => number = Date.now,
    protected readonly verifyTimeoutMs = VERIFY_TIMEOUT_MS,
    protected readonly managed?: TaskWorkspaceServices,
  ) {
    this.engine = createTaskEngine(this.context, store, engine);
    this.limits = new HostLimits(store, now);
    this.budgets = new HostTaskBudgets(store, now);
    this.ready = initialize(this.context, store);
  }

  start(): void {
    return scheduler.start(this.context);
  }

  stop(): void {
    return scheduler.stop(this.context);
  }

  /** Close admission synchronously and join work before the store closes. */
  close(): Promise<void> {
    return scheduler.close(this.context);
  }

  acceptCrewTask(id: string): Promise<HostTask> {
    return verification.acceptCrewTask(this.context, id);
  }

  /** Lets a layer on top of the board, such as goals, share its timer. */
  onTick(hook: () => Promise<void> | void): void {
    return scheduler.onTick(this.context, hook);
  }

  /** Resolves once no tick or verification is in progress. */
  idle(): Promise<void> {
    return scheduler.idle(this.context);
  }

  /** Boards reopened over the same store must invalidate each other's caches. */
  protected revisionCounter(): Promise<number> {
    return storage.revisionCounter(this.context);
  }

  onChange?: () => void;

  /** Published only for an actual committed removal, never a failed/absent delete. */
  onDelete?: (task: { id: string; projectId: string }) => void;

  protected etagCache?: TaskEtagCache;

  protected listCache?: TaskListCache;

  protected projectListCache = new Map<string, TaskProjectListCache>();

  protected assistantMetadataCache = new Map<string | undefined, TaskAssistantMetadataCache>();

  /** Live task state for one scheduler pass, maintained by write/delete. */
  protected schedulerTasks?: Map<string, HostTask>;

  protected pointIndex?: TaskPointIndex;

  revision(): Promise<number> {
    return storage.revision(this.context);
  }

  /** A supervisor receipt changes read-only board metadata, never task execution. */
  assistantFollowupsChanged(): Promise<void> {
    return storage.assistantFollowupsChanged(this.context);
  }

  /**
   * Digest of what a remote client shows for the board. Recomputed only after
   * a task changed, so polling it does not parse every stored task.
   */
  changeEtag(): Promise<string> {
    return storage.changeEtag(this.context);
  }

  /** Oldest first. */
  snapshotWithCursor(): Promise<{
    tasks: SprintTaskSnapshot[];
    cursor: number;
    historyAvailableFrom: number;
  }> {
    return storage.snapshotWithCursor(this.context);
  }

  events(
    after: number,
    limit = 500,
  ): Promise<{
    events: SprintSourceEvent[];
    cursor: number;
    hasMore: boolean;
    historyAvailableFrom: number;
    gap?: boolean;
  }> {
    return storage.events(this.context, after, limit);
  }

  list(projectId?: string, includeAssistantMetadata = true): Promise<HostTask[]> {
    return storage.list(this.context, projectId, includeAssistantMetadata);
  }

  /** Shared read-only index; task writes invalidate the revision cache. */
  taskIndex(ids?: readonly string[]): Promise<ReadonlyMap<string, HostTask>> {
    return storage.taskIndex(this.context, ids);
  }

  /** Keep the live pass consistent with an atomic task/goal batch on rollback. */
  transaction<T>(operation: () => T | Promise<T>): Promise<T> {
    return storage.transaction(this.context, operation);
  }

  /** Re-evaluate existing work and acceptance blockers without a worker rerun. */
  recheckReview(id: string): Promise<HostTask> {
    return verification.recheckReview(this.context, id);
  }

  /** Adds a task to the queue, or as a to-do item when asked to, or edits one
   * that is not running or finished. An edit keeps the task's status. */
  save(raw: unknown): Promise<HostTask> {
    return taskActions.save(this.context, raw);
  }

  /** Called by the goal's transaction; preserves task identity, checks and recovery gates. */
  updateGoalSettings(
    goalId: string,
    taskIds: readonly string[],
    settings: Parameters<typeof goalBudget.updateGoalSettings>[3],
  ): Promise<void> {
    return goalBudget.updateGoalSettings(this.context, goalId, taskIds, settings);
  }

  /** Moving a reviewed task to done merges its branch; that can fail, and the
   * task then stays in review. */
  move(id: string, to: unknown, reviewed?: HostTask, generation?: number): Promise<HostTask> {
    return taskActions.move(this.context, id, to, reviewed, generation);
  }

  /** Owner start requests retain scheduler limits and dependency gates. */
  startTask(id: string, reviewed?: HostTask): Promise<HostTask> {
    return taskActions.startTask(this.context, id, reviewed);
  }

  reorder(ids: unknown): Promise<HostTask[]> {
    return taskActions.reorder(this.context, ids);
  }

  /** Retarget a reviewed result without launching another worker. */
  retarget(
    id: string,
    raw: unknown,
    autoMerge?: unknown,
    owner?: WorkspaceOwnerAuthorization,
  ): Promise<HostTask> {
    return delivery.retarget(this.context, id, raw, autoMerge, owner);
  }

  /** Discard explicitly closes the managed workspace; branch and recovery refs remain. */
  delete(id: string, discard = false, expectedUpdatedAt?: number): Promise<void> {
    return taskActions.deleteTask(this.context, id, discard, expectedUpdatedAt);
  }

  /** Transfer only unstarted independent work; never move branches or execution identity. */
  validateTransfer(
    id: string,
    targetProjectId: string,
    expectedUpdatedAt: number,
  ): Promise<HostTask> {
    return taskActions.validateTransfer(this.context, id, targetProjectId, expectedUpdatedAt);
  }

  transfer(id: string, targetProjectId: string, expectedUpdatedAt: number): Promise<HostTask> {
    return taskActions.transfer(this.context, id, targetProjectId, expectedUpdatedAt);
  }

  get(id: string): Promise<HostTask | undefined> {
    return storage.get(this.context, id);
  }

  /** Acknowledge precisely the notes shown by a desktop, preserving newer notes. */
  readNotes(id: string, rawIds: unknown): Promise<HostTask> {
    return taskActions.readNotes(this.context, id, rawIds);
  }

  /** Note status is bookkeeping, never task completion or merge approval. */
  resolveNote(id: string, noteId: unknown, resolved: unknown): Promise<HostTask> {
    return taskActions.resolveNote(this.context, id, noteId, resolved);
  }

  /** Recover old review failures only when their owning goal is still active.
   * Re-read the reviewer evidence; never revive an owner stop or failed runtime. */
  recoverGoalReview(id: string, goalId: string): Promise<HostTask | undefined> {
    return verification.recoverGoalReview(this.context, id, goalId);
  }

  /** Stops a running or verifying task as Stop does, and blocks a queued one
   * with `reason`. Anything else is left as it is. */
  cancel(id: string, reason: string): Promise<void> {
    return taskActions.cancel(this.context, id, reason);
  }

  /** Settles running and verifying tasks, stops those past their time limit,
   * then starts queued ones while there is room. A tick already in progress
   * is not joined by a second one. */
  tick(): Promise<void> {
    return scheduler.tick(this.context);
  }

  protected work(): Promise<void> {
    return scheduler.work(this.context);
  }

  protected find(id: string): Promise<HostTask | undefined> {
    return storage.find(this.context, id);
  }

  protected taskValue(id: string): Promise<string | undefined> {
    return storage.taskValue(this.context, id);
  }

  /** Compare the persisted row, including edits that keep updatedAt unchanged. */
  protected unchangedTask(id: string, expected: string | undefined): Promise<HostTask | undefined> {
    return storage.unchangedTask(this.context, id, expected);
  }

  /** A task can acquire a new dependency while a tick awaits another worker.
   * Resolve only its required closure, including inactive/completed records. */
  protected hydrateDependencies(
    graph: Map<string, HostTask>,
    roots: Iterable<Pick<HostTask, "id" | "dependsOn">>,
  ): Promise<void> {
    return storage.hydrateDependencies(this.context, graph, roots);
  }

  protected scheduledTask(id: string): Promise<HostTask | undefined> {
    return storage.scheduledTask(this.context, id);
  }

  /** Only schedulable/recovery work and its dependency closure need full JSON.
   * Owner-facing list() remains a complete history even during an awaited tick. */
  protected schedulerSnapshot(
    dependencies = true,
    persisted?: Map<string, string>,
  ): Promise<Map<string, HostTask>> {
    return storage.schedulerSnapshot(this.context, dependencies, persisted);
  }

  /** Missing forward references are valid; only a closed dependency path blocks. */
  protected dependencyCycle(
    id: string,
    graph: ReadonlyMap<string, Pick<HostTask, "dependsOn">>,
  ): string[] | undefined {
    return storage.dependencyCycle(this.context, id, graph);
  }

  protected owningGoal(id: string): Promise<HostGoal | undefined> {
    return goalBudget.owningGoal(this.context, id);
  }

  protected takeoverGoalActive(task: HostTask): Promise<boolean> {
    return recovery.takeoverGoalActive(this.context, task);
  }

  protected queueTakeover(
    task: HostTask,
    now: number,
    reviewed?: HostTask,
    generation?: number,
  ): Promise<HostTask> {
    return recovery.queueTakeover(this.context, task, now, reviewed, generation);
  }

  /** Backfill the available legacy review once; runtime/missing-verdict
   * failures are not defects. Only trusted correction summaries replace missing sessions. */
  protected withReviewNotes(task: HostTask): Promise<HostTask> {
    return storage.withReviewNotes(this.context, task);
  }

  protected write(
    task: HostTask,
    persisted?: Map<string, string>,
    reviewed?: HostTask,
    generation?: number,
  ): Promise<HostTask> {
    return storage.write(this.context, task, persisted, reviewed, generation);
  }

  protected block(
    task: HostTask,
    error: string,
    now: number,
    retainReviewer = false,
  ): Promise<HostTask> {
    return recovery.block(this.context, task, error, now, retainReviewer);
  }

  /** Correct failed deliverables in unattended work without releasing dependencies.
   * Every reviewed task corrects itself within a bounded number of attempts. When
   * correction is exhausted, the task finishes with its open findings reported to
   * the owner instead of stopping. Explicit rechecks, crew assignments, merge
   * repairs and failures without a usable verdict or check result stay stopped. */
  protected repairOrBlock(task: HostTask, error: string, now: number): Promise<HostTask> {
    return recovery.repairOrBlock(this.context, task, error, now);
  }

  /** Finish a task whose worker succeeded but whose automatic correction is
   * exhausted. The failed review stays recorded (PASS is never claimed), open
   * findings become owner notices, and delivery always waits for the owner. */
  protected completeWithFindings(
    task: HostTask,
    error: string,
    now: number,
    reason: "external" | "no_progress" | "limit",
  ): Promise<HostTask> {
    return recovery.completeWithFindings(this.context, task, error, now, reason);
  }

  /** Only infrastructure interruptions may resume without owner intervention.
   * A persistence failure also interrupts a session, but must stay stopped. */
  protected canResumeAfterHostStop(run: {
    sessionId?: string;
    runId?: string;
    error?: string;
  }): Promise<boolean> {
    return recovery.canResumeAfterHostStop(this.context, run);
  }

  protected requeueInterrupted(task: HostTask, now: number): Promise<HostTask> {
    return recovery.requeueInterrupted(this.context, task, now);
  }

  /** Capture failed checks before a retry clears the verification record. */
  protected retryFeedback(task: HostTask): Promise<string | undefined> {
    return recovery.retryFeedback(this.context, task);
  }

  /** Gives the task its working copy: the worktree it already has, a new one
   * on a new branch, or none when it runs in the project folder. */
  protected workingCopy(task: HostTask): Promise<HostTask> {
    return launch.workingCopy(this.context, task);
  }

  finalizationPreview(id: string): Promise<TaskFinalizationPreview> {
    return delivery.finalizationPreview(this.context, id);
  }

  protected requireFinalized(task: HostTask, cwd: string): Promise<void> {
    return delivery.requireFinalized(this.context, task, cwd);
  }

  protected stopWorkspaceActivity(task: HostTask): Promise<void> {
    return delivery.stopWorkspaceActivity(this.context, task);
  }

  protected launch(task: HostTask, now: number, active: readonly HostTask[]): Promise<HostTask> {
    return launch.launch(this.context, task, now, active);
  }

  /** Tracked files other sessions have edited but not committed in the
   * project checkout, so an isolated worker knows what delivery will meet. */
  protected sharedEdits(projectCwd: string): Promise<string[]> {
    return launch.sharedEdits(this.context, projectCwd);
  }

  protected resumeInterrupted(task: HostTask): Promise<{
    sessionId?: string;
    runId?: string;
    error?: string;
    deferred?: boolean;
  }> {
    return recovery.resumeInterrupted(this.context, task);
  }

  protected settleCrew(task: HostTask, now: number): Promise<void> {
    return verification.settleCrew(this.context, task, now);
  }

  protected settle(task: HostTask, now: number): Promise<void> {
    return verification.settle(this.context, task, now);
  }

  /** A transient provider/network/session failure gets a fresh worker run that
   * continues from the retained working copy, a bounded number of times. */
  protected retryTransientFailure(task: HostTask, error: string, now: number): Promise<void> {
    return recovery.retryTransientFailure(this.context, task, error, now);
  }

  /** An unattended worker waiting on a clarifying question is told to decide
   * itself. Approval prompts, non-skippable questions and repeated questions
   * still wait for the owner. */
  protected continueUnansweredQuestion(task: HostTask, now: number): Promise<boolean> {
    return recovery.continueUnansweredQuestion(this.context, task, now);
  }

  /** Runs the task's checks in the background: commits what the agent left,
   * runs the check command, then hands over to the reviewer or to review. */
  protected verify(task: HostTask): Promise<void> {
    return verification.verify(this.context, task);
  }

  /** Follows a verifying task's reviewer to its verdict. */
  protected settleVerification(task: HostTask, now: number): Promise<void> {
    return review.settleVerification(this.context, task, now);
  }

  protected resumeReviewer(task: HostTask, now: number): Promise<void> {
    return review.resumeReviewer(this.context, task, now);
  }

  /** Moves a verified task to review. An isolated task set to merge on its
   * own is merged right away, when every configured check passed; it then goes
   * straight to done. When it cannot be merged it waits in review, with why. */
  protected enterReview(task: HostTask): Promise<HostTask> {
    return review.enterReview(this.context, task);
  }

  /** Old persisted approval booleans cannot authorize Git mutations. */
  protected recoverMerge(task: HostTask, _now: number, _auto = true): Promise<void> {
    return delivery.recoverMerge(this.context, task, _now, _auto);
  }

  /** What the task branch changes since it left the project's branch. */
  /** Covers the repository snapshot plus explicit local deliverables, including ignored outputs.
   * External URLs and prose descriptions remain the reviewer's evidence, not a filesystem check. */
  protected acceptanceFingerprint(
    task: HostTask,
    knownWorkspace?: string,
  ): Promise<string | undefined> {
    return fingerprint.acceptanceFingerprint(this.context, task, knownWorkspace);
  }

  /** Content evidence for retry progress. Prefer Git's tracked tree and diff;
   * small non-Git project folders use a bounded scan, never following links. */
  protected workspaceFingerprint(task: HostTask): Promise<string | undefined> {
    return fingerprint.workspaceFingerprint(this.context, task);
  }

  protected diffStat(task: HostTask): Promise<string | undefined> {
    return fingerprint.diffStat(this.context, task);
  }

  /** Review implementation and delivery independently; this read never authorizes a merge. */
  reviewDelivery(id: string): Promise<TaskDeliveryReview> {
    return delivery.reviewDelivery(this.context, id);
  }

  /** Owner transport must supply proof separately. No persistent boolean authorizes this method. */
  mergeDelivery(
    id: string,
    request: WorkspaceRpcRequest<"workspaces.delivery.merge">,
    owner: WorkspaceOwnerAuthorization,
  ): Promise<HostTask> {
    return delivery.mergeDelivery(this.context, id, request, owner);
  }

  protected finishDeliveryReceipt(
    task: HostTask,
    receipt: BranchMergeReceipt,
    planToken: string,
  ): Promise<HostTask> {
    return delivery.finishDeliveryReceipt(this.context, task, receipt, planToken);
  }

  /** Called by S1 after generic workspace delivery and on recovery. Trust only the durable registry receipt. */
  reconcileDelivery(workspaceId: string): Promise<HostTask | undefined> {
    return delivery.reconcileDelivery(this.context, workspaceId);
  }

  /** Retire delivered task checkouts, retrying Windows locks without discarding changed work. */
  protected cleanupDelivered(task: HostTask, now: number): Promise<HostTask> {
    return delivery.cleanupDelivered(this.context, task, now);
  }

  /** Closing preserves the local branch and recovery refs. S4 alone owns directory retirement. */
  protected discard(task: HostTask): Promise<void> {
    return delivery.discard(this.context, task);
  }
}
