import { randomUUID } from "node:crypto";
import type { RecordValue } from "../repository";
import type { TrackedWorkDeps, TrackedWorkNotification } from "./assistant-tracked-work";

export const MAX_PR_WATCHES = 30;
export const PR_WATCH_INTERVAL_MS = 3 * 60_000;
export const PR_WATCH_CALLS_PER_TICK = 5;
export const PR_WATCH_TTL_MS = 14 * 24 * 60 * 60_000;
export const PR_WATCH_FAILURE_LIMIT = 3;
const prefix = "prwatch:";

export type PrChecks = "pending" | "passing" | "failing" | "none";
export type PrState = { state: string; merged: boolean; checks: PrChecks; reviewDecision?: string };
export type PrObservation = PrState & { title?: string };
/** Read-only by construction: this interface has no method that writes to GitHub. */
export interface PrReader {
  /** `owner/name` of the project's GitHub remote. */
  repoOf(projectId: string): Promise<string>;
  view(projectId: string, repo: string, number: number): Promise<PrObservation>;
}
export type PrWatch = {
  id: string;
  projectId: string;
  repo: string;
  number: number;
  title?: string;
  lastState: PrState;
  createdAt: number;
  lastCheckedAt: number;
  threadId: string;
  failures: number;
  /** Set once the watcher gave up; the reason was announced once. */
  unavailable?: string;
};
type Row = RecordValue & { value: PrWatch };
type Notice = Pick<TrackedWorkNotification, "kind" | "body">;

const AUTH = /auth|log ?in|credential|token|401|403|not logged/i;
const REVIEW: Record<string, string> = {
  CHANGES_REQUESTED: "Changes requested.",
  APPROVED: "Approved.",
};

/** What the owner should hear about, one notice per real transition. Terminal states stand alone. */
export function prTransitions(before: PrState, now: PrState): Notice[] {
  if (now.state !== before.state && (now.merged || now.state === "CLOSED"))
    return [
      {
        kind: "job.done",
        body: now.merged
          ? "Merged. No longer watching."
          : "Closed without merging. No longer watching.",
      },
    ];
  const out: Notice[] = [];
  if (now.checks !== before.checks) {
    if (now.checks === "failing") out.push({ kind: "job.failed", body: "Checks failed." });
    else if (
      now.checks === "passing" &&
      (before.checks === "pending" || before.checks === "failing")
    )
      out.push({ kind: "job.done", body: "Checks passed." });
  }
  const review = REVIEW[now.reviewDecision ?? ""];
  if (review && now.reviewDecision !== before.reviewDecision)
    out.push({ kind: "job.waiting", body: review });
  return out;
}

/**
 * Host-side pull request watches for the Room and voice threads: durable, polled from the job
 * tick, notify on transitions only. It never comments, merges or pushes.
 */
export class AssistantPrWatch {
  /** Bound by the Host once GitHub access exists; without it the poller is idle. */
  reader?: PrReader;
  constructor(private readonly deps: TrackedWorkDeps) {}
  private get store() {
    return this.deps.repository.store;
  }
  private async rows(): Promise<Row[]> {
    const rows = await this.store.db
      .prepare(
        "SELECT value FROM assistant_runtime WHERE id LIKE 'prwatch:%' AND deleted_at IS NULL ORDER BY id LIMIT ?",
      )
      .all(MAX_PR_WATCHES * 2);
    return rows.map((raw) => JSON.parse(String(raw.value)) as Row);
  }
  async list(projectId?: string): Promise<PrWatch[]> {
    return (await this.rows())
      .map((row) => row.value)
      .filter((w) => !projectId || w.projectId === projectId);
  }
  /** Watching the same PR again returns the existing watch. */
  async watch(input: {
    projectId: string;
    threadId: string;
    number: number;
    repo?: string;
  }): Promise<{ watch: PrWatch; existing: boolean }> {
    const reader = this.reader;
    if (!reader) throw new Error("GitHub access is not available on this Host.");
    const repo = input.repo ?? (await reader.repoOf(input.projectId));
    const seen = await reader.view(input.projectId, repo, input.number);
    if (seen.merged || seen.state === "CLOSED")
      throw new Error(`PR #${input.number} is already ${seen.merged ? "merged" : "closed"}.`);
    return await this.store.transaction(async () => {
      const rows = await this.rows();
      const same = rows.find(
        (row) =>
          row.value.projectId === input.projectId &&
          row.value.repo === repo &&
          row.value.number === input.number,
      );
      if (same) return { watch: same.value, existing: true };
      if (rows.length >= MAX_PR_WATCHES)
        throw new Error(
          `At most ${MAX_PR_WATCHES} pull requests can be watched; unwatch one first.`,
        );
      const now = this.deps.now();
      const { title, ...lastState } = seen;
      const watch: PrWatch = {
        id: randomUUID(),
        projectId: input.projectId,
        repo,
        number: input.number,
        ...(title ? { title: title.slice(0, 200) } : {}),
        lastState,
        createdAt: now,
        lastCheckedAt: now,
        threadId: input.threadId,
        failures: 0,
      };
      await this.deps.repository.put<Row>("runtime", {
        id: `${prefix}${watch.id}`,
        version: 0,
        createdAt: now,
        updatedAt: now,
        value: watch,
      });
      return { watch, existing: false };
    }, "critical");
  }
  async unwatch(id: string, projectId?: string): Promise<boolean> {
    const row = (await this.rows()).find(
      (item) => item.value.id === id && (!projectId || item.value.projectId === projectId),
    );
    if (!row) return false;
    await this.store.db.prepare("DELETE FROM assistant_runtime WHERE id=?").run(row.id);
    return true;
  }
  private title(watch: PrWatch) {
    return `PR #${watch.number} ${watch.repo}`;
  }
  private notice(watch: PrWatch, now: number, tag: string, notice: Notice): Promise<void> {
    return this.deps.notify({
      id: `${prefix}${watch.id}:${tag}:${now}`,
      kind: notice.kind,
      title: this.title(watch),
      body: watch.title ? `${notice.body} ${watch.title}` : notice.body,
      createdAt: now,
      projectId: watch.projectId,
      projectIds: [watch.projectId],
    });
  }
  /** Checks due watches (3 min apart each, 5 GitHub calls at most) and queues transition notices. */
  async tick(): Promise<void> {
    const reader = this.reader;
    if (!reader) return;
    let calls = 0;
    const rows = (await this.rows()).sort(
      (a, b) => a.value.lastCheckedAt - b.value.lastCheckedAt || a.id.localeCompare(b.id),
    );
    for (const row of rows) {
      const watch = row.value,
        now = this.deps.now();
      try {
        if (now - watch.createdAt > PR_WATCH_TTL_MS) {
          await this.store.transaction(async () => {
            await this.store.db.prepare("DELETE FROM assistant_runtime WHERE id=?").run(row.id);
            await this.notice(watch, now, "expired", {
              kind: "job.done",
              body: "Stopped watching after 14 days.",
            });
          }, "critical");
          continue;
        }
        if (watch.unavailable || now - watch.lastCheckedAt < PR_WATCH_INTERVAL_MS) continue;
        if (calls >= PR_WATCH_CALLS_PER_TICK) break;
        calls += 1;
        await this.check(reader, row, now);
      } catch (error) {
        this.deps.onError?.(error);
      }
    }
  }
  private async check(reader: PrReader, row: Row, now: number) {
    const watch = row.value;
    let seen: PrObservation | undefined,
      reason = "";
    try {
      seen = await reader.view(watch.projectId, watch.repo, watch.number);
    } catch (error) {
      reason = (error instanceof Error ? error.message : String(error)).slice(0, 200);
    }
    await this.store.transaction(async () => {
      if (!seen) {
        const failures = watch.failures + 1;
        const give = failures >= PR_WATCH_FAILURE_LIMIT || AUTH.test(reason);
        await this.deps.repository.put<Row>(
          "runtime",
          {
            ...row,
            updatedAt: now,
            value: {
              ...watch,
              failures,
              lastCheckedAt: now,
              ...(give ? { unavailable: reason || "GitHub is unreachable" } : {}),
            },
          },
          row.version,
        );
        if (give)
          await this.deps.notify({
            id: `${prefix}${watch.id}:unavailable`,
            kind: "job.waiting",
            title: this.title(watch),
            body: `Cannot watch PR #${watch.number}: ${reason || "GitHub is unreachable"}.`,
            createdAt: now,
            projectId: watch.projectId,
            projectIds: [watch.projectId],
          });
        return;
      }
      const { title, ...lastState } = seen;
      const notices = prTransitions(watch.lastState, lastState);
      const ended = lastState.merged || lastState.state === "CLOSED";
      if (ended)
        await this.store.db.prepare("DELETE FROM assistant_runtime WHERE id=?").run(row.id);
      else
        await this.deps.repository.put<Row>(
          "runtime",
          {
            ...row,
            updatedAt: now,
            value: {
              ...watch,
              ...(title ? { title: title.slice(0, 200) } : {}),
              lastState,
              lastCheckedAt: now,
              failures: 0,
            },
          },
          row.version,
        );
      for (const [index, notice] of notices.entries())
        await this.notice(watch, now, `${index}`, notice);
    }, "critical");
  }
}
