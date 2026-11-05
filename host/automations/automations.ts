import { ownerDayBounds } from "../../src/shared/lib/time/ownerDay";
import { randomUUID } from "node:crypto";
import { assertExpectedConfiguration } from "../configurationConflict";
import { automationLimits } from "../../src/features/automations/model/automationLimits";
import { nextAutomationRunAt } from "../../src/features/automations/model/automationSchedule";
import {
  parseHostAutomation,
  type HostAutomation,
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
type ManagedAutomationRun = StoredAutomationRun & { workspaceId?: string; activityId?: string };
const TICK_MS = 30000;
const MAX_RUNS_PER_AUTOMATION = 100;
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
  onDelete?: (automation: { id: string }) => void;
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
      CREATE TABLE IF NOT EXISTS automation_runs (id TEXT PRIMARY KEY, automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS automation_runs_history_idx ON automation_runs (automation_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS automation_runs_status_idx ON automation_runs (automation_id, json_extract(value, '$.status'));
      CREATE INDEX IF NOT EXISTS automation_runs_started_idx ON automation_runs (automation_id, json_extract(value, '$.startedAt'));
      CREATE INDEX IF NOT EXISTS automation_runs_cleanup_idx ON automation_runs (json_extract(value, '$.status'), json_extract(value, '$.cleanupPending'));`);
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
    return this.store.db.scope(async () => {
      const input = parseHostAutomation(raw);
      await this.store.project(input.projectId);
      const now = this.now();
      const previous = await this.find(input.id);
      if ((raw as { expectedAbsent?: unknown }).expectedAbsent === true && previous)
        throw new Error("Automation ID already exists. Choose a new ID.");
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
        if (run.cleanupPending) await this.releaseFailedRunActivity(run);
        else await this.settle(run, now);
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
          "SELECT 1 FROM automation_runs WHERE automation_id=? AND json_extract(value, '$.status')='running' AND id<>? LIMIT 1",
        )
        .get(automationId, exceptId),
    );
  }
  private async activeRuns(): Promise<HostAutomationRun[]> {
    // SQL narrows history before parsing; pending managed ownership remains recoverable.
    return (
      await this.store.db
        .prepare(
          `SELECT r.value FROM automation_runs r JOIN automations a ON a.id=r.automation_id WHERE json_extract(r.value, '$.status')='running' OR (json_extract(r.value, '$.status')='failed' AND json_type(r.value, '$.cleanupPending')='true') OR (json_extract(r.value, '$.status')='pending' AND ${truthyJson("r.value", "$.workspaceId")}) ORDER BY json_extract(a.value, '$.createdAt'), r.created_at DESC, r.rowid DESC`,
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
        "SELECT COUNT(*) AS count FROM automation_runs WHERE automation_id=? AND json_extract(value, '$.startedAt')>=? AND id<>? AND COALESCE(json_extract(value, '$.status'),'')<>'skipped'",
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
  ): Promise<HostAutomationRun> {
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
            kind: "automation",
            id: automation.id,
            name: automation.name,
            reason: "kickoff",
          },
          harness: automation.harness,
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
        () => !this.closing,
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
      if (started.deferred)
        return await this.finish(run, "skipped", "Skipped: the host is stopping.", now);
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
          "DELETE FROM automation_runs WHERE automation_id=? AND json_extract(value, '$.status') NOT IN ('pending','running') AND NOT COALESCE(json_extract(value, '$.cleanupPending'), 0) AND COALESCE(json_extract(value, '$.startedAt'), 0) < ? AND id NOT IN (SELECT id FROM automation_runs WHERE automation_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?)",
        )
        .run(run.automationId, dayStart, run.automationId, MAX_RUNS_PER_AUTOMATION);
      return finished;
    });
  }
}
