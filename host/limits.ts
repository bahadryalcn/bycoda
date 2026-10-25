import {
  DEFAULT_HOST_SETTINGS,
  parseHostSettings,
  type HostSettings,
  type HostSettingsState,
} from "../src/features/tasks/model/hostSettings";
import type { HostStore } from "./store";

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
      });
    })();
  }

  /** Registers a way to list when each run still going started, so the time
   * they have used so far counts towards the limit. */
  track(running: () => number[] | Promise<number[]>): void {
    this.sources.push(running);
  }

  async settings(): Promise<HostSettings> {
    await this.ready;

    return await this.store.db.scope(async () => {
      const row = await this.store.db
        .prepare("SELECT value FROM host_settings WHERE key='settings'")
        .get();
      if (!row) return DEFAULT_HOST_SETTINGS;
      try {
        return parseHostSettings(JSON.parse(String(row.value)));
      } catch {
        return DEFAULT_HOST_SETTINGS;
      }
    });
  }

  /** Saves the fields given and keeps the others. */
  async save(raw: unknown): Promise<HostSettings> {
    await this.ready;

    return await this.store.db.scope(async () => {
      const next = parseHostSettings(raw, await this.settings());
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
      return (settled + going) / MINUTE_MS;
    });
  }

  /** Today's time is used up: no new work starts, running work finishes. */
  async reached(): Promise<boolean> {
    await this.ready;

    return await this.store.db.scope(async () => {
      const { dailyAgentMinutes } = await this.settings();
      return dailyAgentMinutes > 0 && (await this.usedMinutes()) >= dailyAgentMinutes;
    });
  }

  async state(): Promise<HostSettingsState> {
    await this.ready;

    return await this.store.db.scope(async () => {
      const settings = await this.settings();
      const usedMinutes = await this.usedMinutes();
      return {
        ...settings,
        usedMinutes,
        limitReached: settings.dailyAgentMinutes > 0 && usedMinutes >= settings.dailyAgentMinutes,
      };
    });
  }
}
