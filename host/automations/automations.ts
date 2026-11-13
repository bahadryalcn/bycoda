import { importNativeAutomation } from "./native-migration";
import { AutomationEventOutbox } from "./event-outbox";
import type { HostTasks } from "../tasks/service";
import {
  createAutomationTask,
  automationTaskProjection,
  assertAutomationTaskOwnership,
  assertUnstartedAutomationTaskRetired,
  stopAutomationTask,
} from "./task-execution";
import { hostModelRoutingService } from "../model-routing/runtime";
import {
  bindSessionWork,
  cancelSessionWorkOccurrence,
  getSessionWork,
} from "../work/session-adapter";
import { resolveModelChoice } from "../model-routing/service";
import { ownerDayBounds } from "../../src/shared/lib/time/ownerDay";
import { randomUUID } from "node:crypto";
import { QUICK_AUTOMATION_MAX_AHEAD_MS } from "../../src/shared/model/host-contracts/assistant-quick-automation";
import { assertExpectedConfiguration } from "../configurationConflict";
import { automationLimits } from "../../src/features/automations/model/automationLimits";
import {
  nextAutomationRunAt,
  type AutomationSchedule,
} from "../../src/features/automations/model/automationSchedule";
import {
  parseHostAutomation,
  type HostAutomation,
  type HostAutomationInput,
  type HostAutomationRun,
} from "../../src/features/automations/model/hostAutomations";
import {
  cancelSessionRun,
  errorMessage,
  launchSessionRun,
  sessionRunState,
  type SessionRunEngine,
} from "../sessions/sessionRuns";
import type { HostStore } from "../store";
import { previewTaskFinalization, writerWorkspaceMode } from "../tasks/task-workspace-runtime";
import type {
  ExecutionActivityReservations,
  WorkspaceRegistry,
  WorkspacePolicyResolver,
} from "../workspaces/workspace-service-contracts";
import type { HostAutomationRun as StoredAutomationRun } from "../../src/features/automations/model/hostAutomations";

/** Supplied by the execution host. A resolved worktree choice requires managed support. */
export interface AutomationWorkspaceServices {
  policy?: WorkspacePolicyResolver;
  registry: WorkspaceRegistry;
  activity: ExecutionActivityReservations;
  environmentId: string;
}
type ManagedAutomationRun = StoredAutomationRun & {
  workspaceId?: string;
  activityId?: string;
  workPending?: boolean;
};
const TICK_MS = 30000;
const MAX_RUNS_PER_AUTOMATION = 100;
const sameSchedule = (a: AutomationSchedule, b: AutomationSchedule) =>
  a.scheduleKind === b.scheduleKind &&
  a.time === b.time &&
  a.minute === b.minute &&
  a.dayOfWeek === b.dayOfWeek;
const sameTrigger = (a: HostAutomation, b: ReturnType<typeof parseHostAutomation>) =>
  JSON.stringify(a.trigger ?? null) === JSON.stringify(b.trigger ?? null);
// Legacy JSON readers used JavaScript truthiness, including strings such as "0".
// Arguments are private SQL source identifiers and paths, never operation input.
const truthyJson = (value: string, path: string) => {
  const type = `json_type(${value},'${path}')`;
  const field = `json_extract(${value},'${path}')`;
  return `(${type} IN ('true','array','object') OR (${type} IN ('integer','real') AND ${field}<>0) OR (${type}='text' AND ${field}<>''))`;
};
/** A run this overdue was missed while the machine was off or asleep. */
const MISSED_RUN_GRACE_MS = 12 * 60 * 60000;
export const MISSED_RUN_SKIP = "Skipped: missed while this machine was off.";
export const PREVIOUS_RUN_SKIP = "Skipped: the previous run is still going.";
/** Runs saved automations on this machine's own clock, so they keep going
 * with no desktop open. Each run is an ordinary host session. */
export class HostAutomations {
  /** Internal parent-Work fence; saved definitions cannot supply this authority. */
  roomParentAdmission?: (automation: HostAutomation, run: HostAutomationRun) => Promise<boolean>;
  onDelete?: (automation: { id: string }) => void;
  private tasks?: HostTasks;
  private readonly outbox: AutomationEventOutbox;
  projectScan?: {
    create(input: HostAutomationInput): Promise<HostAutomation>;
    update(input: HostAutomationInput, sourceStewardId: string): Promise<void>;
    prepare(stewardId: string): Promise<string>;
    completed(stewardId: string, sessionId: string): Promise<void>;
  };
  /** Canonical Task service, shared with project boards and delivery review. */
  bindTasks(tasks: HostTasks): void {
    this.tasks = tasks;
  }
  private readonly engine: SessionRunEngine;
  private timer?: ReturnType<typeof setInterval>;
  private ticking?: Promise<void>;
  private closing = false;
  private disposal?: Promise<void>;
  private readonly manualRuns = new Set<Promise<HostAutomationRun>>();
  private readonly launching = new Set<string>();
  readonly ready: Promise<void>;
  constructor(
    private readonly store: HostStore,
    engine: SessionRunEngine,
    private readonly now: () => number = Date.now,
    private readonly workspaces?: AutomationWorkspaceServices,
  ) {
    const outbox = (this.outbox = new AutomationEventOutbox(store));
    if (engine.withCommandAdmission) bindSessionWork(store, engine);
    // Request authority follows manual preparation; scheduled work has no
    // creator grant. Keep the actual engine admission guarded after every wait.
    this.engine = {
      withMessageAuthor: engine.withMessageAuthor?.bind(engine),
      command: async (...args) => {
        await store.db.checkAuthorization();
        return engine.command(...args);
      },
      updateSession: async (...args) => {
        await store.db.checkAuthorization();
        return engine.updateSession(...args);
      },
    };
    this.ready = (async () => {
      await store.ready;
      await store.db.scope(async () => {
        await store.db.exec(`
      CREATE TABLE IF NOT EXISTS automations (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS automation_once (id TEXT PRIMARY KEY REFERENCES automations(id) ON DELETE CASCADE, run_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS automation_runs (id TEXT PRIMARY KEY, automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS automation_tasks (run_id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, task_id TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS automation_events (automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE, event_id TEXT NOT NULL, kind TEXT NOT NULL, project_id TEXT, run_id TEXT NOT NULL, PRIMARY KEY(automation_id,event_id));
      CREATE INDEX IF NOT EXISTS automation_runs_history_idx ON automation_runs (automation_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS automation_runs_status_idx ON automation_runs (automation_id, json_extract(value, '$.status'));
      CREATE INDEX IF NOT EXISTS automation_runs_started_idx ON automation_runs (automation_id, json_extract(value, '$.startedAt'));
      CREATE INDEX IF NOT EXISTS automation_runs_cleanup_idx ON automation_runs (json_extract(value, '$.status'), json_extract(value, '$.cleanupPending'));`);
      });
      await outbox.prepare();
    })();
  }
  start(): void {
    if (this.closing || this.timer) return;
    this.store.db.outsideScope(() => {
      const kick = () =>
        void this.ready
          .then(async () => await this.tick())
          .catch((error) => console.error("Automation scheduling failed:", error));
      kick();
      this.timer = setInterval(kick, TICK_MS);
      this.timer.unref?.();
    });
  }
  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
  close(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.closing = true;
    this.stop();
    this.disposal = (async () => {
      await this.ready;
      await Promise.allSettled([this.ticking, ...this.manualRuns]);
    })();
    return this.disposal;
  }
  async list(): Promise<HostAutomation[]> {
    await this.ready;

    return (await this.store.db.prepare("SELECT value FROM automations").all())
      .map((row) => JSON.parse(String(row.value)) as HostAutomation)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
  /** Bind this request only, never the saved automation's autonomous lifetime. */
  withAuthorization<T>(authorized: () => Promise<boolean>, work: () => Promise<T>): Promise<T> {
    return this.store.db.withAuthorization(authorized, async () => {
      await this.store.db.checkAuthorization();
      return work();
    });
  }
  /** Internal composition check; a quick creation receipt shares this exact store. */
  usesStore(store: HostStore): boolean {
    return this.store === store;
  }
  /** Newest first. */
  async runs(automationId: string): Promise<HostAutomationRun[]> {
    await this.ready;

    return (
      await this.store.db
        .prepare(
          "SELECT value FROM automation_runs WHERE automation_id=? ORDER BY created_at DESC, rowid DESC",
        )
        .all(automationId)
    ).map((row) => JSON.parse(String(row.value)) as HostAutomationRun);
  }
  async save(raw: unknown): Promise<HostAutomation> {
    await this.ready;
    if (raw && typeof raw === "object" && "nativeMigration" in raw)
      return importNativeAutomation(this.store, raw as Record<string, unknown>);
    return this.store.db.scope(async () => {
      let input = parseHostAutomation(raw);
      if (input.projectId) await this.store.project(input.projectId);
      const now = this.now();
      const previous = await this.find(input.id);
      if (previous?.template) {
        if (input.template && JSON.stringify(input.template) !== JSON.stringify(previous.template))
          throw new Error("Project scan template source cannot be changed.");
        input = { ...input, template: previous.template };
      } else if (input.template) {
        if (input.template.sourceStewardId !== "new" || previous)
          throw new Error("Invalid Project scan source.");
        if (!input.projectId || input.trigger)
          throw new Error("Project scan requires a project and a scheduled trigger.");
        if (!this.projectScan) throw new Error("Project scan service is unavailable.");
        assertExpectedConfiguration(raw, previous, parseHostAutomation);
        return this.projectScan.create(input);
      }
      if (previous?.nativeMigrationState?.phase === "prepared")
        throw new Error("Finish native migration before editing this automation.");
      if ((raw as { expectedAbsent?: unknown }).expectedAbsent === true && previous)
        throw new Error("Automation ID already exists. Choose a new ID.");
      assertExpectedConfiguration(raw, previous, parseHostAutomation);
      if (previous?.template) {
        if (input.projectId !== previous.projectId || input.trigger)
          throw new Error("Project scan requires its original project and a scheduled trigger.");
        if (!this.projectScan) throw new Error("Project scan service is unavailable.");
        await this.projectScan.update(input, previous.template.sourceStewardId);
      }
      // A one-time arming survives pause/resume edits that keep the schedule; any schedule change drops it.
      const armed =
        previous && sameSchedule(previous, input) && sameTrigger(previous, input)
          ? await this.onceRunAt(input.id)
          : undefined;
      if (!armed || armed <= now) await this.clearOnce(input.id);
      return await this.write({
        ...input,
        nextRunAt:
          armed && armed > now
            ? armed
            : input.trigger?.kind === "continuous"
              ? previous && sameTrigger(previous, input)
                ? previous.nextRunAt
                : now
              : nextAutomationRunAt(input, now),
        nativeMigrationState: previous?.nativeMigrationState,
        lastRunAt: previous?.lastRunAt,
        lastRunStatus: previous?.lastRunStatus,
        lastRunError: previous?.lastRunError,
        lastSessionId: previous?.lastSessionId,
        needsInput: previous?.needsInput,
        createdAt: previous?.createdAt ?? now,
        updatedAt: Math.max(now, (previous?.updatedAt ?? -1) + 1),
      });
    });
  }
  /** Arms a saved automation to run once at `runAt` (epoch ms, in the future, within a year), then turn itself off. */
  async scheduleOnce(id: string, runAt: number): Promise<void> {
    await this.ready;
    if (
      !Number.isSafeInteger(runAt) ||
      runAt <= this.now() ||
      runAt > this.now() + QUICK_AUTOMATION_MAX_AHEAD_MS
    )
      throw new Error("A one-time automation must run at a future time within one year.");
    await this.store.db.scope(async () => {
      const current = await this.find(id);
      if (!current) throw new Error("Automation not found.");
      if (current.trigger) throw new Error("Only scheduled automations can be armed once.");
      await this.write({ ...current, nextRunAt: runAt });
      await this.store.db
        .prepare(
          "INSERT INTO automation_once(id,run_at) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET run_at=excluded.run_at",
        )
        .run(id, runAt);
    });
  }
  private async onceRunAt(id: string): Promise<number | undefined> {
    const row = await this.store.db
      .prepare("SELECT run_at FROM automation_once WHERE id=?")
      .get(id);
    return row ? Number(row.run_at) : undefined;
  }
  private async clearOnce(id: string): Promise<void> {
    await this.store.db.prepare("DELETE FROM automation_once WHERE id=?").run(id);
  }
  /** Read-only preview evaluated by the same clock and scheduler as save. */
  preview(raw: unknown) {
    const schedule = raw as Record<string, unknown>;
    const input = parseHostAutomation({
      ...schedule,
      id: "preview",
      name: "Preview",
      prompt: "Preview",
      projectId: "preview",
      harness: "claude",
      model: "preview",
      runtimeMode: "auto",
    });
    return {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      nextRunAt:
        input.trigger?.kind === "continuous" ? this.now() : nextAutomationRunAt(input, this.now()),
    };
  }
  async delete(id: string): Promise<void> {
    await this.ready;
    if (await this.hasRunningRun(id)) {
      throw new Error("This automation is still running. Stop its session before deleting it.");
    }
    if (
      await this.store.db
        .prepare(
          `SELECT 1 FROM automation_runs WHERE automation_id=? AND ${truthyJson("value", "$.cleanupPending")} LIMIT 1`,
        )
        .get(id)
    )
      throw new Error(
        "This automation is still releasing an owned activity. Wait for cleanup before deleting it.",
      );
    const deleted = await this.store.db.prepare("DELETE FROM automations WHERE id=?").run(id);
    if (Number(deleted.changes) > 0) this.store.afterCommit(() => this.onDelete?.({ id }));
  }
  runNow(id: string, reviewed?: HostAutomation): Promise<HostAutomationRun> {
    if (this.closing) return Promise.reject(new Error("Automation service is closing."));
    const pending = this.runNowOwned(id, reviewed);
    this.manualRuns.add(pending);
    void pending.then(
      () => this.manualRuns.delete(pending),
      () => this.manualRuns.delete(pending),
    );
    return pending;
  }
  private async runNowOwned(id: string, reviewed?: HostAutomation): Promise<HostAutomationRun> {
    if (this.closing) throw new Error("Automation service is closing.");
    await this.ready;

    const now = this.now();
    // Admit the exact reviewed configuration and its pending run together. Launch
    // uses that accepted snapshot after releasing SQL ownership.
    const { automation, run } = await this.store.transaction(async () => {
      const automation = await this.find(id);
      if (!automation) throw new Error("Automation not found.");
      if (automation.nativeMigrationState?.phase === "prepared")
        throw new Error("Native migration is not committed; execution is disabled.");
      if (reviewed) {
        assertExpectedConfiguration(
          { expectedConfiguration: reviewed },
          automation,
          parseHostAutomation,
        );
        if (reviewed.updatedAt !== automation.updatedAt)
          throw new Error("Automation changed after review. Read it again.");
      }
      return { automation, run: await this.newRun(automation, "manual", now) };
    });
    try {
      return await this.launch(automation, run, now);
    } catch (error) {
      // Covers rejected immediate busy/closing finishes too. CAS leaves an
      // already-settled/receipt-backed row untouched and keeps stored links.
      await this.retainOwnedRun(run, {
        status: "failed",
        completedAt: this.now(),
        error: errorMessage(error),
      });
      throw error;
    }
  }
  async stopRun(
    automationId: string,
    runId: string,
  ): Promise<{
    requested: true;
    run: HostAutomationRun;
  }> {
    await this.ready;

    const row = await this.store.db
      .prepare("SELECT value FROM automation_runs WHERE id=? AND automation_id=?")
      .get(runId, automationId);
    const run = row ? (JSON.parse(String(row.value)) as HostAutomationRun) : undefined;
    if (!run || (run.status !== "running" && run.status !== "pending"))
      throw new Error("Automation run is not running.");
    if (run.taskId) {
      if (!this.tasks) throw new Error("Canonical Task service is unavailable.");
      const task = await this.tasks.get(run.taskId);
      if (!task) throw new Error("Automation Task is missing; refusing to recreate it.");
      await assertAutomationTaskOwnership(this.store, run, task);
      const stopping = await this.store.transaction(async () => {
        const row = await this.store.db
          .prepare("SELECT value FROM automation_runs WHERE id=? AND automation_id=?")
          .get(run.id, automationId);
        const current = row ? (JSON.parse(String(row.value)) as HostAutomationRun) : undefined;
        if (!current || !["pending", "running"].includes(current.status))
          throw new Error("Automation run is no longer active.");
        return this.writeRun({ ...current, cancellationRequested: true });
      });
      if (task.status === "todo") {
        const cancelled = await this.store.transaction(async () => {
          const currentTask = await this.tasks!.get(task.id);
          if (!currentTask) throw new Error("Automation Task is missing; refusing to recreate it.");
          await assertAutomationTaskOwnership(this.store, stopping, currentTask);
          await assertUnstartedAutomationTaskRetired(this.store, currentTask);
          return this.finish(stopping, "cancelled", undefined, this.now());
        });
        return { requested: true, run: cancelled };
      }
      if (task.status === "queued" || task.status === "running" || task.status === "verifying")
        await stopAutomationTask(this.store, this.tasks, task);
      await this.settle(stopping, this.now());
      return {
        requested: true,
        run: (await this.runs(automationId)).find((item) => item.id === run.id) ?? stopping,
      };
    }
    if ((run as ManagedAutomationRun).workPending === true) {
      await cancelSessionWorkOccurrence(this.store, {
        kind: "automation",
        id: automationId,
        occurrence: runId,
      });
      const work = (await bindSessionWork(this.store, this.engine).work.list()).find(
        (item) =>
          item.source.kind === "automation" &&
          item.source.id === automationId &&
          item.source.occurrence === runId,
      );
      // A stop request for dispatched work does not prove physical retirement.
      if (run.status === "pending" && (!work || work.state === "completed"))
        return { requested: true, run: await this.finish(run, "cancelled", undefined, this.now()) };
    } else if (run.status === "running") await cancelSessionRun(this.engine, run);
    else throw new Error("Automation run is not running.");
    return { requested: true, run };
  }
  /** Settles finished runs, stops runs past their time limit, starts due ones. */
  tick(): Promise<void> {
    if (this.closing) return Promise.resolve();
    this.ticking ??= this.work().finally(() => {
      this.ticking = undefined;
    });
    return this.ticking;
  }
  private async work(): Promise<void> {
    await this.ready;
    await this.outbox.drain((event) => this.recordEvent(event));

    const now = this.now();
    for (const run of await this.activeRuns()) {
      try {
        if (run.cleanupPending) await this.releaseFailedRunActivity(run);
        else await this.settle(run, now);
      } catch (error) {
        console.error("Could not settle an automation run:", errorMessage(error));
      }
    }
    for (const automation of await this.list()) {
      if (this.closing) return;
      if (automation.trigger?.kind === "event") continue;
      if (!automation.enabled || automation.nextRunAt > now) continue;
      try {
        if (automation.trigger?.kind === "continuous" && (await this.hasActiveRun(automation.id)))
          continue;
        const scheduledFor = automation.nextRunAt;
        const once = (await this.onceRunAt(automation.id)) !== undefined;
        const due = await this.write({
          ...automation,
          ...(once
            ? { enabled: false }
            : {
                nextRunAt:
                  automation.trigger?.kind === "continuous"
                    ? now + automation.trigger.minimumGapMinutes * 60000
                    : nextAutomationRunAt(automation, now),
              }),
        });
        if (once) await this.clearOnce(automation.id);
        const run = await this.newRun(due, "scheduled", scheduledFor);
        if (
          automation.trigger?.kind !== "continuous" &&
          now - scheduledFor >
            (automation.missedRunGraceMinutes === undefined
              ? MISSED_RUN_GRACE_MS
              : automation.missedRunGraceMinutes * 60000)
        )
          await this.finish(run, "skipped", MISSED_RUN_SKIP, now);
        else await this.launch(due, run, now, once);
      } catch (error) {
        console.error("Could not start an automation:", errorMessage(error));
      }
    }
  }
  /** Producers supply an immutable transition identity; retries never create another run. */
  async recordEvent(event: {
    id: string;
    kind: "task.finished" | "task.blocked" | "session.waiting" | "automation.failed";
    projectId?: string;
  }): Promise<void> {
    await this.ready;
    if (
      !event.id ||
      event.id.length > 300 ||
      !["task.finished", "task.blocked", "session.waiting", "automation.failed"].includes(
        event.kind,
      )
    )
      throw new Error("Invalid automation event.");
    await this.store.transaction(async () => {
      for (const automation of await this.list()) {
        const previous = await this.store.db
          .prepare(
            "SELECT kind,project_id FROM automation_events WHERE automation_id=? AND event_id=?",
          )
          .get(automation.id, event.id);
        if (previous) {
          if (
            previous.kind !== event.kind ||
            (previous.project_id ?? undefined) !== event.projectId
          )
            throw new Error("Automation event identity changed.");
          continue;
        }
        if (
          !automation.enabled ||
          automation.trigger?.kind !== "event" ||
          automation.trigger.event !== event.kind ||
          (automation.projectId && automation.projectId !== event.projectId)
        )
          continue;
        const run = await this.newRun(automation, "event", this.now());
        await this.writeRun({ ...run, workPending: true } as ManagedAutomationRun);
        await this.store.db
          .prepare("INSERT INTO automation_events VALUES (?,?,?,?,?)")
          .run(automation.id, event.id, event.kind, event.projectId ?? null, run.id);
      }
    }, "critical");
  }
  private async find(id: string): Promise<HostAutomation | undefined> {
    const row = await this.store.db.prepare("SELECT value FROM automations WHERE id=?").get(id);
    return row ? (JSON.parse(String(row.value)) as HostAutomation) : undefined;
  }
  private async write(automation: HostAutomation): Promise<HostAutomation> {
    await this.store.db.checkAuthorization();
    await this.store.db
      .prepare(
        "INSERT INTO automations VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(automation.id, JSON.stringify(automation));
    return automation;
  }
  private async writeRun(run: HostAutomationRun): Promise<HostAutomationRun> {
    await this.store.db.checkAuthorization();
    await this.store.db
      .prepare(
        "INSERT INTO automation_runs VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(run.id, run.automationId, run.createdAt, JSON.stringify(run));
    return run;
  }
  private async newRun(
    automation: HostAutomation,
    trigger: HostAutomationRun["trigger"],
    scheduledFor: number,
  ): Promise<HostAutomationRun> {
    return await this.writeRun({
      id: randomUUID(),
      automationId: automation.id,
      trigger,
      scheduledFor,
      createdAt: this.now(),
      status: "pending",
    });
  }
  private async hasRunningRun(automationId: string, exceptId = ""): Promise<boolean> {
    return Boolean(
      await this.store.db
        .prepare(
          "SELECT 1 FROM automation_runs WHERE automation_id=? AND (json_extract(value, '$.status')='running' OR (json_extract(value, '$.status')='pending' AND json_extract(value, '$.taskId') IS NOT NULL)) AND id<>? LIMIT 1",
        )
        .get(automationId, exceptId),
    );
  }
  private async hasActiveRun(automationId: string): Promise<boolean> {
    return Boolean(
      await this.store.db
        .prepare(
          "SELECT 1 FROM automation_runs WHERE automation_id=? AND json_extract(value, '$.status') IN ('pending','running') LIMIT 1",
        )
        .get(automationId),
    );
  }
  private async activeRuns(): Promise<HostAutomationRun[]> {
    // SQL narrows history before parsing; pending managed ownership remains recoverable.
    return (
      await this.store.db
        .prepare(
          `SELECT r.value FROM automation_runs r JOIN automations a ON a.id=r.automation_id WHERE json_extract(r.value, '$.status')='running' OR (json_extract(r.value, '$.status')='failed' AND json_type(r.value, '$.cleanupPending')='true') OR (json_extract(r.value, '$.status')='pending' AND (${truthyJson("r.value", "$.workspaceId")} OR json_type(r.value, '$.workPending')='true' OR ${truthyJson("r.value", "$.taskId")})) ORDER BY json_extract(a.value, '$.createdAt'), r.created_at DESC, r.rowid DESC`,
        )
        .all()
    )
      .map((row) => JSON.parse(String(row.value)) as ManagedAutomationRun)
      .filter((run) => run.status !== "pending" || !this.launching.has(run.automationId));
  }
  private async dailyLimitSkip(
    automation: HostAutomation,
    runId: string,
    now: number,
  ): Promise<string | null> {
    const { maxRunsPerDay } = automationLimits(automation);
    if (maxRunsPerDay <= 0) return null;
    const dayStart = ownerDayBounds(now, Intl.DateTimeFormat().resolvedOptions().timeZone)?.start;
    if (dayStart === undefined) throw new Error("Could not resolve automation owner day.");
    const row = await this.store.db
      .prepare(
        "SELECT COUNT(*) AS count FROM automation_runs WHERE automation_id=? AND COALESCE(json_extract(value, '$.startedAt'), CASE WHEN json_extract(value, '$.taskId') IS NOT NULL THEN json_extract(value, '$.createdAt') END)>=? AND id<>? AND COALESCE(json_extract(value, '$.status'),'')<>'skipped'",
      )
      .get(automation.id, dayStart, runId);
    if (!row) throw new Error("Could not read automation daily run count.");
    if (Number(row.count) < maxRunsPerDay) return null;
    return `Skipped: reached the limit of ${maxRunsPerDay} ${maxRunsPerDay === 1 ? "run" : "runs"} per day.`;
  }
  private async launch(
    automation: HostAutomation,
    run: ManagedAutomationRun,
    now: number,
    once = false,
  ): Promise<HostAutomationRun> {
    if (this.roomParentAdmission && !(await this.roomParentAdmission(automation, run)))
      return this.finish(run, "skipped", "Original Room automation was stopped.", now);
    if (this.launching.has(automation.id))
      return this.finish(run, "skipped", PREVIOUS_RUN_SKIP, now);
    this.launching.add(automation.id);
    let accepted: { sessionId: string; runId?: string } | undefined;
    try {
      const skip = (await this.hasRunningRun(automation.id, run.id))
        ? PREVIOUS_RUN_SKIP
        : run.trigger === "manual"
          ? null
          : await this.dailyLimitSkip(automation, run.id, now);
      if (skip) return await this.finish(run, "skipped", skip, now);
      if (this.closing)
        return await this.finish(run, "skipped", "Skipped: the host is stopping.", now);
      if (!run.sessionId && !run.execution) {
        const routing = hostModelRoutingService(this.store);
        const resolution = await resolveModelChoice(routing, {
          role: "automation",
          choice: automation.modelChoice,
          fixed: {
            harness: automation.harness,
            providerAccountId: automation.providerAccountId,
            model: automation.model,
            modelSettings: automation.modelSettings,
          },
        });
        if (!resolution.ok && resolution.reason === "noEligibleEntry") {
          if (once)
            await this.store.transaction(async () => {
              const current = await this.find(automation.id);
              // Rearm only the one-time schedule this launch disabled, preserving owner edits.
              if (!current || current.enabled || current.updatedAt !== automation.updatedAt) return;
              await this.write({ ...current, enabled: true });
              await this.scheduleOnce(
                automation.id,
                Math.max(now + TICK_MS, resolution.nextResetAt ?? 0),
              );
            });
          return await this.finish(
            run,
            "skipped",
            `Skipped: no eligible automation model (${resolution.skipped.map((entry) => `${entry.entryId}: ${entry.reason}`).join(", ")}).`,
            now,
          );
        }
        const execution = resolution.ok
          ? resolution.target
          : {
              harness: automation.harness,
              providerAccountId: automation.providerAccountId,
              model: automation.model,
              modelSettings: automation.modelSettings,
            };
        run = {
          ...run,
          execution,
          maxRunMinutes:
            automation.maxRunMinutes || (await routing.get()).defaultMaxRunMinutes || 0,
        };
        await this.writeRun(run);
      }
      if (run.execution) automation = { ...automation, ...run.execution };
      if (!automation.projectId) {
        const runtime = getSessionWork(this.store);
        if (!runtime) throw new Error("Shared Work admission is unavailable.");
        run = { ...run, workPending: true };
        await this.writeRun(run);
        const work = await runtime.submit({
          source: { kind: "automation", id: automation.id, occurrence: run.id },
          payload: { executor: "room-automation", prompt: automation.prompt, model: run.execution },
        });
        const started = await runtime.start(work.id);
        if (started.receipt)
          return this.retainOwnedRun(run, {
            status: "running",
            startedAt: now,
            ...started.receipt,
          });
        return this.retainOwnedRun(run, { status: "pending" });
      }
      // Existing direct-session occurrences retain their original recovery owner.
      // New project occurrences are Tasks; only Task runtime creates sessions/workspaces.
      if (!run.sessionId) {
        if (!this.tasks) throw new Error("Canonical Task service is unavailable.");
        if (automation.template?.kind === "project-scan") {
          if (!this.projectScan) throw new Error("Project scan migration service is unavailable.");
          automation = {
            ...automation,
            prompt: await this.projectScan.prepare(automation.template.sourceStewardId),
          };
        }
        return await createAutomationTask(this.store, this.tasks, automation, run);
      }
      const mode = await writerWorkspaceMode(
        this.store,
        this.workspaces,
        automation.projectId,
        automation.isolate,
      );
      let workspace: Awaited<ReturnType<WorkspaceRegistry["prepare"]>>["workspace"] | undefined;
      if (mode === "worktree") {
        if (!this.workspaces)
          throw new Error("Update the Host to enable managed automation workspaces.");
        await this.store.db.checkAuthorization();
        workspace = (
          await this.workspaces.registry.prepare({
            idempotencyKey: `automation:${run.id}`,
            projectId: automation.projectId,
            environmentId: this.workspaces.environmentId,
            owner: { kind: "automationRun", id: run.id },
            slug: automation.name,
            choice: { defaultMode: "worktree" },
          })
        ).workspace;
        if (
          workspace.owner.kind !== "automationRun" ||
          workspace.owner.id !== run.id ||
          workspace.projectId !== automation.projectId ||
          workspace.directoryState !== "present"
        )
          throw new Error("The managed workspace does not belong to this automation run.");
        run = { ...run, workspaceId: workspace.id };
        await this.writeRun(run);
        await this.store.db.checkAuthorization();
        const activity = await this.workspaces.activity.start({
          workspaceId: workspace.id,
          kind: "provider",
          ownerId: run.id,
        });
        run = { ...run, activityId: activity.id };
        await this.writeRun(run);
      }
      // Persist producer ownership before Work admission, including capacity waits.
      run = { ...run, workPending: true };
      await this.writeRun(run);
      const cwd = workspace?.path ?? (await this.store.project(automation.projectId)).cwd;
      const started = await launchSessionRun(
        this.store,
        {
          command: async (command) => {
            const receipt = await this.engine.command(command);
            const type = (command as { type?: unknown }).type;
            if (type === "create") run = { ...run, sessionId: receipt.sessionId };
            if (type === "send") accepted = { sessionId: receipt.sessionId, runId: receipt.runId };
            return receipt;
          },
          updateSession: (...args) => this.engine.updateSession(...args),
          withMessageAuthor: this.engine.withMessageAuthor?.bind(this.engine),
        },
        {
          projectId: automation.projectId,
          author: {
            // Work occurrence belongs to the durable automation run.
            kind: "automation",
            id: automation.id,
            name: automation.name,
            reason: "kickoff",
          },
          harness: automation.harness,
          work: { kind: "automation", id: automation.id, occurrence: run.id },
          providerAccountId: automation.providerAccountId,
          model: automation.model,
          modelSettings: automation.modelSettings,
          runtimeMode: automation.runtimeMode,
          title: automation.name,
          prompt: workspace
            ? `Work only in ${workspace.path} on ${workspace.branchRef}. Commit scoped changes on this branch and leave a clean tree. Integration, push and PR publication require separate owner approval.\n\n${automation.prompt}`
            : `Work directly in ${cwd}, the current checkout shared with other sessions. Preserve their work and leave your changes uncommitted for owner review. Do not create a worktree, switch branches, stage, commit, merge, push or create PRs.\n\n${automation.prompt}`,
          ...(workspace
            ? { worktreeCwd: workspace.path, workspaceId: workspace.id }
            : { workspaceMode: "current" as const }),
        },
        async () => {
          if (this.closing) return false;
          const current = await this.store.db
            .prepare("SELECT value FROM automation_runs WHERE id=? AND automation_id=?")
            .get(run.id, automation.id);
          if (!current) return false;
          const latest = JSON.parse(String(current.value)) as HostAutomationRun;
          return (
            latest.status === "pending" ||
            (latest.status === "running" &&
              accepted !== undefined &&
              latest.sessionId === accepted.sessionId &&
              latest.runId === accepted.runId)
          );
        },
      );
      if (accepted) {
        // The engine's durable send receipt, not the creator's subsequent
        // connection/grant, owns the accepted run. SQL bookkeeping only.
        return this.retainOwnedRun(run, {
          status: "running",
          startedAt: now,
          ...accepted,
        });
      }
      if (started.deferred) {
        const retained = await this.retainOwnedRun(run, { status: "pending" });
        // Preparation may have acquired activity after a concurrent pending stop.
        if (retained.status === "cancelled") return this.finish(run, "cancelled", undefined, now);
        return retained;
      }
      if (started.error !== undefined)
        return await this.finish(
          { ...run, sessionId: started.sessionId },
          "failed",
          started.error,
          now,
        );
      return await this.writeRun({
        ...run,
        status: "running",
        startedAt: now,
        sessionId: started.sessionId,
        runId: started.runId,
      });
    } catch (error) {
      if (accepted)
        return this.retainOwnedRun(run, { status: "running", startedAt: now, ...accepted });
      try {
        await this.store.db.checkAuthorization();
      } catch (revoked) {
        // A created pending run must not remain forever pending after denied
        // preparation. Never bypass authority for finish's workspace effects.
        await this.retainOwnedRun(run, {
          status: "failed",
          completedAt: now,
          error: errorMessage(revoked),
          ...(run.activityId ? { cleanupPending: true } : {}),
        });
        throw revoked;
      }
      return this.finish(run, "failed", errorMessage(error), now);
    } finally {
      this.launching.delete(automation.id);
    }
  }
  /** CAS only the already-owned pending row; never resurrect deleted history,
   * overwrite a settled run, update concurrent configuration, or start effects. */
  private retainOwnedRun(
    owned: ManagedAutomationRun,
    patch: Partial<HostAutomationRun>,
  ): Promise<HostAutomationRun> {
    return this.store.db.runRecoveryBookkeeping(() =>
      this.store.db.scope(async () => {
        const row = await this.store.db
          .prepare("SELECT value FROM automation_runs WHERE id=? AND automation_id=?")
          .get(owned.id, owned.automationId);
        if (!row) throw new Error("Automation run history was removed during preparation.");
        const current = JSON.parse(String(row.value)) as ManagedAutomationRun;
        if (
          current.id !== owned.id ||
          current.automationId !== owned.automationId ||
          current.createdAt !== owned.createdAt
        )
          throw new Error("Automation run identity changed during preparation.");
        if (current.status !== "pending") return current;
        const retained = {
          ...current,
          ...(owned.workspaceId ? { workspaceId: owned.workspaceId } : {}),
          ...(owned.activityId ? { activityId: owned.activityId } : {}),
          ...(owned.sessionId ? { sessionId: owned.sessionId } : {}),
          ...patch,
        };
        if (retained.status === "failed" && retained.activityId) retained.cleanupPending = true;
        await this.store.db
          .prepare("UPDATE automation_runs SET value=? WHERE id=? AND automation_id=? AND value=?")
          .run(JSON.stringify(retained), owned.id, owned.automationId, String(row.value));
        return retained;
      }),
    );
  }
  private async settle(run: HostAutomationRun, now: number): Promise<void> {
    const automation = await this.find(run.automationId);
    if (run.taskId) {
      await this.store.transaction(async () => {
        if (!this.tasks) throw new Error("Canonical Task service is unavailable.");
        const row = await this.store.db
          .prepare("SELECT value FROM automation_runs WHERE id=? AND automation_id=?")
          .get(run.id, run.automationId);
        if (!row) return;
        const current = JSON.parse(String(row.value)) as HostAutomationRun;
        if (!current.taskId || !["pending", "running"].includes(current.status)) return;
        const task = await this.tasks.get(current.taskId);
        if (!task) {
          await this.finish(
            current,
            "failed",
            "Automation Task is missing; refusing to recreate it.",
            now,
          );
          return;
        }
        if (current.cancellationRequested && task.status === "todo") {
          await assertAutomationTaskOwnership(this.store, current, task);
          await assertUnstartedAutomationTaskRetired(this.store, task);
          await this.finish(current, "cancelled", undefined, now);
          return;
        }
        const state =
          task.status === "running" && task.sessionId && task.runId
            ? await sessionRunState(
                this.store,
                { ...task, startedAt: task.startedAt ?? task.createdAt },
                0,
                now,
              )
            : undefined;
        const projection = automationTaskProjection(
          current,
          task,
          state?.state === "running" && state.needsInput,
        );
        if (
          projection.status === "failed" ||
          projection.status === "succeeded" ||
          projection.status === "cancelled"
        )
          await this.finish(
            { ...current, ...projection },
            projection.status,
            projection.error,
            now,
          );
        else {
          await this.writeRun({ ...current, ...projection });
          const latest = await this.find(run.automationId);
          if (latest && latest.needsInput !== projection.needsInput)
            await this.write({ ...latest, needsInput: projection.needsInput });
        }
      });
      return;
    }
    if (
      run.status === "pending" &&
      run.trigger === "event" &&
      (await this.hasRunningRun(run.automationId, run.id))
    )
      return;
    if (automation && !automation.projectId) {
      const runtime = getSessionWork(this.store);
      if (!runtime) return;
      const work = (await runtime.list()).find(
        (item) =>
          item.source.kind === "automation" &&
          item.source.id === automation.id &&
          item.source.occurrence === run.id,
      );
      if (!work) {
        if (run.status === "pending") await this.launch(automation, run, now, !automation.enabled);
        return;
      }
      if (work.state === "queued" || work.state === "waiting") await runtime.start(work.id);
      const current = await runtime.get(work.id);
      if (current.state === "completed" && current.outcome)
        await this.finish(
          run,
          current.outcome.status === "succeeded"
            ? "succeeded"
            : current.outcome.status === "cancelled"
              ? "cancelled"
              : "failed",
          current.outcome.message,
          now,
        );
      else if (current.receipt && run.status === "pending")
        await this.retainOwnedRun(run, { status: "running", startedAt: now, ...current.receipt });
      return;
    }
    if (run.status === "pending") {
      if (automation) await this.launch(automation, run, now, !automation.enabled);
      return;
    }
    const outcome = await sessionRunState(
      this.store,
      { ...run, startedAt: run.startedAt ?? run.createdAt },
      run.maxRunMinutes ?? (automation ? automationLimits(automation).maxRunMinutes : 0),
      now,
    );
    if (outcome.state === "running") {
      if (
        outcome.needsInput !== Boolean(run.needsInput) ||
        outcome.needsInput !== Boolean(automation?.needsInput)
      ) {
        const needsInput = outcome.needsInput || undefined;
        await this.writeRun({ ...run, needsInput });
        // Also on the automation, so a desktop sees it without asking for runs.
        if (automation) await this.write({ ...automation, needsInput });
      }
      return;
    }
    if (outcome.state === "overLimit") {
      // The reason is saved first: the turn settles asynchronously, and a
      // later tick records it as the run's outcome.
      await this.writeRun({ ...run, error: outcome.error });
      await cancelSessionRun(this.engine, run);
      return;
    }
    await this.finish(run, outcome.status, outcome.error, now);
  }
  /** Compensate only a reservation this exact failed run already owns. The
   * autonomous tick retries failure; no provider signal or workspace mutation. */
  private async releaseFailedRunActivity(run: ManagedAutomationRun): Promise<void> {
    if (!this.workspaces || !run.workspaceId || !run.activityId)
      throw new Error("Failed automation activity ownership is incomplete.");
    const workspace = await this.workspaces.registry.get({ workspaceId: run.workspaceId });
    if (
      !workspace ||
      workspace.id !== run.workspaceId ||
      workspace.owner.kind !== "automationRun" ||
      workspace.owner.id !== run.id
    )
      throw new Error("Failed automation workspace ownership changed.");
    const activity = (await this.workspaces.activity.list(run.workspaceId)).find(
      (entry) => entry.id === run.activityId,
    );
    if (
      activity &&
      (activity.workspaceId !== run.workspaceId ||
        activity.ownerId !== run.id ||
        activity.kind !== "provider")
    )
      throw new Error("Failed automation activity ownership changed.");
    await this.store.db.checkAuthorization();
    if (activity) await this.workspaces.activity.stop(run.activityId);
    const { cleanupPending: _cleanupPending, ...settled } = run;
    await this.store.db
      .prepare("UPDATE automation_runs SET value=? WHERE id=? AND automation_id=? AND value=?")
      .run(JSON.stringify(settled), run.id, run.automationId, JSON.stringify(run));
  }
  private async finish(
    run: ManagedAutomationRun,
    status: HostAutomationRun["status"],
    error: string | undefined,
    now: number,
  ): Promise<HostAutomationRun> {
    await this.store.db.checkAuthorization();
    if (run.activityId) await this.workspaces?.activity.stop(run.activityId);
    if (run.workspaceId && this.workspaces) {
      const workspace = await this.workspaces.registry.get({ workspaceId: run.workspaceId });
      if (workspace) {
        const mutation = {
          workspaceId: workspace.id,
          expectedRevision: workspace.revision,
          idempotencyKey: `automation:${run.id}:finish`,
        };
        // A failed/cancelled run remains resumable; only successful work is finished.
        if (status === "succeeded") {
          const preview = await previewTaskFinalization(workspace.path, workspace.branchRef);
          if (!preview.clean) {
            status = "failed";
            error =
              "Finalization requires review: commit the intended automation changes on its assigned branch before delivery.";
          } else {
            await this.store.db.checkAuthorization();
            await this.workspaces.registry.finish(mutation);
          }
        }
      }
    }
    return this.store.db.scope(async () => {
      const definition = await this.find(run.automationId);
      if (status === "succeeded" && definition?.template?.kind === "project-scan") {
        if (!this.projectScan || !run.sessionId)
          throw new Error("Project scan result service is unavailable.");
        await this.projectScan.completed(definition.template.sourceStewardId, run.sessionId);
      }
      const finished = await this.writeRun({
        ...run,
        status,
        completedAt: now,
        error: error || undefined,
        needsInput: undefined,
      });
      const automation = await this.find(run.automationId);
      if (automation)
        await this.write({
          ...automation,
          lastRunAt: now,
          lastRunStatus: status,
          lastRunError: finished.error,
          lastSessionId: finished.sessionId ?? automation.lastSessionId,
          ...(automation.trigger?.kind === "continuous"
            ? { nextRunAt: now + automation.trigger.minimumGapMinutes * 60000 }
            : {}),
          needsInput:
            Boolean(
              await this.store.db
                .prepare(
                  `SELECT 1 FROM automation_runs WHERE automation_id=? AND json_extract(value, '$.status')='running' AND ${truthyJson("value", "$.needsInput")} LIMIT 1`,
                )
                .get(run.automationId),
            ) || undefined,
        });
      const dayStart = ownerDayBounds(now, Intl.DateTimeFormat().resolvedOptions().timeZone)?.start;
      if (dayStart === undefined) throw new Error("Could not resolve automation owner day.");
      await this.store.db
        .prepare(
          "DELETE FROM automation_runs WHERE automation_id=? AND json_extract(value, '$.status') NOT IN ('pending','running') AND NOT COALESCE(json_extract(value, '$.cleanupPending'), 0) AND json_extract(value, '$.nativeRunId') IS NULL AND COALESCE(json_extract(value, '$.startedAt'), 0) < ? AND id NOT IN (SELECT id FROM automation_runs WHERE automation_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?)",
        )
        .run(run.automationId, dayStart, run.automationId, MAX_RUNS_PER_AUTOMATION);
      return finished;
    });
  }
}
