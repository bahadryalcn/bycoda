import {
  DEFAULT_HOST_SETTINGS,
  parseHostSettings,
  type HostSettings,
  type HostSettingsState,
  DEFAULT_AGENT_DEFAULTS,
  parseAgentDefaults,
} from "../src/features/tasks/model/hostSettings";
import type { HostStore } from "./store";
import { AUTO_ARCHIVE_DRAFT_AUTHORITY } from "./settings-defaults/archive-capability";
import { confirmedRunElapsed } from "./execution/run-duration";

const MINUTE_MS = 60_000;
/** How many days of usage are kept. */
const KEEP_DAYS = 40;

/** The local calendar day a time falls on, as YYYY-MM-DD. */
export function localDay(time: number): string {
  const date = new Date(time);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The host's work limits and a per-day ledger of the agent time it spent on
 * work it started on its own (task runs and their reviewers, steward runs and
 * goal planners). Both live in the host's database, so a restart keeps them. */
export class HostLimits {
  /** Where the start times of runs still going come from. */
  private readonly sources: Array<() => number[] | Promise<number[]>> = [];
  private readonly runSources: Array<
    () => { sessionId: string; runId: string }[] | Promise<{ sessionId: string; runId: string }[]>
  > = [];

  readonly ready: Promise<void>;
  constructor(
    private readonly store: HostStore,
    private readonly now: () => number = Date.now,
  ) {
    this.ready = (async () => {
      await store.ready;

      await store.db.scope(async () => {
        await store.db.exec(
          "CREATE TABLE IF NOT EXISTS host_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);" +
            "CREATE TABLE IF NOT EXISTS agent_usage (day TEXT PRIMARY KEY, ms REAL NOT NULL);",
        );
        await store.db.exec(
          "CREATE TABLE IF NOT EXISTS run_duration_daily (session_id TEXT NOT NULL, run_id TEXT NOT NULL, day TEXT NOT NULL, ms REAL NOT NULL, PRIMARY KEY(session_id,run_id,day))",
        );
        await store.db.exec(
          "CREATE TABLE IF NOT EXISTS run_duration_daily_unknown (session_id TEXT NOT NULL, run_id TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY(session_id,run_id,day))",
        );
        await store.db.exec(
          "CREATE TABLE IF NOT EXISTS run_duration_quota (session_id TEXT NOT NULL, run_id TEXT NOT NULL, PRIMARY KEY(session_id,run_id))",
        );
      });
    })();
  }

  /** Registers a way to list when each run still going started, so the time
   * they have used so far counts towards the limit. */
  track(running: () => number[] | Promise<number[]>): void {
    this.sources.push(running);
  }

  trackRuns(
    running: () =>
      | { sessionId: string; runId: string }[]
      | Promise<{ sessionId: string; runId: string }[]>,
  ): void {
    this.runSources.push(running);
  }

  async recordRun(run: { sessionId?: string; runId?: string }, now = this.now()): Promise<void> {
    if (run.sessionId && run.runId) {
      await this.ready;
      await this.store.db
        .prepare("INSERT OR IGNORE INTO run_duration_quota VALUES (?,?)")
        .run(run.sessionId, run.runId);
      await confirmedRunElapsed(this.store, run.sessionId, run.runId, now);
    }
  }

  async settings(): Promise<HostSettings> {
    await this.ready;

    return await this.store.db.scope(async () => {
      const row = await this.store.db
        .prepare("SELECT value FROM host_settings WHERE key='settings'")
        .get();
      if (!row) return { ...DEFAULT_HOST_SETTINGS, agentDefaults: { ...DEFAULT_AGENT_DEFAULTS } };
      try {
        const settings = parseHostSettings(JSON.parse(String(row.value)));
        return {
          ...settings,
          agentDefaults: settings.agentDefaults ?? { ...DEFAULT_AGENT_DEFAULTS },
        };
      } catch {
        throw new Error("Stored Host settings are invalid; refusing to replace them");
      }
    });
  }

  /** Saves the fields given and keeps the others. */
  async save(raw: unknown): Promise<HostSettings> {
    await this.ready;

    return await this.store.db.scope(async () => {
      const current = await this.settings();
      const next = parseHostSettings(raw, current);
      const patch = raw as Record<string, unknown>;
      if (patch.agentDefaults !== undefined) {
        const previous = current.agentDefaults ?? DEFAULT_AGENT_DEFAULTS;
        if (patch.migrateAgentDefaults === true && previous.version > 0) return current;
        if (patch.expectedAgentDefaultsVersion !== previous.version)
          throw new Error("Agent defaults changed; reload before saving");
        const parsed = parseAgentDefaults(patch.agentDefaults, previous);
        // Fail closed: archive can only be enabled where the Host has client draft clearance.
        if (
          !AUTO_ARCHIVE_DRAFT_AUTHORITY &&
          ((parsed.archiveMergedSessions && !previous.archiveMergedSessions) ||
            parsed.archiveInactiveDays > previous.archiveInactiveDays)
        )
          throw new Error("Automatic archive is not available on this computer");
        next.agentDefaults = { ...parsed, version: previous.version + 1 };
      }
      await this.store.db
        .prepare(
          "INSERT INTO host_settings VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(JSON.stringify(next));
      return next;
    });
  }

  /** Splits elapsed agent time at local calendar midnights, including DST. */
  async record(startedAt: number | undefined, endedAt = this.now()): Promise<void> {
    await this.ready;

    return await this.store.db.scope(async () => {
      if (
        startedAt === undefined ||
        !Number.isFinite(startedAt) ||
        !Number.isFinite(endedAt) ||
        !(endedAt > startedAt)
      )
        return;
      const add = this.store.db.prepare(
        "INSERT INTO agent_usage VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET ms=ms+excluded.ms",
      );
      await this.store.db.exec("SAVEPOINT record_agent_usage");
      try {
        for (let start = startedAt; start < endedAt;) {
          const midnight = new Date(start);
          midnight.setHours(0, 0, 0, 0);
          midnight.setDate(midnight.getDate() + 1);
          const end = Math.min(endedAt, midnight.getTime());
          await add.run(localDay(start), end - start);
          start = end;
        }
        await this.store.db.exec("RELEASE record_agent_usage");
      } catch (error) {
        await this.store.db.exec("ROLLBACK TO record_agent_usage; RELEASE record_agent_usage");
        throw error;
      }
      await this.store.db
        .prepare("DELETE FROM agent_usage WHERE day < ?")
        .run(localDay(endedAt - KEEP_DAYS * 24 * 60 * MINUTE_MS));
    });
  }

  /** Agent minutes used today, runs still going included. */
  async usedMinutes(): Promise<number> {
    await this.ready;

    return await this.store.db.scope(async () => {
      const now = this.now();
      const row = await this.store.db
        .prepare("SELECT ms FROM agent_usage WHERE day=?")
        .get(localDay(now));
      const settled = row ? Number(row.ms) : 0;
      const midnight = new Date(now);
      midnight.setHours(0, 0, 0, 0);
      let going = 0;
      for (const source of this.sources)
        for (const startedAt of await source())
          going += Math.max(0, now - Math.max(startedAt, midnight.getTime()));
      for (const source of this.runSources)
        for (const run of await source()) await this.recordRun(run, now);
      const observed = await this.store.db
        .prepare(
          "SELECT coalesce(sum(d.ms),0) AS ms FROM run_duration_daily d JOIN run_duration_quota q USING(session_id,run_id) WHERE d.day=?",
        )
        .get(localDay(now));
      return (settled + going + Number(observed!.ms)) / MINUTE_MS;
    });
  }

  /** Today's time is used up: no new work starts, running work finishes. */
  async reached(): Promise<boolean> {
    await this.ready;

    return await this.store.db.scope(async () => {
      const { dailyAgentMinutes } = await this.settings();
      if (dailyAgentMinutes <= 0) return false;
      const used = await this.usedMinutes();
      const { extraMinutes } = await this.uncertainToday();
      return used + extraMinutes >= dailyAgentMinutes;
    });
  }

  async state(): Promise<HostSettingsState> {
    await this.ready;

    return await this.store.db.scope(async () => {
      const settings = await this.settings();
      const usedMinutes = await this.usedMinutes();
      const { present, extraMinutes } = await this.uncertainToday();
      return {
        ...settings,
        usedMinutes,
        ...(present ? { usageUncertain: true } : {}),
        limitReached:
          settings.dailyAgentMinutes > 0 &&
          usedMinutes + extraMinutes >= settings.dailyAgentMinutes,
      };
    });
  }

  /**
   * Runs with an unverified interval today. A run cannot have used more of today than the
   * wall-clock span it overlapped, so each adds at most that span beyond its verified time.
   * A run the task ledger does not know is bounded by the whole day so far.
   */
  private async uncertainToday(): Promise<{ present: boolean; extraMinutes: number }> {
    const now = this.now();
    const ledger = await this.store.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_run_budget_ledger'")
      .get();
    const rows = await this.store.db
      .prepare(
        `SELECT coalesce(m.ms,0) AS ms,
           ${ledger ? "json_extract(l.value,'$.startedAt')" : "NULL"} AS started,
           ${ledger ? "json_extract(l.value,'$.settledAt')" : "NULL"} AS settled
         FROM run_duration_daily_unknown d JOIN run_duration_quota q USING(session_id,run_id)
         LEFT JOIN run_duration_daily m ON m.session_id=d.session_id AND m.run_id=d.run_id AND m.day=d.day
         ${ledger ? "LEFT JOIN task_run_budget_ledger l ON l.session_id=d.session_id AND l.run_id=d.run_id" : ""}
         WHERE d.day=?`,
      )
      .all(localDay(now));
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    let extraMs = 0;
    for (const row of rows) {
      const from = Math.max(midnight.getTime(), Number(row.started ?? 0));
      const to = Math.min(
        now,
        row.settled === null || row.settled === undefined ? now : Number(row.settled),
      );
      extraMs += Math.max(0, to - from - Number(row.ms));
    }
    return { present: rows.length > 0, extraMinutes: extraMs / MINUTE_MS };
  }
}
