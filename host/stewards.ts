import { assertExpectedConfiguration } from "./configurationConflict";
import { randomUUID } from "node:crypto";
import { nextAutomationRunAt } from "../src/features/automations/model/automationSchedule";
import {
  MAX_DECLINED,
  normalizeStewardTitle,
  parseHostSteward,
  parseStewardProposals,
  type HostSteward as StoredHostSteward,
  type StewardRunStatus,
} from "../src/features/tasks/model/hostStewards";
import { DAILY_LIMIT_SKIP } from "../src/features/tasks/model/hostSettings";
import type { HostTask } from "../src/features/tasks/model/hostTasks";
import type { HostEngine } from "./engine";
import {
  cancelSessionRun,
  errorMessage,
  launchSessionRun,
  sessionRunState,
  type SessionRunEngine,
} from "./sessionRuns";
import type { HostStore } from "./store";
import type { HostTasks } from "./tasks";
import type {
  ExecutionActivityReservations,
  WorkspaceRegistry,
  WorkspaceRemovalService,
} from "./workspace-service-contracts";
type ManagedStewardRun = NonNullable<HostSteward["run"]> & {
  workspaceId?: string;
  activityId?: string;
};
type HostSteward = StoredHostSteward & { deliveryApprovalRequired?: boolean };
export interface StewardWorkspaceServices {
  registry: WorkspaceRegistry;
  activity: ExecutionActivityReservations;
  removal: WorkspaceRemovalService;
  environmentId: string;
}

const TICK_MS = 30_000;
/** How long a steward run may go on. */
export const STEWARD_RUN_MINUTES = 20;
/** How many finished tasks the prompt lists, newest first. */
const DONE_TITLES_IN_PROMPT = 30;

export const PREVIOUS_RUN_SKIP = "Skipped: the previous run is still going.";
export const openLimitSkip = (maxOpen: number) =>
  `Skipped: ${maxOpen} suggestions are still waiting to be started or declined.`;

const OPEN_STATUSES = new Set(["todo", "queued", "running", "verifying", "review", "blocked"]);

function stewardPrompt(
  steward: HostSteward,
  project: { name: string; cwd: string },
  tasks: readonly HostTask[],
  checkout: string | undefined,
): string {
  const own = tasks.filter((task) => task.projectId === steward.projectId);
  const open = own.filter((task) => OPEN_STATUSES.has(task.status));
  const done = own
    .filter((task) => task.status === "done")
    .sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt))
    .slice(0, DONE_TITLES_IN_PROMPT);
  const list = (titles: readonly string[]) =>
    titles.length ? titles.map((title) => `- ${title}`) : ["- (none)"];
  return [
    `You are the steward of the project “${project.name}”. Your job is to look at the project and propose the next pieces of work for coding agents to carry out. You only propose; you do not do the work.`,
    "",
    checkout
      ? `You are in ${checkout}, your managed worktree of the project at its selected committed base. Its branch is retained after directory retirement.`
      : `You are in ${project.cwd}, the project folder itself.`,
    "You must NOT modify, create or delete any files, and you must NOT run commands that change state (no installs, builds that write files, commits, branch changes or network writes). Read files and run read-only commands only.",
    "",
    steward.focus
      ? `What to look for: ${steward.focus}`
      : "What to look for: whatever would move the project forward most: bugs, missing tests, unfinished features and the roadmap if there is one.",
    "",
    "Work that is already on the board (do not propose these again):",
    ...list(open.map((task) => task.title)),
    "",
    `Recently finished (do not propose these again):`,
    ...list(done.map((task) => task.title)),
    ...(steward.declined.length
      ? [
          "",
          "Suggestions the owner declined (do not propose these or close variants):",
          ...list(steward.declined),
        ]
      : []),
    "",
    `Propose at most ${steward.maxProposals} pieces of work. Each description must be specific enough to hand to a coding agent as is: what to change, where in the project, and the acceptance criteria. Each agent sees nothing but its description. Propose nothing when there is nothing worth doing.`,
    "",
    "Do not use plan mode or ask for approval; write your answer in your reply.",
    "End your reply with a fenced ```json block of exactly this shape:",
    '{"proposals":[{"title":"short title","description":"what, where and acceptance criteria"}]}',
  ].join("\n");
}

/** Runs each project's steward on its schedule: an agent that reads the
 * project in a throwaway checkout and proposes work as to-do items on the task
 * board. Runs on this machine's own clock, with no desktop open. */
export class HostStewards {
  private closing = false;
  private disposal?: Promise<void>;
  private readonly manualRuns = new Set<Promise<HostSteward>>();
  private timer?: ReturnType<typeof setInterval>;
  private ticking?: Promise<void>;
  /** Stewards whose run is being started, so a second start does not overlap. */
  private readonly starting = new Set<string>();

  readonly ready: Promise<void>;
  constructor(
    private readonly store: HostStore,
    private readonly engine: SessionRunEngine & Pick<HostEngine, "waitForRun">,
    private readonly tasks: HostTasks,
    private readonly now: () => number = Date.now,
    private readonly workspaces?: StewardWorkspaceServices,
  ) {
    this.ready = (async () => {
      await store.ready;
      await tasks.ready;
      await store.db.scope(async () => {
        await store.db.exec(
          "CREATE TABLE IF NOT EXISTS stewards (id TEXT PRIMARY KEY, value TEXT NOT NULL);",
        );
        await store.db.exec(
          "UPDATE stewards SET value=json_set(json_remove(value, '$.autoMerge'), '$.deliveryApprovalRequired', json('true')) WHERE json_extract(value, '$.autoMerge')=1",
        );
        tasks.limits.track(async () =>
          (await this.list()).flatMap((steward) => (steward.run ? [steward.run.startedAt] : [])),
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
          .catch((error) => console.error("Steward scheduling failed:", error));
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
      await Promise.allSettled([...this.manualRuns]);
      await this.idle();
    })();
    return this.disposal;
  }

  /** Resolves once no tick is in progress. */
  async idle(): Promise<void> {
    await this.ready;

    while (this.ticking || this.starting.size)
      await (this.ticking ?? new Promise((resolve) => setTimeout(resolve, 5)));
  }

  async list(): Promise<HostSteward[]> {
    await this.ready;

    return (await this.store.db.prepare("SELECT value FROM stewards").all())
      .map((row) => JSON.parse(String(row.value)) as HostSteward)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Adds or edits a steward. A project has at most one. */
  async save(raw: unknown): Promise<HostSteward> {
    await this.ready;
    return this.store.db.scope(async () => {
      const input = parseHostSteward(raw);
      await this.store.project(input.projectId);
      if (
        (await this.list()).some(
          (other) => other.projectId === input.projectId && other.id !== input.id,
        )
      )
        throw new Error("This project already has a steward.");
      const now = this.now();
      const previous = await this.find(input.id);
      assertExpectedConfiguration(raw, previous, parseHostSteward);
      if (
        previous &&
        previous.projectId !== input.projectId &&
        (previous.run || this.starting.has(input.id))
      )
        throw new Error("Wait for the steward run to finish before changing its project.");
      return await this.write({
        ...input,
        deliveryApprovalRequired: previous?.deliveryApprovalRequired,
        nextRunAt: nextAutomationRunAt(input, now),
        lastRunAt: previous?.lastRunAt,
        lastRunStatus: previous?.lastRunStatus,
        lastRunError: previous?.lastRunError,
        lastSessionId: previous?.lastSessionId,
        lastProposed: previous?.lastProposed,
        declined: previous?.declined ?? [],
        run: previous?.run,
        createdAt: previous?.createdAt ?? now,
        updatedAt: Math.max(now, (previous?.updatedAt ?? -1) + 1),
      });
    });
  }

  /** Deletes a steward, stopping its run. Its proposals stay on the board. */
  async delete(id: string): Promise<void> {
    await this.ready;

    const steward = await this.find(id);
    if (!steward) return;
    await this.store.db.prepare("DELETE FROM stewards WHERE id=?").run(id);
    if (steward.run) {
      try {
        await cancelSessionRun(this.engine, steward.run);
        await this.tasks.limits.record(steward.run.startedAt, this.now());
      } catch {
        /* the session is gone */
      }
      await this.engine.waitForRun(steward.run.sessionId ?? "", steward.run.runId);
      await this.removeWorktree(steward.projectId, steward.run);
    }
  }

  /** Starts a run now, whatever the schedule says. */
  runNow(id: string): Promise<HostSteward> {
    if (this.closing) return Promise.reject(new Error("Steward service is closing."));
    const pending = this.runNowOwned(id);
    this.manualRuns.add(pending);
    void pending.then(
      () => this.manualRuns.delete(pending),
      () => this.manualRuns.delete(pending),
    );
    return pending;
  }
  private async runNowOwned(id: string): Promise<HostSteward> {
    if (this.closing) throw new Error("Steward service is closing.");
    await this.ready;

    const steward = await this.find(id);
    if (!steward) throw new Error("Steward not found.");
    await this.begin(steward, this.now());
    return (await this.find(id)) ?? steward;
  }

  /** Cancels only the named active turn. The normal tick settles and cleans it. */
  async stopRun(
    id: string,
    runId: string,
  ): Promise<{ requested: true; run: NonNullable<HostSteward["run"]> }> {
    await this.ready;

    const steward = await this.find(id);
    if (!steward?.run || steward.run.runId !== runId)
      throw new Error("Steward run is no longer active. Read it before stopping.");
    await cancelSessionRun(this.engine, steward.run);
    return { requested: true, run: steward.run };
  }

  /** Deletes a to-do proposal and remembers its title, so the steward does not
   * propose it again. */
  async decline(taskId: string): Promise<void> {
    await this.ready;

    const task = await this.tasks.get(taskId);
    if (!task) throw new Error("Task not found.");
    if (task.source !== "steward" || task.status !== "todo")
      throw new Error("Only a to-do suggestion from a steward can be declined.");
    // A dependency/branch guard may reject deletion. Do not suppress a proposal
    // title until its task has actually been removed.
    await this.tasks.delete(taskId);
    const steward = task.stewardId ? await this.find(task.stewardId) : undefined;
    if (steward) {
      const title = normalizeStewardTitle(task.title);
      const declined = [
        ...steward.declined.filter((entry) => entry !== title),
        ...(title ? [title] : []),
      ].slice(-MAX_DECLINED);
      await this.write({ ...steward, declined, updatedAt: this.now() });
    }
  }

  /** Settles finished runs, stops runs past their time limit, starts due ones.
   * A tick already in progress is not joined by a second one. */
  tick(): Promise<void> {
    if (this.closing) return Promise.resolve();
    this.ticking ??= this.work().finally(() => {
      this.ticking = undefined;
    });
    return this.ticking;
  }

  private async work(): Promise<void> {
    const now = this.now();
    for (const steward of await this.list()) {
      if (this.closing) return;
      if (!steward.run) continue;
      try {
        await this.settle(steward, now);
      } catch (error) {
        console.error("Could not settle a steward run:", errorMessage(error));
      }
    }
    for (const steward of await this.list()) {
      if (this.closing) return;
      if (!steward.enabled || steward.nextRunAt > now) continue;
      try {
        const due = await this.write({
          ...steward,
          nextRunAt: nextAutomationRunAt(steward, now),
        });
        await this.begin(due, now);
      } catch (error) {
        console.error("Could not start a steward:", errorMessage(error));
      }
    }
  }

  private async find(id: string): Promise<HostSteward | undefined> {
    const row = await this.store.db.prepare("SELECT value FROM stewards WHERE id=?").get(id);
    return row ? (JSON.parse(String(row.value)) as HostSteward) : undefined;
  }

  private async write(steward: HostSteward): Promise<HostSteward> {
    if (steward.autoMerge)
      steward = { ...steward, autoMerge: undefined, deliveryApprovalRequired: true };
    await this.store.db
      .prepare(
        "INSERT INTO stewards VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(steward.id, JSON.stringify(steward));
    return steward;
  }

  /** Records how a run that did not (or no longer does) go on ended. */
  private async finish(
    steward: HostSteward,
    status: StewardRunStatus,
    error: string | undefined,
    now: number,
    proposed?: number,
  ): Promise<HostSteward> {
    return this.store.db.scope(async () => {
      // Read again: the owner may have edited or declined meanwhile.
      const latest = await this.find(steward.id);
      if (!latest) return steward;
      const { run, ...rest } = latest;
      return await this.write({
        ...rest,
        lastRunAt: now,
        lastRunStatus: status,
        lastRunError: error || undefined,
        lastSessionId: run?.sessionId ?? steward.run?.sessionId ?? latest.lastSessionId,
        ...(proposed !== undefined ? { lastProposed: proposed } : {}),
      });
    });
  }

  /** Records a skipped run. A run still going is left as it is. */
  private async skip(steward: HostSteward, reason: string, now: number): Promise<void> {
    return this.store.db.scope(async () => {
      const latest = await this.find(steward.id);
      if (!latest) return;
      await this.write({
        ...latest,
        lastRunAt: now,
        lastRunStatus: "skipped",
        lastRunError: reason,
      });
    });
  }

  /** Starts a run unless the steward must skip it. */
  private async begin(steward: HostSteward, now: number): Promise<void> {
    if (this.closing) return;
    if (this.starting.has(steward.id)) {
      await this.skip(steward, PREVIOUS_RUN_SKIP, now);
      return;
    }
    this.starting.add(steward.id);
    try {
      if ((await this.find(steward.id))?.run) {
        await this.skip(steward, PREVIOUS_RUN_SKIP, now);
        return;
      }
      if (await this.tasks.limits.reached()) {
        await this.skip(steward, DAILY_LIMIT_SKIP, now);
        return;
      }
      const open = (await this.tasks.list()).filter(
        (task) =>
          task.source === "steward" &&
          task.projectId === steward.projectId &&
          (task.status === "todo" || task.status === "queued"),
      ).length;
      if (open >= steward.maxOpen) {
        await this.skip(steward, openLimitSkip(steward.maxOpen), now);
        return;
      }
      const project = await this.store.project(steward.projectId);
      let worktree: { path: string; branch: string; workspaceId: string; activityId?: string };
      try {
        if (!this.workspaces)
          throw new Error("Update the Host to enable managed steward workspaces.");
        const ownerId = randomUUID();
        const { workspace } = await this.workspaces.registry.prepare({
          idempotencyKey: `steward:${ownerId}`,
          projectId: steward.projectId,
          environmentId: this.workspaces.environmentId,
          owner: { kind: "stewardRun", id: ownerId },
          slug: `steward-${project.name}`,
          choice: { defaultMode: "worktree" },
        });
        if (
          workspace.owner.kind !== "stewardRun" ||
          workspace.owner.id !== ownerId ||
          workspace.projectId !== steward.projectId ||
          workspace.directoryState !== "present"
        )
          throw new Error("The managed workspace does not belong to this steward run.");
        worktree = { path: workspace.path, branch: workspace.branchRef, workspaceId: workspace.id };
        await this.write({
          ...steward,
          run: {
            startedAt: now,
            worktreeCwd: workspace.path,
            branch: workspace.branchRef,
            ...{ workspaceId: workspace.id },
          },
        });
        const activity = await this.workspaces.activity.start({
          workspaceId: workspace.id,
          kind: "provider",
          ownerId,
        });
        worktree.activityId = activity.id;
        await this.write({
          ...steward,
          run: {
            startedAt: now,
            worktreeCwd: workspace.path,
            branch: workspace.branchRef,
            ...{ workspaceId: workspace.id, activityId: activity.id },
          },
        });
      } catch (error) {
        await this.finish(
          steward,
          "failed",
          `Could not create a checkout: ${errorMessage(error)}`,
          now,
        );
        return;
      }
      const prepared = {
        startedAt: now,
        worktreeCwd: worktree.path,
        branch: worktree.branch,
        workspaceId: worktree.workspaceId,
        activityId: worktree.activityId,
      };
      const prompt = stewardPrompt(steward, project, await this.tasks.list(), worktree.path);
      if (this.closing) {
        await this.removeWorktree(steward.projectId, prepared);
        await this.finish(steward, "cancelled", "Host is stopping.", now);
        return;
      }
      const started = await launchSessionRun(
        this.store,
        this.engine,
        {
          projectId: steward.projectId,
          harness: steward.harness,
          model: steward.model,
          modelSettings: steward.modelSettings,
          runtimeMode: steward.runtimeMode,
          title: `Steward: ${project.name}`.slice(0, 200),
          prompt,
          worktreeCwd: worktree.path,
          workspaceId: worktree.workspaceId,
        },
        () => !this.closing,
      );
      if (started.deferred) {
        await this.removeWorktree(steward.projectId, prepared);
        await this.finish(steward, "cancelled", "Host is stopping.", now);
        return;
      }
      const run: ManagedStewardRun = {
        ...prepared,
        sessionId: started.sessionId,
        runId: started.runId,
      };
      if (started.error !== undefined) {
        await this.removeWorktree(steward.projectId, run);
        await this.finish(
          { ...steward, run },
          "failed",
          `Could not start the steward: ${started.error}`,
          now,
        );
        return;
      }
      const latest = await this.find(steward.id);
      if (!latest) {
        // Deleted while its checkout was made.
        await cancelSessionRun(this.engine, run);
        await this.removeWorktree(steward.projectId, run);
        return;
      }
      await this.write({
        ...latest,
        run,
        lastRunStatus: "running",
        lastRunError: undefined,
        lastSessionId: started.sessionId ?? latest.lastSessionId,
      });
    } finally {
      this.starting.delete(steward.id);
    }
  }

  private async settle(steward: HostSteward, now: number): Promise<void> {
    const run = steward.run!;
    if (this.starting.has(steward.id)) return;
    const outcome = await sessionRunState(this.store, run, STEWARD_RUN_MINUTES, now);
    if (outcome.state === "running") return;
    if (outcome.state === "overLimit") {
      // The reason is saved first: the turn settles asynchronously, and a
      // later tick records it as the outcome.
      await this.write({ ...steward, run: { ...run, error: outcome.error } });
      await cancelSessionRun(this.engine, run);
      return;
    }
    await this.tasks.limits.record(run.startedAt, now);
    if (outcome.status !== "succeeded") {
      await this.removeWorktree(steward.projectId, run);
      await this.finish(
        steward,
        outcome.status === "cancelled" ? "cancelled" : "failed",
        outcome.error,
        now,
      );
      return;
    }
    let proposed: number;
    let failure: string | undefined;
    try {
      proposed = await this.propose(steward, await this.reply(run.sessionId ?? ""));
    } catch (error) {
      proposed = 0;
      failure = errorMessage(error);
    }
    await this.removeWorktree(steward.projectId, run);
    await this.finish(
      steward,
      failure === undefined ? "succeeded" : "failed",
      failure,
      now,
      proposed,
    );
  }

  /** The agent's whole last turn: the answer may sit in an earlier message
   * than its last one, or in a plan block. */
  private async reply(sessionId: string): Promise<string> {
    const blocks = (await this.store.session(sessionId)).session.blocks;
    const lastUser = blocks.findLastIndex((block) => block.role === "user");
    return blocks
      .slice(lastUser + 1)
      .filter((block) => (block.role === "assistant" || block.role === "plan") && block.text.trim())
      .map((block) => block.text)
      .join("\n\n");
  }

  /** Creates tasks for the reply's proposals that are new; returns how many. */
  private async propose(steward: HostSteward, reply: string): Promise<number> {
    const latest = (await this.find(steward.id)) ?? steward;
    const proposals = parseStewardProposals(reply, latest.maxProposals);
    const known = new Set(latest.declined);
    for (const task of await this.tasks.list())
      if (task.projectId === latest.projectId) known.add(normalizeStewardTitle(task.title));
    let created = 0;
    for (const proposal of proposals) {
      const title = normalizeStewardTitle(proposal.title);
      if (!title || known.has(title)) continue;
      known.add(title);
      await this.tasks.save({
        id: randomUUID(),
        title: proposal.title,
        prompt: proposal.description,
        projectId: latest.projectId,
        harness: latest.harness,
        model: latest.model,
        modelSettings: latest.modelSettings,
        runtimeMode: latest.runtimeMode,
        maxRunMinutes: 0,
        isolate: true,
        review: true,
        // Persistent preferences cannot authorize a new delivery.
        ...(latest.deliveryApprovalRequired ? { deliveryApprovalRequired: true } : {}),
        source: "steward",
        stewardId: latest.id,
        // A proposal without a description cannot be started by an agent.
        status: latest.autoStart && proposal.description ? "queued" : "todo",
      });
      created += 1;
    }
    return created;
  }

  /** Retire through S4. Unregistered legacy work and every branch are retained. */
  private async removeWorktree(
    _projectId: string,
    run?: { worktreeCwd?: string; branch?: string; workspaceId?: string; activityId?: string },
  ): Promise<void> {
    if (!run?.workspaceId || !this.workspaces) return;
    if (run.activityId) await this.workspaces.activity.stop(run.activityId);
    const workspace = await this.workspaces.registry.get({ workspaceId: run.workspaceId });
    if (!workspace) return;
    const closed = await this.workspaces.registry.close({
      workspaceId: workspace.id,
      expectedRevision: workspace.revision,
      idempotencyKey: `steward:${workspace.id}:close`,
    });
    try {
      const plan = await this.workspaces.removal.plan({
        workspaceId: closed.id,
        expectedRevision: closed.revision,
      });
      if (!plan.blockers.length && !plan.dirty)
        await this.workspaces.removal.apply(
          {
            workspaceId: closed.id,
            expectedRevision: closed.revision,
            idempotencyKey: `steward:${workspace.id}:retire`,
            planToken: plan.token,
          },
          { kind: "retentionScheduler" },
        );
    } catch (error) {
      console.error("Steward workspace retained:", errorMessage(error));
    }
  }
}
