import { randomUUID } from "node:crypto";
import { sessionWorkCwd } from "../../src/features/sessions/model/session";
import { truncateGraphemes } from "../../src/shared/lib/text/truncate";
import type { SessionWakeSource } from "../../src/features/sessions/model/sessionWaitRules";
import type { HostEngine } from "../engine";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";
import type { HostStore } from "../store";
import {
  diffPullRequest,
  isTerminalState,
  mergeWakeReasons,
  parsePullRequestUrl,
  parsePullRequestView,
  PULL_REQUEST_VIEW_FIELDS,
  pullRequestWakeText,
  wakeDigest,
  type PullRequestSnapshot,
  type WakeReason,
} from "./pull-request-model";

export const MAX_PULL_REQUEST_WATCHES_PER_SESSION = 10;
export const PULL_REQUEST_POLL_MS = 60_000;

type PendingWake = { reasons: WakeReason[]; snapshot: PullRequestSnapshot; digest: string };

export type PullRequestWatchRecord = {
  id: string;
  sessionId: string;
  projectId: string;
  /** The project checkout; `gh` runs there for every poll. */
  cwd: string;
  number: number;
  url: string;
  createdAt: number;
  snapshot?: PullRequestSnapshot;
  /** A meaningful change not yet delivered, held while the session is running. */
  pending?: PendingWake;
  lastError?: string;
};

export type PullRequestWatchView = {
  watchId: string;
  number: number;
  url: string;
  state: string;
  snapshot?: PullRequestSnapshot;
  lastError?: string;
};

export type PullRequestWatchStore = Pick<HostStore, "session" | "sessionStateMetadata" | "project">;
export type PullRequestWatchEngine = Pick<HostEngine, "command" | "withMessageAuthor">;

export type PullRequestWatchOptions = {
  /** Under the Host data directory; written with writeFileAtomic. */
  file: string;
  store: PullRequestWatchStore;
  engine: PullRequestWatchEngine;
  /** WorkspaceCommands.ghCommand, which carries the external-command deadline. */
  gh: (cwd: string, args: string[]) => Promise<string>;
  /** git_pr_status for a checkout: the open or latest PR of its branch, or null. */
  branchPullRequest: (cwd: string) => Promise<{ url: string } | null>;
  intervalMs?: number;
};

type FileShape = { version: 1; watches: PullRequestWatchRecord[] };

function parseFile(text: string): PullRequestWatchRecord[] {
  const parsed = JSON.parse(text) as Partial<FileShape>;
  if (parsed.version !== 1 || !Array.isArray(parsed.watches))
    throw new Error("Unsupported pull request watch file.");
  return parsed.watches;
}

function describeError(error: unknown): string {
  return truncateGraphemes(error instanceof Error ? error.message : String(error), 300);
}

/** The watch set as wake sources see it; a change here is announced through `onChange`. */
function wakeKey(watches: readonly PullRequestWatchRecord[]): string {
  return watches.map((watch) => `${watch.sessionId}:${watch.id}`).join(",");
}

function viewOf(record: PullRequestWatchRecord): PullRequestWatchView {
  return {
    watchId: record.id,
    number: record.number,
    url: record.url,
    state: record.snapshot?.state ?? "unknown",
    ...(record.snapshot ? { snapshot: record.snapshot } : {}),
    ...(record.lastError ? { lastError: record.lastError } : {}),
  };
}

/**
 * Watches GitHub pull requests for agent sessions. A poll every minute reads each
 * watched PR with `gh`; a meaningful change is delivered as a message into the watching
 * session once that session is idle. Pending changes survive restarts and retries.
 */
export class PullRequestWatches {
  private watches: PullRequestWatchRecord[] = [];
  /** An unreadable state file blocks new writes rather than overwriting evidence. */
  private broken?: string;
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private polling?: Promise<void>;
  private closing = false;
  readonly ready: Promise<void>;
  /** Called when a watch starts or ends, so session lists re-read their wake sources. */
  onChange?: () => void;

  constructor(private readonly options: PullRequestWatchOptions) {
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    try {
      const result = await readStateFile(this.options.file, parseFile);
      if (result.status === "ok") this.watches = result.value;
      else if (result.status === "corrupt")
        this.broken = "Pull request watch state is corrupt; repair or remove it before watching.";
    } catch (error) {
      this.broken = `Pull request watch state is unreadable: ${describeError(error)}`;
    }
  }

  /** Runs `work` in order; it persists only when `work` reports a change. */
  private async mutate<T>(work: () => { value: T; changed: boolean }): Promise<T> {
    await this.ready;
    const run = this.queue.then(async () => {
      if (this.broken) throw new Error(this.broken);
      const before = wakeKey(this.watches);
      const { value, changed } = work();
      if (changed) {
        const file: FileShape = { version: 1, watches: this.watches };
        await writeFileAtomic(this.options.file, JSON.stringify(file, null, 2));
      }
      if (before !== wakeKey(this.watches)) this.onChange?.();
      return value;
    });
    this.queue = run.catch(() => undefined);
    return await run;
  }

  start(): void {
    if (this.closing || this.timer) return;
    this.timer = setInterval(() => {
      if (!this.polling)
        void this.poll().catch((error) =>
          console.warn(`Pull request watch poll failed: ${describeError(error)}`),
        );
    }, this.options.intervalMs ?? PULL_REQUEST_POLL_MS);
    this.timer.unref?.();
  }

  async close(): Promise<void> {
    this.closing = true;
    clearInterval(this.timer);
    this.timer = undefined;
    await this.polling?.catch(() => undefined);
    await this.queue;
  }

  /** One pass over every watch; a second call while a pass runs joins that pass. */
  poll(): Promise<void> {
    if (!this.polling)
      this.polling = this.runPoll().finally(() => {
        this.polling = undefined;
      });
    return this.polling;
  }

  private async runPoll(): Promise<void> {
    await this.ready;
    if (this.broken) return;
    for (const id of this.watches.map((watch) => watch.id)) {
      if (this.closing) return;
      await this.pollWatch(id);
    }
  }

  private async pollWatch(id: string): Promise<void> {
    const watch = this.watches.find((entry) => entry.id === id);
    if (!watch) return;
    if (!(await this.options.store.sessionStateMetadata(watch.sessionId))) {
      await this.mutate(() => {
        this.watches = this.watches.filter((entry) => entry.id !== id);
        return { value: undefined, changed: true };
      });
      return;
    }
    let observed: PullRequestSnapshot;
    try {
      observed = parsePullRequestView(
        await this.options.gh(watch.cwd, [
          "pr",
          "view",
          watch.url,
          "--json",
          PULL_REQUEST_VIEW_FIELDS,
        ]),
      ).snapshot;
    } catch (error) {
      await this.mutate(() => {
        const current = this.watches.find((entry) => entry.id === id);
        if (!current) return { value: undefined, changed: false };
        current.lastError = describeError(error);
        return { value: undefined, changed: true };
      });
      return;
    }
    await this.mutate(() => {
      const current = this.watches.find((entry) => entry.id === id);
      if (!current) return { value: undefined, changed: false };
      const reasons = diffPullRequest(current.snapshot, observed);
      // Skip the write when nothing changed; most polls observe the same PR.
      const changed =
        reasons.length > 0 ||
        current.lastError !== undefined ||
        JSON.stringify(current.snapshot) !== JSON.stringify(observed);
      current.snapshot = observed;
      current.lastError = undefined;
      if (reasons.length) {
        const merged = mergeWakeReasons(current.pending?.reasons ?? [], reasons);
        current.pending = {
          reasons: merged,
          snapshot: observed,
          digest: wakeDigest({ id, reasons: merged, snapshot: observed }),
        };
      }
      return { value: undefined, changed };
    });
    await this.deliver(id);
  }

  /** Sends the pending wake when the session is idle; otherwise it waits for the next poll. */
  private async deliver(id: string): Promise<void> {
    const watch = this.watches.find((entry) => entry.id === id);
    if (!watch) return;
    if (!watch.pending) {
      // A PR that was already merged or closed when watched has no change to report.
      if (watch.snapshot && isTerminalState(watch.snapshot.state))
        await this.mutate(() => {
          this.watches = this.watches.filter((entry) => entry.id !== id);
          return { value: undefined, changed: true };
        });
      return;
    }
    const meta = await this.options.store.sessionStateMetadata(watch.sessionId);
    if (!meta) return;
    if (meta.status === "running") return;
    const { pending } = watch;
    const text = pullRequestWakeText({
      number: watch.number,
      url: watch.url,
      snapshot: pending.snapshot,
      reasons: pending.reasons,
    });
    try {
      // shortcut: reuses the automation author kind; add a dedicated kind if the UI needs to distinguish PR wake-ups.
      await this.options.engine.withMessageAuthor(
        { kind: "automation", id, name: "PR watch", reason: "pr-watch" },
        () =>
          this.options.engine.command({
            type: "send",
            commandId: `pr-watch:${id}:${pending.digest}`,
            sessionId: watch.sessionId,
            text,
          }),
      );
    } catch (error) {
      await this.mutate(() => {
        const current = this.watches.find((entry) => entry.id === id);
        if (!current) return { value: undefined, changed: false };
        current.lastError = describeError(error);
        return { value: undefined, changed: true };
      });
      return;
    }
    await this.mutate(() => {
      const current = this.watches.find((entry) => entry.id === id);
      if (!current) return { value: undefined, changed: false };
      current.pending = undefined;
      current.lastError = undefined;
      if (isTerminalState(pending.snapshot.state))
        this.watches = this.watches.filter((entry) => entry.id !== id);
      return { value: undefined, changed: true };
    });
  }

  /**
   * Watches one PR for a session. The PR comes from `url`, from `number` in the project,
   * or from the session's branch. Watching the same PR twice returns the existing watch.
   */
  async watch(
    scope: { sessionId: string; projectId: string },
    input: { number?: number; url?: string },
  ): Promise<{ watchId: string; number: number; url: string; state: string }> {
    await this.ready;
    if (this.broken) throw new Error(this.broken);
    if (!(await this.options.store.sessionStateMetadata(scope.sessionId)))
      throw new Error(
        "This session is not hosted by this Host, so a pull request watch could not wake it. Use a session hosted here.",
      );
    const session = await this.options.store.session(scope.sessionId);
    if (session.projectId !== scope.projectId)
      throw new Error("Session belongs to another project.");
    const cwd = (await this.options.store.project(scope.projectId)).cwd;
    let target: string;
    if (input.url !== undefined) {
      const parsed = parsePullRequestUrl(input.url);
      if (!parsed) throw new Error("url must be a github.com pull request link.");
      if (input.number !== undefined && input.number !== parsed.number)
        throw new Error("number does not match url.");
      target = parsed.url;
    } else if (input.number !== undefined) target = String(input.number);
    else {
      const branch = await this.options.branchPullRequest(sessionWorkCwd(session.session));
      if (!branch) throw new Error("No pull request exists for this session's branch.");
      target = branch.url;
    }
    const view = parsePullRequestView(
      await this.options.gh(cwd, ["pr", "view", target, "--json", PULL_REQUEST_VIEW_FIELDS]),
    );
    if (isTerminalState(view.snapshot.state))
      throw new Error(`This pull request is already ${view.snapshot.state.toLowerCase()}.`);
    const number = parsePullRequestUrl(view.url)?.number ?? 0;
    return await this.mutate(() => {
      const existing = this.watches.find(
        (entry) => entry.sessionId === scope.sessionId && entry.url === view.url,
      );
      if (existing)
        return {
          value: { watchId: existing.id, number, url: existing.url, state: view.snapshot.state },
          changed: false,
        };
      const owned = this.watches.filter((entry) => entry.sessionId === scope.sessionId).length;
      if (owned >= MAX_PULL_REQUEST_WATCHES_PER_SESSION)
        throw new Error(
          `This session already watches ${MAX_PULL_REQUEST_WATCHES_PER_SESSION} pull requests. Unwatch one first.`,
        );
      const record: PullRequestWatchRecord = {
        id: randomUUID(),
        sessionId: scope.sessionId,
        projectId: scope.projectId,
        cwd,
        number,
        url: view.url,
        // shortcut: persisted timestamp for ordering only, not a duration.
        createdAt: Date.now(),
        snapshot: view.snapshot,
      };
      this.watches.push(record);
      return {
        value: { watchId: record.id, number, url: record.url, state: view.snapshot.state },
        changed: true,
      };
    });
  }

  /** Removes one of the session's own watches. Another session's watch id returns false. */
  async unwatch(sessionId: string, watchId: string): Promise<boolean> {
    return await this.mutate(() => {
      const index = this.watches.findIndex(
        (entry) => entry.id === watchId && entry.sessionId === sessionId,
      );
      if (index < 0) return { value: false, changed: false };
      this.watches.splice(index, 1);
      return { value: true, changed: true };
    });
  }

  /**
   * Pending wake sources per session of one project: every watch until it ends
   * (merged or closed and delivered, unwatched, or its session deleted).
   */
  wakeSources(projectId: string): Map<string, SessionWakeSource[]> {
    const sources = new Map<string, SessionWakeSource[]>();
    for (const watch of this.watches) {
      if (watch.projectId !== projectId) continue;
      const source: SessionWakeSource = {
        kind: "pull-request",
        label: truncateGraphemes(
          watch.url.replace(/^https:\/\/github\.com\//, "").replace("/pull/", "#"),
          300,
        ),
        since: watch.createdAt,
      };
      const list = sources.get(watch.sessionId);
      if (list) list.push(source);
      else sources.set(watch.sessionId, [source]);
    }
    return sources;
  }

  async list(sessionId: string): Promise<PullRequestWatchView[]> {
    await this.ready;
    return this.watches.filter((entry) => entry.sessionId === sessionId).map(viewOf);
  }
}
