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
  private readonly sources: Array<() => number[]> = [];

  constructor(
    private readonly store: HostStore,
    private readonly now: () => number = Date.now,
  ) {
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS host_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);" +
        "CREATE TABLE IF NOT EXISTS agent_usage (day TEXT PRIMARY KEY, ms REAL NOT NULL);",
    );
  }

  /** Registers a way to list when each run still going started, so the time
   * they have used so far counts towards the limit. */
  track(running: () => number[]): void {
    this.sources.push(running);
  }

  settings(): HostSettings {
    const row = this.store.db.prepare("SELECT value FROM host_settings WHERE key='settings'").get();
    if (!row) return DEFAULT_HOST_SETTINGS;
    try {
      return parseHostSettings(JSON.parse(String(row.value)));
    } catch {
      return DEFAULT_HOST_SETTINGS;
    }
  }

  /** Saves the fields given and keeps the others. */
  save(raw: unknown): HostSettings {
    const next = parseHostSettings(raw, this.settings());
    this.store.db
      .prepare(
        "INSERT INTO host_settings VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(next));
    return next;
  }

  /** Adds the time a run took, from its start to `endedAt`, to the day it
   * ended on. */
  record(startedAt: number | undefined, endedAt = this.now()): void {
    if (startedAt === undefined || !(endedAt > startedAt)) return;
    const day = localDay(endedAt);
    this.store.db
      .prepare(
        "INSERT INTO agent_usage VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET ms=ms+excluded.ms",
      )
      .run(day, endedAt - startedAt);
    this.store.db
      .prepare("DELETE FROM agent_usage WHERE day < ?")
      .run(localDay(endedAt - KEEP_DAYS * 24 * 60 * MINUTE_MS));
  }

  /** Agent minutes used today, runs still going included. */
  usedMinutes(): number {
    const now = this.now();
    const row = this.store.db.prepare("SELECT ms FROM agent_usage WHERE day=?").get(localDay(now));
    const settled = row ? Number(row.ms) : 0;
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    let going = 0;
    for (const source of this.sources)
      for (const startedAt of source())
        going += Math.max(0, now - Math.max(startedAt, midnight.getTime()));
    return (settled + going) / MINUTE_MS;
  }

  /** Today's time is used up: no new work starts, running work finishes. */
  reached(): boolean {
    const { dailyAgentMinutes } = this.settings();
    return dailyAgentMinutes > 0 && this.usedMinutes() >= dailyAgentMinutes;
  }

  state(): HostSettingsState {
    const settings = this.settings();
    const usedMinutes = this.usedMinutes();
    return {
      ...settings,
      usedMinutes,
      limitReached: settings.dailyAgentMinutes > 0 && usedMinutes >= settings.dailyAgentMinutes,
    };
  }
}
