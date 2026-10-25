import { flatMapAsync } from "./async-collections";
import { randomUUID } from "node:crypto";
import { assertExpectedConfiguration } from "./configurationConflict";
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
const TICK_MS = 30000;
const MAX_RUNS_PER_AUTOMATION = 100;
/** A run this overdue was missed while the machine was off or asleep. */
const MISSED_RUN_GRACE_MS = 12 * 60 * 60000;
export const MISSED_RUN_SKIP = "Skipped: missed while this machine was off.";
export const PREVIOUS_RUN_SKIP = "Skipped: the previous run is still going.";
/** Runs saved automations on this machine's own clock, so they keep going
 * with no desktop open. Each run is an ordinary host session. */
export class HostAutomations {
  private timer?: ReturnType<typeof setInterval>;
  private ticking?: Promise<void>;
  private closing = false;
  private disposal?: Promise<void>;
  private readonly manualRuns = new Set<Promise<HostAutomationRun>>();
  private readonly launching = new Set<string>();
  readonly ready: Promise<void>;
  constructor(
    private readonly store: HostStore,
    private readonly engine: SessionRunEngine,
    private readonly now: () => number = Date.now,
  ) {
    this.ready = (async () => {
      await store.ready;
      await store.db.scope(async () => {
        await store.db.exec(`
      CREATE TABLE IF NOT EXISTS automations (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS automation_runs (id TEXT PRIMARY KEY, automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS automation_runs_history_idx ON automation_runs (automation_id, created_at DESC);`);
      });
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
    return this.store.db.scope(async () => {
      const input = parseHostAutomation(raw);
      await this.store.project(input.projectId);
      const now = this.now();
      const previous = await this.find(input.id);
      assertExpectedConfiguration(raw, previous, parseHostAutomation);
      return await this.write({
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
    });
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
      nextRunAt: nextAutomationRunAt(input, this.now()),
    };
  }
  async delete(id: string): Promise<void> {
    await this.ready;

    if ((await this.runs(id)).some((run) => run.status === "running")) {
      throw new Error("This automation is still running. Stop its session before deleting it.");
    }
    await this.store.db.prepare("DELETE FROM automations WHERE id=?").run(id);
  }
  runNow(id: string): Promise<HostAutomationRun> {
    if (this.closing) return Promise.reject(new Error("Automation service is closing."));
    const pending = this.runNowOwned(id);
    this.manualRuns.add(pending);
    void pending.then(
      () => this.manualRuns.delete(pending),
      () => this.manualRuns.delete(pending),
    );
    return pending;
  }
  private async runNowOwned(id: string): Promise<HostAutomationRun> {
    if (this.closing) throw new Error("Automation service is closing.");
    await this.ready;

    const automation = await this.find(id);
    if (!automation) throw new Error("Automation not found.");
    const now = this.now();
    return await this.launch(automation, await this.newRun(automation, "manual", now), now);
  }
  async stopRun(
    automationId: string,
    runId: string,
  ): Promise<{
    requested: true;
    run: HostAutomationRun;
  }> {
    await this.ready;

    const run = (await this.runs(automationId)).find((entry) => entry.id === runId);
    if (!run || run.status !== "running") throw new Error("Automation run is not running.");
    await cancelSessionRun(this.engine, run);
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

    const now = this.now();
    for (const run of await this.activeRuns()) {
      try {
        await this.settle(run, now);
      } catch (error) {
        console.error("Could not settle an automation run:", errorMessage(error));
      }
    }
    for (const automation of await this.list()) {
      if (this.closing) return;
      if (!automation.enabled || automation.nextRunAt > now) continue;
      try {
        const scheduledFor = automation.nextRunAt;
        const due = await this.write({
          ...automation,
          nextRunAt: nextAutomationRunAt(automation, now),
        });
        const run = await this.newRun(due, "scheduled", scheduledFor);
        if (now - scheduledFor > MISSED_RUN_GRACE_MS)
          await this.finish(run, "skipped", MISSED_RUN_SKIP, now);
        else await this.launch(due, run, now);
      } catch (error) {
        console.error("Could not start an automation:", errorMessage(error));
      }
    }
  }
  private async find(id: string): Promise<HostAutomation | undefined> {
    const row = await this.store.db.prepare("SELECT value FROM automations WHERE id=?").get(id);
    return row ? (JSON.parse(String(row.value)) as HostAutomation) : undefined;
  }
  private async write(automation: HostAutomation): Promise<HostAutomation> {
    await this.store.db
      .prepare(
        "INSERT INTO automations VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(automation.id, JSON.stringify(automation));
    return automation;
  }
  private async writeRun(run: HostAutomationRun): Promise<HostAutomationRun> {
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
  private async activeRuns(): Promise<HostAutomationRun[]> {
    return (
      await flatMapAsync(await this.list(), async (automation) => await this.runs(automation.id))
    ).filter((run) => run.status === "running");
  }
  private async launch(
    automation: HostAutomation,
    run: HostAutomationRun,
    now: number,
  ): Promise<HostAutomationRun> {
    if (this.launching.has(automation.id))
      return this.finish(run, "skipped", PREVIOUS_RUN_SKIP, now);
    this.launching.add(automation.id);
    try {
      const history = await this.runs(automation.id);
      const skip = history.some((other) => other.id !== run.id && other.status === "running")
        ? PREVIOUS_RUN_SKIP
        : run.trigger === "manual"
          ? null
          : dailyRunLimitSkip(automationLimits(automation), history, run.id, now);
      if (skip) return await this.finish(run, "skipped", skip, now);
      if (this.closing) return this.finish(run, "skipped", "Skipped: the host is stopping.", now);
      const started = await launchSessionRun(
        this.store,
        this.engine,
        {
          projectId: automation.projectId,
          harness: automation.harness,
          model: automation.model,
          modelSettings: automation.modelSettings,
          runtimeMode: automation.runtimeMode,
          title: automation.name,
          prompt: automation.prompt,
        },
        () => !this.closing,
      );
      if (started.deferred)
        return this.finish(run, "skipped", "Skipped: the host is stopping.", now);
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
    } finally {
      this.launching.delete(automation.id);
    }
  }
  private async settle(run: HostAutomationRun, now: number): Promise<void> {
    const automation = await this.find(run.automationId);
    const outcome = await sessionRunState(
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
  private async finish(
    run: HostAutomationRun,
    status: HostAutomationRun["status"],
    error: string | undefined,
    now: number,
  ): Promise<HostAutomationRun> {
    return this.store.db.scope(async () => {
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
          needsInput:
            (await this.runs(run.automationId)).some(
              (other) => other.status === "running" && other.needsInput,
            ) || undefined,
        });
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      await this.store.db
        .prepare(
          "DELETE FROM automation_runs WHERE automation_id=? AND json_extract(value, '$.status') NOT IN ('pending','running') AND COALESCE(json_extract(value, '$.startedAt'), 0) < ? AND id NOT IN (SELECT id FROM automation_runs WHERE automation_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?)",
        )
        .run(run.automationId, dayStart.getTime(), run.automationId, MAX_RUNS_PER_AUTOMATION);
      return finished;
    });
  }
}
