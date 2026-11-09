import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { isoTimestamp } from "../../../src/shared/lib/time/timestamps";
import type { SocialAudienceStore } from "../store/social-audience-store";

/** Store operations the limiter needs; SocialAudienceStore satisfies it. */
export type BrowserLimiterStore = Pick<
  SocialAudienceStore,
  "getCounter" | "incrementCounter" | "getSetting" | "putSetting"
>;

export type BrowserSendLimiterOptions = {
  /** Without a store the limiter keeps the previous in-memory gap only. */
  store?: BrowserLimiterStore;
  now?: () => number;
  minGapMs?: number;
  dailyLimit?: number;
};

export const BROWSER_MIN_SEND_GAP_MS = 30_000;
/** shortcut: one fixed daily cap per account for all browser sends; upgrade to owner-set limits from P3-3 autonomy policy. */
export const BROWSER_DAILY_SEND_LIMIT = 200;

const DAY_MS = 86_400_000;
const dayKey = (at: number): string => {
  const iso = isoTimestamp(at);
  if (!iso) throw new RangeError("The browser send clock returned an invalid time.");
  return iso.slice(0, 10);
};
const nextDayStart = (at: number) => (Math.floor(at / DAY_MS) + 1) * DAY_MS;
const lastSendKey = (accountId: string) => `rate:${accountId}`;

/**
 * Per-account pacing and daily cap for browser sends. `reserve` refuses before any external action;
 * `record` runs immediately before the submit. Persisted rows survive Host restarts.
 */
export class BrowserSendLimiter {
  private readonly memory = new Map<string, number>();
  private readonly clock: () => number;
  private readonly gap: number;
  private readonly limit: number;

  constructor(private readonly options: BrowserSendLimiterOptions = {}) {
    this.clock = options.now ?? Date.now;
    this.gap = options.minGapMs ?? BROWSER_MIN_SEND_GAP_MS;
    this.limit = options.dailyLimit ?? BROWSER_DAILY_SEND_LIMIT;
  }

  async reserve(accountId: string): Promise<void> {
    const now = this.clock();
    const last = await this.lastSendAt(accountId);
    if (last !== undefined && now - last < this.gap)
      throw new SocialPlatformError("rate_limit", last + this.gap);
    const store = this.options.store;
    if (store && (await store.getCounter(accountId, "browser", dayKey(now))) >= this.limit)
      throw new SocialPlatformError("rate_limit", nextDayStart(now));
  }

  async record(accountId: string): Promise<void> {
    const now = this.clock();
    this.memory.set(accountId, now);
    const store = this.options.store;
    if (!store) return;
    await store.putSetting(lastSendKey(accountId), String(now));
    await store.incrementCounter(accountId, "browser", dayKey(now));
  }

  /** Drops the in-memory gap for a disconnected account; persisted history is kept. */
  forget(accountId: string): void {
    this.memory.delete(accountId);
  }

  private async lastSendAt(accountId: string): Promise<number | undefined> {
    const remembered = this.memory.get(accountId);
    const store = this.options.store;
    if (!store) return remembered;
    const stored = Number(await store.getSetting(lastSendKey(accountId)));
    const persisted = Number.isFinite(stored) && stored > 0 ? stored : undefined;
    return Math.max(remembered ?? 0, persisted ?? 0) || undefined;
  }
}

/** Random delay in [minMs, maxMs]; `random` is injectable for deterministic tests. */
export function humanDelay(
  minMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  if (!(minMs >= 0) || !(maxMs >= minMs)) throw new RangeError("Invalid human delay bounds.");
  return Math.round(minMs + random() * (maxMs - minMs));
}
