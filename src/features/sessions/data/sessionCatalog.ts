import { projectKey } from "../../../shared/lib/paths";
import { hostSessionShellSummaries } from "../../connections/public/sessionExecutionBinding";
import {
  countSessions,
  listSessionPage,
  sessionListFeedRevision,
  SESSION_LIST_MAX_LIMIT,
  type SessionListCursor,
  type SessionListQuery,
  type SettledMark,
} from "./sessionListFeed";
import { normalizeSummary, type SessionSummary } from "./sessionStore";

export const CATALOG_PAGE_SIZE = 30;
const POLL_MS = 2000;
const DEBOUNCE_MS = 500;
const PINNED = "pinned";

/** `project:<projectKey(cwd)>` is one project group; "flat" is everything unpinned and unsettled. */
export type CatalogSegmentKey = "flat" | "settled" | `project:${string}`;
export type CatalogSegmentState = {
  status: "idle" | "loading" | "done" | "error";
  loaded: number;
};
export type CatalogQuery = { since?: number; title?: string; archived?: boolean };
export type CatalogGroup = { cwd: string; count: number; latestActivityAt: number };
export type CatalogSnapshot = {
  /** Union of the loaded segments and the Host-owned shells. */
  stored: SessionSummary[];
  /** Local groups per stored cwd (unpinned, not settled, since and title applied). */
  groups: CatalogGroup[];
  settledCount: number;
  segments: ReadonlyMap<string, CatalogSegmentState>;
  /** True until the first (or first after a query change) load finished. */
  loading: boolean;
};

export const EMPTY_CATALOG: CatalogSnapshot = {
  stored: [],
  groups: [],
  settledCount: 0,
  segments: new Map(),
  loading: false,
};

type Segment = {
  rows: SessionSummary[];
  cursor: SessionListCursor | null;
  status: CatalogSegmentState["status"];
  // A started segment is re-queried by every refresh; a version bump drops older in-flight results.
  started: boolean;
  version: number;
};

// Summaries contain only small wire metadata, never transcript bodies. Compare
// nested metadata too: updatedAt alone does not cover pin or provider changes.
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => sameValue(value, b[index]))
    );
  }
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) => Object.prototype.hasOwnProperty.call(right, key) && sameValue(left[key], right[key]),
    )
  );
}

export function sameSummaryRows(previous: SessionSummary[], next: SessionSummary[]): boolean {
  return (
    previous.length === next.length && previous.every((row, index) => sameValue(row, next[index]))
  );
}

function sameSnapshot(a: CatalogSnapshot, b: CatalogSnapshot): boolean {
  if (a.loading !== b.loading || a.settledCount !== b.settledCount) return false;
  if (!sameValue(a.groups, b.groups) || a.segments.size !== b.segments.size) return false;
  for (const [key, state] of a.segments) {
    const other = b.segments.get(key);
    if (!other || other.status !== state.status || other.loaded !== state.loaded) return false;
  }
  return sameSummaryRows(a.stored, b.stored);
}

const activityAt = (row: { updatedAt: number; lastActivityAt?: number }) =>
  row.lastActivityAt ?? row.updatedAt;

type Listeners = {
  onChange: (snapshot: CatalogSnapshot) => void;
  onError: (cause: unknown | null) => void;
};

/**
 * Paged, change-fed view of the local session store: the pinned rows, a flat list, the Settled
 * shelf and one segment per project, each a loaded prefix of the keyset-ordered native list.
 * A revision poll re-queries the loaded prefixes from the top when the store changes.
 */
export class SessionCatalog {
  private query: CatalogQuery;
  private marks: SettledMark[];
  private marksKey: string;
  private readonly segments = new Map<string, Segment>([[PINNED, newSegment(true)]]);
  private groups: CatalogGroup[] = [];
  private settledCount = 0;
  private countsReady = false;
  private loading = false;
  private failed = false;
  private reported = false;
  private knownRevision: number | undefined;
  private last: CatalogSnapshot = EMPTY_CATALOG;
  private started = false;
  private running = false;
  private dirty = false;
  private polling = false;
  private gen = 0;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly listeners: Listeners,
    query: CatalogQuery,
    marks: SettledMark[],
    marksKey: string,
  ) {
    this.query = query;
    this.marks = marks;
    this.marksKey = marksKey;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.loading = true;
    this.pollTimer = setInterval(() => this.poll(), POLL_MS);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.publish();
    this.requestRefresh();
  }

  stop(): void {
    this.started = false;
    this.gen++;
    clearInterval(this.pollTimer);
    clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  /** Changing the query resets every segment; the owner loads the ones it shows again. */
  setQuery(query: CatalogQuery): void {
    if (
      query.since === this.query.since &&
      query.title === this.query.title &&
      !!query.archived === !!this.query.archived
    )
      return;
    this.query = query;
    if (!this.started) return;
    for (const key of this.segments.keys()) if (key !== PINNED) this.segments.delete(key);
    const pinned = this.segments.get(PINNED)!;
    pinned.rows = [];
    pinned.cursor = null;
    pinned.version++;
    this.countsReady = false;
    this.loading = true;
    this.publish(true);
    this.requestRefresh();
  }

  /** Settled marks are not segment identity: a change re-queries the loaded segments. */
  setMarks(marks: SettledMark[], key: string): void {
    if (key === this.marksKey) return;
    this.marks = marks;
    this.marksKey = key;
    if (this.started) this.scheduleRefresh();
  }

  refresh(): void {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;
    this.requestRefresh();
  }

  loadMore(key: CatalogSegmentKey): void {
    if (!this.started) return;
    let segment = this.segments.get(key);
    if (!segment) this.segments.set(key, (segment = newSegment(false)));
    if (segment.status === "loading" || segment.status === "done") return;
    segment.started = true;
    segment.status = "loading";
    this.publish();
    // Groups tell a project segment its cwd variants: the running refresh loads it once they exist.
    // After a failed first read nothing is running, so a retry starts one.
    if (!this.countsReady) {
      if (!this.running) this.requestRefresh();
      return;
    }
    const target = segment;
    const gen = this.gen;
    const version = target.version;
    const alive = () => gen === this.gen && version === target.version;
    void this.fetchRows(key, target.cursor, CATALOG_PAGE_SIZE, alive)
      .then((page) => {
        if (!page) return;
        target.rows = [...target.rows, ...page.rows.filter((row) => !hasRow(target.rows, row))];
        target.cursor = page.cursor;
        target.status = page.cursor ? "idle" : "done";
        this.failed = false;
        this.report(null);
        this.publish();
      })
      .catch((cause: unknown) => {
        if (!alive()) return;
        target.status = "error";
        this.failed = true;
        this.report(cause);
        this.publish();
      });
  }

  // Tell the owner only when the error state changes, so a quiet refresh renders nothing.
  private report(cause: unknown | null): void {
    if (cause === null && !this.reported) return;
    this.reported = cause !== null;
    this.listeners.onError(cause);
  }

  private readonly onVisibility = () => {
    if (!document.hidden) this.refresh();
  };

  private poll(): void {
    if (!this.started || document.hidden || this.polling) return;
    this.polling = true;
    void sessionListFeedRevision()
      .then((revision) => {
        if (!this.started) return;
        // A failed first read has no revision yet; keep retrying it like a failed refresh.
        if (this.knownRevision === undefined ? this.failed : revision !== this.knownRevision)
          this.scheduleRefresh();
        else if (this.failed) this.scheduleRefresh();
      })
      .catch(() => undefined) // -- the next tick retries; a failing refresh surfaces the error.
      .finally(() => {
        this.polling = false;
      });
  }

  private scheduleRefresh(): void {
    if (this.debounceTimer !== undefined) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.requestRefresh();
    }, DEBOUNCE_MS);
  }

  private requestRefresh(): void {
    if (!this.started) return;
    this.gen++;
    this.dirty = true;
    if (this.running) return;
    void this.drain();
  }

  // One refresh in flight at a time: a request during a run supersedes it and reruns after it.
  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.dirty && this.started) {
        this.dirty = false;
        const gen = this.gen;
        try {
          await this.refreshAll(gen);
        } catch (cause) {
          if (gen === this.gen) this.fail(cause);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private fail(cause: unknown): void {
    for (const segment of this.segments.values())
      if (segment.status === "loading") segment.status = "error";
    this.failed = true;
    this.loading = false;
    this.report(cause);
    this.publish();
  }

  private async refreshAll(gen: number): Promise<void> {
    const alive = () => gen === this.gen;
    const [counts, settled] = await Promise.all([
      countSessions(this.listQuery("project", undefined)),
      countSessions(this.listQuery("settled", undefined)),
    ]);
    if (!alive()) return;
    this.groups = counts.groups;
    this.settledCount = settled.total;
    this.knownRevision = counts.revision;
    this.countsReady = true;
    const errors: unknown[] = [];
    await Promise.all(
      [...this.segments].map(async ([key, segment]) => {
        if (!segment.started) return;
        const version = segment.version;
        const segmentAlive = () => alive() && version === segment.version;
        const want = key === PINNED ? Infinity : Math.max(segment.rows.length, CATALOG_PAGE_SIZE);
        try {
          const page = await this.fetchRows(key, null, want, segmentAlive);
          if (!page || !segmentAlive()) return;
          segment.rows = page.rows;
          segment.cursor = page.cursor;
          segment.status = page.cursor ? "idle" : "done";
          segment.version++;
        } catch (cause) {
          errors.push(cause);
        }
      }),
    );
    if (!alive()) return;
    if (errors.length) {
      this.fail(errors[0]);
      return;
    }
    this.failed = false;
    this.loading = false;
    this.report(null);
    this.publish();
  }

  /** Pages until `want` visible rows are collected or the list ends; null when superseded. */
  private async fetchRows(
    key: string,
    start: SessionListCursor | null,
    want: number,
    alive: () => boolean,
  ): Promise<{ rows: SessionSummary[]; cursor: SessionListCursor | null } | null> {
    if (key.startsWith("project:") && !this.projectCwds(key).length)
      return { rows: [], cursor: null };
    const rows: SessionSummary[] = [];
    const seen = new Set<string>();
    let cursor = start;
    for (;;) {
      const limit = Math.min(SESSION_LIST_MAX_LIMIT, Math.max(1, want - rows.length));
      const page = await listSessionPage(this.listQuery(key, limit), cursor);
      if (!alive()) return null;
      for (const row of page.rows) if (!hasRow(rows, row)) rows.push(row);
      cursor = page.nextCursor;
      if (!cursor || rows.length >= want) return { rows, cursor };
      const id = `${cursor.activityAt}:${cursor.id}`;
      if (seen.has(id)) throw new Error("Session-list cursor did not advance.");
      seen.add(id);
    }
  }

  private projectCwds(key: string): string[] {
    const wanted = key.slice("project:".length);
    return this.groups.filter((group) => projectKey(group.cwd) === wanted).map((g) => g.cwd);
  }

  /** `project` and `settled` with no limit are the count queries. */
  private listQuery(key: string, limit: number | undefined): SessionListQuery {
    const { since, title, archived } = this.query;
    const common = {
      ...(title ? { title } : {}),
      ...(archived ? { archived: true } : {}),
      ...(limit === undefined ? {} : { limit }),
    };
    const sinceField = since === undefined ? {} : { since };
    if (key === PINNED) return { pinned: true, ...common };
    if (key === "settled")
      return { pinned: false, settled: this.marks, settledMode: "only", ...common };
    const unsettled = { pinned: false, settled: this.marks, settledMode: "exclude" as const };
    if (key === "project" || key === "flat") return { ...unsettled, ...sinceField, ...common };
    return { ...unsettled, ...sinceField, ...common, cwds: this.projectCwds(key) };
  }

  private publish(keepStored = false): void {
    const segments = new Map<string, CatalogSegmentState>();
    const rows: SessionSummary[] = [];
    const ids = new Set<string>();
    for (const [key, segment] of this.segments) {
      if (key !== PINNED) segments.set(key, { status: segment.status, loaded: segment.rows.length });
      for (const row of segment.rows) {
        if (ids.has(row.id)) continue;
        ids.add(row.id);
        rows.push(row);
      }
    }
    let stored = rows;
    if (keepStored) stored = this.last.stored;
    else {
      const { since, title, archived } = this.query;
      const needle = title?.toLowerCase();
      for (const row of hostSessionShellSummaries()) {
        if (ids.has(row.id) || !!row.archived !== !!archived) continue;
        if (!row.pinned && since !== undefined && activityAt(row) < since) continue;
        if (needle && !row.title.toLowerCase().includes(needle)) continue;
        ids.add(row.id);
        stored.push(normalizeSummary(row));
      }
      if (sameSummaryRows(this.last.stored, stored)) stored = this.last.stored;
    }
    const next: CatalogSnapshot = {
      stored,
      groups: this.groups,
      settledCount: this.settledCount,
      segments,
      loading: this.loading,
    };
    if (sameSnapshot(this.last, next)) return;
    this.last = next;
    this.listeners.onChange(next);
  }
}

function newSegment(started: boolean): Segment {
  return { rows: [], cursor: null, status: "idle", started, version: 0 };
}

function hasRow(rows: readonly SessionSummary[], row: SessionSummary): boolean {
  return rows.some((entry) => entry.id === row.id);
}
