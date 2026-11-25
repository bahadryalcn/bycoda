import type { HostAutomations } from "../automations/automations";
import { migrateSteward } from "../automations/steward-migration";
import { routingRun, type RoutedRun } from "../tasks/model-routing";
import { bindSessionWork } from "../work/session-adapter";
import { parseHostSteward } from "./routing-input";
import { assertExpectedConfiguration } from "../configurationConflict";
import { createHash, randomUUID } from "node:crypto";
import { createWork } from "../tasks/work-request";
import { nextAutomationRunAt } from "../../src/features/automations/model/automationSchedule";
import {
  MAX_DECLINED,
  normalizeStewardTitle,
  parseStewardProposals,
  type HostSteward as StoredHostSteward,
} from "../../src/features/tasks/model/hostStewards";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import type { HostEngine } from "../engine";
import type { SessionRunEngine } from "../sessions/sessionRuns";
import type { HostStore } from "../store";
import type { HostTasks } from "../tasks/tasks";
import type { HostAutomationRun } from "../../src/features/automations/model/hostAutomations";

type HostSteward = StoredHostSteward &
  RoutedRun & { deliveryApprovalRequired?: boolean; providerAccountId?: string };

/** How many finished tasks the prompt lists, newest first. */
const DONE_TITLES_IN_PROMPT = 30;

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

/** Owns each project's steward definition, its proposals and the owner's
 * declined titles. The schedule and the run itself belong to the project-scan
 * automation every steward is bound to. */
export class HostStewards {
  onDelete?: (steward: { id: string; projectId: string }) => void;
  private closing = false;
  private disposal?: Promise<void>;
  private readonly manualRuns = new Set<Promise<HostSteward>>();

  private automations?: HostAutomations;
  private readonly migrated = new Map<string, string>();
  async bindAutomations(automations: HostAutomations): Promise<void> {
    await Promise.all([this.ready, automations.ready]);
    this.automations = automations;
    automations.projectScan = {
      create: async (input) => {
        if (await this.find(input.id)) throw new Error("Project scan ID already exists.");
        const steward = await this.save({
          ...input,
          focus: input.prompt,
          time: input.time ?? "09:00",
        });
        const id = this.migrated.get(steward.id);
        const automation = id && (await automations.list()).find((item) => item.id === id);
        if (!automation) throw new Error("Project scan creation failed.");
        return automation;
      },
      update: async (input, id) => {
        const previous = await this.find(id);
        if (!previous || previous.projectId !== input.projectId)
          throw new Error("Project scan source is missing or belongs to another project.");
        await this.save({
          ...previous,
          ...input,
          id,
          focus: input.prompt,
          time: input.time ?? "09:00",
          expectedConfiguration: previous,
        });
      },
      prepare: async (id) => {
        const steward = await this.find(id);
        if (!steward) throw new Error("Project scan source is missing.");
        const tasks = await this.tasks.list();
        const open = tasks.filter(
          (task) =>
            task.source === "steward" &&
            task.projectId === steward.projectId &&
            (task.status === "todo" || task.status === "queued"),
        ).length;
        if (open >= steward.maxOpen) throw new Error(openLimitSkip(steward.maxOpen));
        return stewardPrompt(
          steward,
          await this.store.project(steward.projectId),
          tasks,
          undefined,
        );
      },
      completed: async (id, sessionId) => {
        const steward = await this.find(id);
        if (!steward) throw new Error("Project scan source is missing.");
        const proposed = await this.propose(steward, await this.reply(sessionId), sessionId);
        await this.write({ ...steward, lastProposed: proposed, lastSessionId: sessionId });
      },
    };
    for (const steward of await this.list())
      this.migrated.set(steward.id, await migrateSteward(this.store, steward));
  }
  readonly ready: Promise<void>;
  constructor(
    private readonly store: HostStore,
    engine: SessionRunEngine & Pick<HostEngine, "waitForRun">,
    private readonly tasks: HostTasks,
    private readonly now: () => number = Date.now,
  ) {
    if (engine.withCommandAdmission) bindSessionWork(store, engine, tasks.limits, now);
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
      });
    })();
  }

  close(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.closing = true;
    this.disposal = (async () => {
      await this.ready;
      await Promise.allSettled(this.manualRuns);
    })();
    return this.disposal;
  }

  async list(): Promise<HostSteward[]> {
    await this.ready;

    const definitions = (await this.store.db.prepare("SELECT value FROM stewards").all())
      .map((row) => JSON.parse(String(row.value)) as HostSteward)
      .sort((a, b) => a.createdAt - b.createdAt);
    if (!this.automations || !this.migrated.size) return definitions;
    const automations = new Map((await this.automations.list()).map((item) => [item.id, item]));
    return definitions.map((steward) => {
      const automation = automations.get(this.migrated.get(steward.id) ?? "");
      return automation
        ? {
            ...steward,
            enabled: automation.enabled,
            nextRunAt: automation.nextRunAt,
            lastRunAt: automation.lastRunAt ?? steward.lastRunAt,
            lastRunStatus:
              automation.lastRunStatus === "pending"
                ? steward.lastRunStatus
                : (automation.lastRunStatus ?? steward.lastRunStatus),
            lastRunError: automation.lastRunError,
            lastSessionId: automation.lastSessionId ?? steward.lastSessionId,
          }
        : steward;
    });
  }

  withAuthorization<T>(authorized: () => Promise<boolean>, work: () => Promise<T>): Promise<T> {
    return this.store.db.withAuthorization(authorized, async () => {
      await this.store.db.checkAuthorization();
      return work();
    });
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
      const saved = await this.write({
        ...input,
        deliveryApprovalRequired: previous?.deliveryApprovalRequired,
        nextRunAt: nextAutomationRunAt(input, now),
        lastRunAt: previous?.lastRunAt,
        lastRunStatus: previous?.lastRunStatus,
        lastRunError: previous?.lastRunError,
        lastSessionId: previous?.lastSessionId,
        lastProposed: previous?.lastProposed,
        declined: previous?.declined ?? [],
        createdAt: previous?.createdAt ?? now,
        updatedAt: Math.max(now, (previous?.updatedAt ?? -1) + 1),
      });
      if (this.automations)
        this.migrated.set(saved.id, await migrateSteward(this.store, saved, true));
      return saved;
    });
  }

  /** Deletes a steward and its automation, which stops its run. Its proposals
   * stay on the board. */
  async delete(id: string): Promise<void> {
    await this.ready;

    const steward = await this.find(id);
    if (!steward) return;
    const automationId = this.migrated.get(id);
    if (automationId && this.automations) await this.automations.delete(automationId);
    this.migrated.delete(id);
    await this.store.db.checkAuthorization();
    const deleted = await this.store.db.prepare("DELETE FROM stewards WHERE id=?").run(id);
    if (Number(deleted.changes) > 0)
      this.store.afterCommit(() => this.onDelete?.({ id, projectId: steward.projectId }));
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
    const automationId = this.migrated.get(id);
    if (!automationId || !this.automations) throw new Error("Steward automation is unavailable.");
    await this.automations.runNow(automationId);
    return (await this.list()).find((item) => item.id === id) ?? steward;
  }

  /** Cancels the bound automation's current run. */
  async stopRun(id: string): Promise<{ requested: true; run: HostAutomationRun }> {
    await this.ready;

    const automationId = this.migrated.get(id);
    if (!automationId || !this.automations) throw new Error("Steward automation is unavailable.");
    const active = (await this.automations.runs(automationId)).find(
      (run) => run.status === "pending" || run.status === "running",
    );
    if (!active) throw new Error("Steward has no active run.");
    return this.automations.stopRun(automationId, active.id);
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

  private async find(id: string): Promise<HostSteward | undefined> {
    const row = await this.store.db.prepare("SELECT value FROM stewards WHERE id=?").get(id);
    return row ? (JSON.parse(String(row.value)) as HostSteward) : undefined;
  }

  private async write(steward: HostSteward): Promise<HostSteward> {
    if (steward.autoMerge)
      steward = { ...steward, autoMerge: undefined, deliveryApprovalRequired: true };
    await this.store.db.checkAuthorization();
    await this.store.db
      .prepare(
        "INSERT INTO stewards VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(steward.id, JSON.stringify(steward));
    return steward;
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
  private async propose(
    steward: HostSteward,
    reply: string,
    runId: string = randomUUID(),
  ): Promise<number> {
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
      const requestId = `${runId}:${title}`;
      await createWork(
        { store: this.store, tasks: this.tasks },
        {
          id: `steward-${createHash("sha256").update(requestId).digest("hex").slice(0, 32)}`,
          projectId: latest.projectId,
          request: proposal.description,
          title: proposal.title,
          source: { kind: "steward" },
          execution: {
            harness: latest.harness,
            providerAccountId: latest.providerAccountId,
            modelChoice: routingRun(latest).modelChoice ?? { kind: "fixed" },
            model: latest.model,
            modelSettings: latest.modelSettings,
            runtimeMode: latest.runtimeMode,
          },
          options: {
            ...(latest.isolate !== undefined ? { isolate: latest.isolate } : {}),
            // Persistent preferences cannot authorize a new delivery.
            ...(latest.deliveryApprovalRequired ? { deliveryApprovalRequired: true } : {}),
            source: "steward",
            stewardId: latest.id,
            // A proposal without a description cannot be started by an agent.
            status: latest.autoStart && proposal.description ? "queued" : "todo",
          },
        },
        { requestId },
      );
      created += 1;
    }
    return created;
  }
}
