import { randomUUID } from "node:crypto";
import {
  automationLimits,
  dailyRunLimitSkip,
} from "../src/features/automations/model/automationLimits";
import { nextAutomationRunAt } from "../src/features/automations/model/automationSchedule";
import {
  parseHostAutomation,
  type HostAutomation,
  type HostAutomationRun,
} from "../src/features/automations/model/hostAutomations";
import {
  cancelSessionRun,
  errorMessage,
  launchSessionRun,
  sessionRunState,
  type SessionRunEngine,
} from "./sessionRuns";
import type { HostStore } from "./store";

const TICK_MS = 30_000;
const MAX_RUNS_PER_AUTOMATION = 100;
/** A run this overdue was missed while the machine was off or asleep. */
const MISSED_RUN_GRACE_MS = 12 * 60 * 60_000;

export const MISSED_RUN_SKIP = "Skipped: missed while this machine was off.";
export const PREVIOUS_RUN_SKIP = "Skipped: the previous run is still going.";

/** Runs saved automations on this machine's own clock, so they keep going
 * with no desktop open. Each run is an ordinary host session. */
export class HostAutomations {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly store: HostStore,
    private readonly engine: SessionRunEngine,
    private readonly now: () => number = Date.now,
  ) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS automations (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS automation_runs (id TEXT PRIMARY KEY, automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS automation_runs_history_idx ON automation_runs (automation_id, created_at DESC);`);
  }

  start(): void {
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  list(): HostAutomation[] {
    return this.store.db
      .prepare("SELECT value FROM automations")
      .all()
      .map((row) => JSON.parse(String(row.value)) as HostAutomation)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Newest first. */
  runs(automationId: string): HostAutomationRun[] {
    return this.store.db
      .prepare(
        "SELECT value FROM automation_runs WHERE automation_id=? ORDER BY created_at DESC, rowid DESC",
      )
      .all(automationId)
      .map((row) => JSON.parse(String(row.value)) as HostAutomationRun);
  }

  save(raw: unknown): HostAutomation {
    const input = parseHostAutomation(raw);
    this.store.project(input.projectId);
    const now = this.now();
    const previous = this.find(input.id);
    return this.write({
      ...input,
      nextRunAt: nextAutomationRunAt(input, now),
      lastRunAt: previous?.lastRunAt,
      lastRunStatus: previous?.lastRunStatus,
      lastRunError: previous?.lastRunError,
      lastSessionId: previous?.lastSessionId,
      needsInput: previous?.needsInput,
      createdAt: previous?.createdAt ?? now,
      updatedAt: Math.max(now, (previous?.updatedAt ?? -1) + 1),
    });
  }

  delete(id: string): void {
    if (this.runs(id).some((run) => run.status === "running")) {
      throw new Error("This automation is still running. Stop its session before deleting it.");
    }
    this.store.db.prepare("DELETE FROM automations WHERE id=?").run(id);
  }

  runNow(id: string): HostAutomationRun {
    const automation = this.find(id);
    if (!automation) throw new Error("Automation not found.");
    const now = this.now();
    return this.launch(automation, this.newRun(automation, "manual", now), now);
  }

  stopRun(automationId: string, runId: string): { requested: true; run: HostAutomationRun } {
    const run = this.runs(automationId).find((entry) => entry.id === runId);
    if (!run || run.status !== "running") throw new Error("Automation run is not running.");
    cancelSessionRun(this.engine, run);
    return { requested: true, run };
  }

  /** Settles finished runs, stops runs past their time limit, starts due ones. */
  tick(): void {
    const now = this.now();
    for (const run of this.activeRuns()) {
      try {
        this.settle(run, now);
      } catch (error) {
        console.error("Could not settle an automation run:", errorMessage(error));
      }
    }
    for (const automation of this.list()) {
      if (!automation.enabled || automation.nextRunAt > now) continue;
      try {
        const scheduledFor = automation.nextRunAt;
        const due = this.write({
          ...automation,
          nextRunAt: nextAutomationRunAt(automation, now),
        });
        const run = this.newRun(due, "scheduled", scheduledFor);
        if (now - scheduledFor > MISSED_RUN_GRACE_MS)
          this.finish(run, "skipped", MISSED_RUN_SKIP, now);
        else this.launch(due, run, now);
      } catch (error) {
        console.error("Could not start an automation:", errorMessage(error));
      }
    }
  }

  private find(id: string): HostAutomation | undefined {
    const row = this.store.db.prepare("SELECT value FROM automations WHERE id=?").get(id);
    return row ? (JSON.parse(String(row.value)) as HostAutomation) : undefined;
  }

  private write(automation: HostAutomation): HostAutomation {
    this.store.db
      .prepare(
        "INSERT INTO automations VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(automation.id, JSON.stringify(automation));
    return automation;
  }

  private writeRun(run: HostAutomationRun): HostAutomationRun {
    this.store.db
      .prepare(
        "INSERT INTO automation_runs VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(run.id, run.automationId, run.createdAt, JSON.stringify(run));
    return run;
  }

  private newRun(
    automation: HostAutomation,
    trigger: HostAutomationRun["trigger"],
    scheduledFor: number,
  ): HostAutomationRun {
    return this.writeRun({
      id: randomUUID(),
      automationId: automation.id,
      trigger,
      scheduledFor,
      createdAt: this.now(),
      status: "pending",
    });
  }

  private activeRuns(): HostAutomationRun[] {
    return this.list()
      .flatMap((automation) => this.runs(automation.id))
      .filter((run) => run.status === "running");
  }

  private launch(
    automation: HostAutomation,
    run: HostAutomationRun,
    now: number,
  ): HostAutomationRun {
    const history = this.runs(automation.id);
    const skip = history.some((other) => other.id !== run.id && other.status === "running")
      ? PREVIOUS_RUN_SKIP
      : run.trigger === "manual"
        ? null
        : dailyRunLimitSkip(automationLimits(automation), history, run.id, now);
    if (skip) return this.finish(run, "skipped", skip, now);
    const started = launchSessionRun(this.store, this.engine, {
      projectId: automation.projectId,
      harness: automation.harness,
      model: automation.model,
      modelSettings: automation.modelSettings,
      runtimeMode: automation.runtimeMode,
      title: automation.name,
      prompt: automation.prompt,
    });
    if (started.error !== undefined)
      return this.finish({ ...run, sessionId: started.sessionId }, "failed", started.error, now);
    return this.writeRun({
      ...run,
      status: "running",
      startedAt: now,
      sessionId: started.sessionId,
      runId: started.runId,
    });
  }

  private settle(run: HostAutomationRun, now: number): void {
    const automation = this.find(run.automationId);
    const outcome = sessionRunState(
      this.store,
      { ...run, startedAt: run.startedAt ?? run.createdAt },
      automation ? automationLimits(automation).maxRunMinutes : 0,
      now,
    );
    if (outcome.state === "running") {
      if (
        outcome.needsInput !== Boolean(run.needsInput) ||
        outcome.needsInput !== Boolean(automation?.needsInput)
      ) {
        const needsInput = outcome.needsInput || undefined;
        this.writeRun({ ...run, needsInput });
        // Also on the automation, so a desktop sees it without asking for runs.
        if (automation) this.write({ ...automation, needsInput });
      }
      return;
    }
    if (outcome.state === "overLimit") {
      // The reason is saved first: the turn settles asynchronously, and a
      // later tick records it as the run's outcome.
      this.writeRun({ ...run, error: outcome.error });
      cancelSessionRun(this.engine, run);
      return;
    }
    this.finish(run, outcome.status, outcome.error, now);
  }

  private finish(
    run: HostAutomationRun,
    status: HostAutomationRun["status"],
    error: string | undefined,
    now: number,
  ): HostAutomationRun {
    const finished = this.writeRun({
      ...run,
      status,
      completedAt: now,
      error: error || undefined,
      needsInput: undefined,
    });
    const automation = this.find(run.automationId);
    if (automation)
      this.write({
        ...automation,
        lastRunAt: now,
        lastRunStatus: status,
        lastRunError: finished.error,
        lastSessionId: finished.sessionId ?? automation.lastSessionId,
        needsInput:
          this.runs(run.automationId).some(
            (other) => other.status === "running" && other.needsInput,
          ) || undefined,
      });
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    this.store.db
      .prepare(
        "DELETE FROM automation_runs WHERE automation_id=? AND json_extract(value, '$.status') NOT IN ('pending','running') AND COALESCE(json_extract(value, '$.startedAt'), 0) < ? AND id NOT IN (SELECT id FROM automation_runs WHERE automation_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?)",
      )
      .run(run.automationId, dayStart.getTime(), run.automationId, MAX_RUNS_PER_AUTOMATION);
    return finished;
  }
}
