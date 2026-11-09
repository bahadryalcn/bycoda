import { join } from "node:path";
import { z } from "zod";
import {
  ActivityDay,
  addDays,
  decodeMinutes,
  encodeMinutes,
  mergeMinutes,
  summarize,
  type ActivitySummary,
} from "@bycoda/account-contracts/activity";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";

export const ACTIVITY_STORE_VERSION = 1;
/** Days kept on this computer. Older days are dropped when a newer day is recorded. */
export const ACTIVITY_HISTORY_DAYS = 400;
/** Device id used when a caller has no account device id yet. */
export const LOCAL_ACTIVITY_DEVICE = "local";

const StoreFileSchema = z.strictObject({
  version: z.literal(ACTIVITY_STORE_VERSION),
  days: z.array(ActivityDay),
});

export type ActivityRecord = {
  deviceId?: string;
  date: string;
  timeZone: string;
  /** Base64 1440-bit map in the `ActivityDay.minutes` wire format. */
  minutes: string;
};

const keyOf = (day: { date: string; deviceId: string }) => `${day.date}|${day.deviceId}`;

/**
 * Active-minute maps per local day and device, kept in one atomically written file. Writes
 * are bitwise OR, so recording the same minutes again, from another window or after a retry,
 * never changes the total. Only maps and dates are stored: no project, session or content.
 */
export class ActivityService {
  private readonly file: string;
  private days: Map<string, ActivityDay> | null = null;
  private loading: Promise<Map<string, ActivityDay>> | null = null;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(directory: string) {
    this.file = join(directory, "activity.json");
  }

  private load(): Promise<Map<string, ActivityDay>> {
    if (this.days) return Promise.resolve(this.days);
    this.loading ??= (async () => {
      const result = await readStateFile(this.file, (text) =>
        StoreFileSchema.parse(JSON.parse(text)),
      );
      // Corrupt data stays on disk as an evidence copy; counting restarts from empty.
      const days = new Map<string, ActivityDay>();
      if (result.status === "ok") for (const day of result.value.days) days.set(keyOf(day), day);
      this.days = days;
      return days;
    })();
    return this.loading;
  }

  /** Merges one map into the store. Resolves to true when the stored bits changed. */
  async recordMinutes(record: ActivityRecord): Promise<boolean> {
    const day = ActivityDay.parse({
      date: record.date,
      timeZone: record.timeZone,
      deviceId: record.deviceId ?? LOCAL_ACTIVITY_DEVICE,
      minutes: record.minutes,
    });
    const incoming = decodeMinutes(day.minutes);
    const run = this.writes.then(async () => {
      const days = await this.load();
      const existing = days.get(keyOf(day));
      const merged = existing ? mergeMinutes(decodeMinutes(existing.minutes), incoming) : incoming;
      const encoded = encodeMinutes(merged);
      if (existing && existing.minutes === encoded && existing.timeZone === day.timeZone)
        return false;
      const next = new Map(days);
      next.set(keyOf(day), { ...day, minutes: encoded });
      this.prune(next);
      await this.save(next);
      this.days = next;
      return true;
    });
    this.writes = run.catch(() => undefined);
    return run;
  }

  /** Days with `from <= date <= to` (inclusive, `YYYY-MM-DD`), oldest first. */
  async listDays(range: { from: string; to: string }): Promise<ActivityDay[]> {
    await this.writes;
    const days = await this.load();
    return [...days.values()]
      .filter((day) => day.date >= range.from && day.date <= range.to)
      .sort((a, b) =>
        a.date === b.date ? a.deviceId.localeCompare(b.deviceId) : a.date < b.date ? -1 : 1,
      );
  }

  async summary(options: { today: string; timeZone: string }): Promise<ActivitySummary> {
    await this.writes;
    const days = await this.load();
    return summarize([...days.values()], options);
  }

  private prune(days: Map<string, ActivityDay>): void {
    let newest = "";
    for (const day of days.values()) if (day.date > newest) newest = day.date;
    if (!newest) return;
    const cutoff = addDays(newest, -ACTIVITY_HISTORY_DAYS);
    for (const [key, day] of days) if (day.date < cutoff) days.delete(key);
  }

  private async save(days: Map<string, ActivityDay>): Promise<void> {
    const sorted = [...days.values()].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : 1));
    await writeFileAtomic(
      this.file,
      `${JSON.stringify({ version: ACTIVITY_STORE_VERSION, days: sorted })}\n`,
    );
  }
}
