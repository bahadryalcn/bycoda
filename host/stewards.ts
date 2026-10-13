import { runGitText } from "../src/shared/lib/processExecution.node";
import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { nextAutomationRunAt } from "../src/features/automations/model/automationSchedule";
import {
  MAX_DECLINED,
  normalizeStewardTitle,
  parseHostSteward,
  parseStewardProposals,
  type HostSteward,
  type StewardRunStatus,
} from "../src/features/tasks/model/hostStewards";
import { DAILY_LIMIT_SKIP } from "../src/features/tasks/model/hostSettings";
import type { HostTask } from "../src/features/tasks/model/hostTasks";
import { createHostWorktree, invalidateHostWorktrees } from "./git-worktrees";
import {
  cancelSessionRun,
  errorMessage,
  launchSessionRun,
  sessionRunState,
  type SessionRunEngine,
} from "./sessionRuns";
import type { HostStore } from "./store";
import type { HostTasks } from "./tasks";

const TICK_MS = 30_000;
/** How long a steward run may go on. */
export const STEWARD_RUN_MINUTES = 20;
/** How many finished tasks the prompt lists, newest first. */
const DONE_TITLES_IN_PROMPT = 30;

export const PREVIOUS_RUN_SKIP = "Skipped: the previous run is still going.";
export const openLimitSkip = (maxOpen: number) =>
  `Skipped: ${maxOpen} suggestions are still waiting to be started or declined.`;

const OPEN_STATUSES = new Set(["todo", "queued", "running", "verifying", "review", "blocked"]);

async function git(cwd: string, args: string[]): Promise<string> {
  const stdout = await runGitText(args, {
    cwd,
    timeout: 30_000,
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

/** Whether the folder is the top of a git working copy with a commit. */
async function isRepository(cwd: string): Promise<boolean> {
  try {
    const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
    if (realpathSync.native(top) !== realpathSync.native(cwd)) return false;
    await git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
    return true;
  } catch {
    return false;
  }
}

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
      ? `You are in ${checkout}, a throwaway checkout of the project at its latest commit.`
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
  private timer?: ReturnType<typeof setInterval>;
  private ticking?: Promise<void>;
  /** Stewards whose run is being started, so a second start does not overlap. */
  private readonly starting = new Set<string>();

  constructor(
    private readonly store: HostStore,
    private readonly engine: SessionRunEngine,
    private readonly tasks: HostTasks,
    private readonly now: () => number = Date.now,
  ) {
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS stewards (id TEXT PRIMARY KEY, value TEXT NOT NULL);",
    );
    tasks.limits.track(() =>
      this.list().flatMap((steward) => (steward.run ? [steward.run.startedAt] : [])),
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

  /** Resolves once no tick is in progress. */
  async idle(): Promise<void> {
    while (this.ticking || this.starting.size)
      await (this.ticking ?? new Promise((resolve) => setTimeout(resolve, 5)));
  }

  list(): HostSteward[] {
    return this.store.db
      .prepare("SELECT value FROM stewards")
      .all()
      .map((row) => JSON.parse(String(row.value)) as HostSteward)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Adds or edits a steward. A project has at most one. */
  save(raw: unknown): HostSteward {
    const input = parseHostSteward(raw);
    this.store.project(input.projectId);
    if (this.list().some((other) => other.projectId === input.projectId && other.id !== input.id))
      throw new Error("This project already has a steward.");
    const now = this.now();
    const previous = this.find(input.id);
    if (
      previous &&
      previous.projectId !== input.projectId &&
      (previous.run || this.starting.has(input.id))
    )
      throw new Error("Wait for the steward run to finish before changing its project.");
    return this.write({
      ...input,
      nextRunAt: nextAutomationRunAt(input, now),
      lastRunAt: previous?.lastRunAt,
      lastRunStatus: previous?.lastRunStatus,
      lastRunError: previous?.lastRunError,
      lastSessionId: previous?.lastSessionId,
      lastProposed: previous?.lastProposed,
      declined: previous?.declined ?? [],
      run: previous?.run,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    });
  }

  /** Deletes a steward, stopping its run. Its proposals stay on the board. */
  async delete(id: string): Promise<void> {
    const steward = this.find(id);
    if (!steward) return;
    this.store.db.prepare("DELETE FROM stewards WHERE id=?").run(id);
    if (steward.run) {
      try {
        cancelSessionRun(this.engine, steward.run);
        this.tasks.limits.record(steward.run.startedAt, this.now());
      } catch {
        /* the session is gone */
      }
      await this.removeWorktree(steward.projectId, steward.run);
    }
  }

  /** Starts a run now, whatever the schedule says. */
  async runNow(id: string): Promise<HostSteward> {
    const steward = this.find(id);
    if (!steward) throw new Error("Steward not found.");
    await this.begin(steward, this.now());
    return this.find(id) ?? steward;
  }

  /** Deletes a to-do proposal and remembers its title, so the steward does not
   * propose it again. */
  async decline(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("Task not found.");
    if (task.source !== "steward" || task.status !== "todo")
      throw new Error("Only a to-do suggestion from a steward can be declined.");
    const steward = task.stewardId ? this.find(task.stewardId) : undefined;
    if (steward) {
      const title = normalizeStewardTitle(task.title);
      const declined = [
        ...steward.declined.filter((entry) => entry !== title),
        ...(title ? [title] : []),
      ].slice(-MAX_DECLINED);
      this.write({ ...steward, declined, updatedAt: this.now() });
    }
    await this.tasks.delete(taskId);
  }

  /** Settles finished runs, stops runs past their time limit, starts due ones.
   * A tick already in progress is not joined by a second one. */
  tick(): Promise<void> {
    this.ticking ??= this.work().finally(() => {
      this.ticking = undefined;
    });
    return this.ticking;
  }

  private async work(): Promise<void> {
    const now = this.now();
    for (const steward of this.list()) {
      if (!steward.run) continue;
      try {
        await this.settle(steward, now);
      } catch (error) {
        console.error("Could not settle a steward run:", errorMessage(error));
      }
    }
    for (const steward of this.list()) {
      if (!steward.enabled || steward.nextRunAt > now) continue;
      try {
        const due = this.write({
          ...steward,
          nextRunAt: nextAutomationRunAt(steward, now),
        });
        await this.begin(due, now);
      } catch (error) {
        console.error("Could not start a steward:", errorMessage(error));
      }
    }
  }

  private find(id: string): HostSteward | undefined {
    const row = this.store.db.prepare("SELECT value FROM stewards WHERE id=?").get(id);
    return row ? (JSON.parse(String(row.value)) as HostSteward) : undefined;
  }

  private write(steward: HostSteward): HostSteward {
    this.store.db
      .prepare(
        "INSERT INTO stewards VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(steward.id, JSON.stringify(steward));
    return steward;
  }

  /** Records how a run that did not (or no longer does) go on ended. */
  private finish(
    steward: HostSteward,
    status: StewardRunStatus,
    error: string | undefined,
    now: number,
    proposed?: number,
  ): HostSteward {
    // Read again: the owner may have edited or declined meanwhile.
    const latest = this.find(steward.id);
    if (!latest) return steward;
    const { run, ...rest } = latest;
    return this.write({
      ...rest,
      lastRunAt: now,
      lastRunStatus: status,
      lastRunError: error || undefined,
      lastSessionId: run?.sessionId ?? steward.run?.sessionId ?? latest.lastSessionId,
      ...(proposed !== undefined ? { lastProposed: proposed } : {}),
    });
  }

  /** Records a skipped run. A run still going is left as it is. */
  private skip(steward: HostSteward, reason: string, now: number): void {
    const latest = this.find(steward.id);
    if (!latest) return;
    this.write({
      ...latest,
      lastRunAt: now,
      lastRunStatus: "skipped",
      lastRunError: reason,
    });
  }

  /** Starts a run unless the steward must skip it. */
  private async begin(steward: HostSteward, now: number): Promise<void> {
    if (this.starting.has(steward.id) || this.find(steward.id)?.run) {
      this.skip(steward, PREVIOUS_RUN_SKIP, now);
      return;
    }
    if (this.tasks.limits.reached()) {
      this.skip(steward, DAILY_LIMIT_SKIP, now);
      return;
    }
    this.starting.add(steward.id);
    try {
      const open = this.tasks
        .list()
        .filter(
          (task) =>
            task.source === "steward" &&
            task.projectId === steward.projectId &&
            (task.status === "todo" || task.status === "queued"),
        ).length;
      if (open >= steward.maxOpen) {
        this.skip(steward, openLimitSkip(steward.maxOpen), now);
        return;
      }
      const project = this.store.project(steward.projectId);
      let worktree: { path: string; branch: string } | undefined;
      try {
        if (await isRepository(project.cwd)) {
          const branch = `mc/${randomUUID().replace(/-/g, "").slice(0, 8)}`;
          const tree = await createHostWorktree(project.cwd, branch, "HEAD", false);
          worktree = { path: tree.path, branch };
        }
      } catch (error) {
        this.finish(steward, "failed", `Could not create a checkout: ${errorMessage(error)}`, now);
        return;
      }
      const started = launchSessionRun(this.store, this.engine, {
        projectId: steward.projectId,
        harness: steward.harness,
        model: steward.model,
        modelSettings: steward.modelSettings,
        runtimeMode: steward.runtimeMode,
        title: `Steward: ${project.name}`.slice(0, 200),
        prompt: stewardPrompt(steward, project, this.tasks.list(), worktree?.path),
        ...(worktree ? { worktreeCwd: worktree.path } : {}),
      });
      const run = {
        sessionId: started.sessionId,
        runId: started.runId,
        startedAt: now,
        worktreeCwd: worktree?.path,
        branch: worktree?.branch,
      };
      if (started.error !== undefined) {
        await this.removeWorktree(steward.projectId, run);
        this.finish(
          { ...steward, run },
          "failed",
          `Could not start the steward: ${started.error}`,
          now,
        );
        return;
      }
      const latest = this.find(steward.id);
      if (!latest) {
        // Deleted while its checkout was made.
        cancelSessionRun(this.engine, run);
        await this.removeWorktree(steward.projectId, run);
        return;
      }
      this.write({
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
    const outcome = sessionRunState(this.store, run, STEWARD_RUN_MINUTES, now);
    if (outcome.state === "running") return;
    if (outcome.state === "overLimit") {
      // The reason is saved first: the turn settles asynchronously, and a
      // later tick records it as the outcome.
      this.write({ ...steward, run: { ...run, error: outcome.error } });
      cancelSessionRun(this.engine, run);
      return;
    }
    this.tasks.limits.record(run.startedAt, now);
    if (outcome.status !== "succeeded") {
      await this.removeWorktree(steward.projectId, run);
      this.finish(
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
      proposed = this.propose(steward, this.reply(run.sessionId ?? ""));
    } catch (error) {
      proposed = 0;
      failure = errorMessage(error);
    }
    await this.removeWorktree(steward.projectId, run);
    this.finish(steward, failure === undefined ? "succeeded" : "failed", failure, now, proposed);
  }

  /** The agent's whole last turn: the answer may sit in an earlier message
   * than its last one, or in a plan block. */
  private reply(sessionId: string): string {
    const blocks = this.store.session(sessionId).session.blocks;
    const lastUser = blocks.findLastIndex((block) => block.role === "user");
    return blocks
      .slice(lastUser + 1)
      .filter((block) => (block.role === "assistant" || block.role === "plan") && block.text.trim())
      .map((block) => block.text)
      .join("\n\n");
  }

  /** Creates tasks for the reply's proposals that are new; returns how many. */
  private propose(steward: HostSteward, reply: string): number {
    const latest = this.find(steward.id) ?? steward;
    const proposals = parseStewardProposals(reply, latest.maxProposals);
    const known = new Set(latest.declined);
    for (const task of this.tasks.list())
      if (task.projectId === latest.projectId) known.add(normalizeStewardTitle(task.title));
    let created = 0;
    for (const proposal of proposals) {
      const title = normalizeStewardTitle(proposal.title);
      if (!title || known.has(title)) continue;
      known.add(title);
      this.tasks.save({
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
        ...(latest.autoMerge ? { autoMerge: true } : {}),
        source: "steward",
        stewardId: latest.id,
        // A proposal without a description cannot be started by an agent.
        status: latest.autoStart && proposal.description ? "queued" : "todo",
      });
      created += 1;
    }
    return created;
  }

  /** Removes a run's throwaway checkout and its branch. */
  private async removeWorktree(
    projectId: string,
    run?: { worktreeCwd?: string; branch?: string },
  ): Promise<void> {
    const { worktreeCwd, branch } = run ?? {};
    if (!worktreeCwd && !branch) return;
    let cwd: string;
    try {
      cwd = this.store.project(projectId).cwd;
    } catch {
      return;
    }
    if (worktreeCwd && available(worktreeCwd))
      await git(cwd, ["worktree", "remove", "--force", "--", worktreeCwd]).catch((error) =>
        console.error("Could not remove a steward checkout:", errorMessage(error)),
      );
    await git(cwd, ["worktree", "prune"]).catch(() => {});
    invalidateHostWorktrees(cwd);
    if (branch)
      await git(cwd, ["branch", "-D", "--", branch]).catch((error) =>
        console.error("Could not delete a steward branch:", errorMessage(error)),
      );
  }
}
