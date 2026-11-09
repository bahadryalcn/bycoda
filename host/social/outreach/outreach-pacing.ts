import type { Sequence } from "../../../src/features/social/model/outreach";
import type { SocialAudienceStore } from "../store/social-audience-store";
import { isoTimestamp } from "../../../src/shared/lib/time/timestamps";
import { DAY_MS, HOUR_MS } from "./outreach-input";

/** Counter account key for sequence pacing and stats (sequences span accounts). */
export const OUTREACH_COUNTER_ACCOUNT = "outreach";
export const OUTREACH_STAT_METRICS = ["sent", "replied", "positive", "optedOut", "failed"] as const;
export type OutreachStatMetric = (typeof OUTREACH_STAT_METRICS)[number];

export const startedSettingKey = (sequenceId: string) => `outreach.started:${sequenceId}`;

/** Day and hour keys in UTC. Pacing is UTC; the autonomy daily limit uses the policy time zone. */
function utcIso(now: number): string {
  const iso = isoTimestamp(now);
  if (!iso) throw new RangeError("The outreach clock returned an invalid time.");
  return iso;
}
export const utcDayKey = (now: number) => utcIso(now).slice(0, 10);
export const utcHourKey = (now: number) => utcIso(now).slice(0, 13);
export const nextUtcHour = (now: number) => Math.floor(now / HOUR_MS) * HOUR_MS + HOUR_MS;
export const nextUtcDay = (now: number) => Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;

/**
 * Warm-up: during the first `warmupDays` after the start, the daily cap ramps linearly up to
 * `perDay`, never below 1. Without a recorded start, or after warm-up, the configured caps apply.
 */
export function paceCaps(
  sequence: Pick<Sequence, "pacing">,
  startedAt: number | undefined,
  now: number,
): { perHour: number; perDay: number } {
  const { perHour, perDay, warmupDays } = sequence.pacing;
  if (startedAt === undefined || warmupDays <= 0) return { perHour, perDay };
  const ageDays = Math.max(0, Math.floor((now - startedAt) / DAY_MS));
  if (ageDays >= warmupDays) return { perHour, perDay };
  return { perHour, perDay: Math.max(1, Math.floor((perDay * (ageDays + 1)) / warmupDays)) };
}

export async function startedAtOf(
  store: SocialAudienceStore,
  sequenceId: string,
): Promise<number | undefined> {
  const value = await store.getSetting(startedSettingKey(sequenceId));
  const parsed = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** When the sequence may send next, or undefined when it is under both caps. */
export async function paceDeferral(
  store: SocialAudienceStore,
  sequence: Sequence,
  now: number,
): Promise<number | undefined> {
  const caps = paceCaps(sequence, await startedAtOf(store, sequence.id), now);
  const hourly = await store.getCounter(
    OUTREACH_COUNTER_ACCOUNT,
    `outreach-hour:${sequence.id}`,
    utcHourKey(now),
  );
  if (hourly >= caps.perHour) return nextUtcHour(now);
  const daily = await store.getCounter(
    OUTREACH_COUNTER_ACCOUNT,
    `outreach:${sequence.id}`,
    utcDayKey(now),
  );
  if (daily >= caps.perDay) return nextUtcDay(now);
  return undefined;
}

/** Counts one step handed to the send path (queued job or delivered email). */
export async function countSentStep(
  store: SocialAudienceStore,
  sequenceId: string,
  now: number,
): Promise<void> {
  await store.incrementCounter(OUTREACH_COUNTER_ACCOUNT, `outreach:${sequenceId}`, utcDayKey(now));
  await store.incrementCounter(
    OUTREACH_COUNTER_ACCOUNT,
    `outreach-hour:${sequenceId}`,
    utcHourKey(now),
  );
  await countStat(store, sequenceId, "sent");
}

export async function countStat(
  store: SocialAudienceStore,
  sequenceId: string,
  metric: OutreachStatMetric,
  by = 1,
): Promise<void> {
  await store.incrementCounter(
    OUTREACH_COUNTER_ACCOUNT,
    `outreach-stat:${sequenceId}:${metric}`,
    "total",
    by,
  );
}

export async function readStats(
  store: SocialAudienceStore,
  sequenceId: string,
): Promise<Record<OutreachStatMetric, number>> {
  const entries = await Promise.all(
    OUTREACH_STAT_METRICS.map(
      async (metric) =>
        [
          metric,
          await store.getCounter(
            OUTREACH_COUNTER_ACCOUNT,
            `outreach-stat:${sequenceId}:${metric}`,
            "total",
          ),
        ] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<OutreachStatMetric, number>;
}
