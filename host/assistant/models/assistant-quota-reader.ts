import {
  isQuotaProvider,
  type QuotaTarget,
  type UsageLimitsReport,
} from "../../usage/limits-report";

/** A quota reading is trusted for this long; an older sample counts as unknown. */
export const QUOTA_STALE_MS = 15 * 60_000;
/** Minimum gap between background refreshes of one provider. */
export const QUOTA_REFRESH_MS = 5 * 60_000;
/** Longest the settings status read waits for a first quota sample. */
export const QUOTA_WARM_TIMEOUT_MS = 8_000;

export type AssistantQuotaUnknownReason =
  | "noQuota"
  | "noSample"
  | "stale"
  | "noProvider"
  | "accountUnavailable"
  | "noWindow";
export type AssistantQuotaReading =
  | { leftPercent: number; resetsAt?: number; sampledAt: number }
  | { unknown: true; reason: AssistantQuotaUnknownReason };

type Provider = QuotaTarget["provider"];
type Sample = { sampledAt: number; report: UsageLimitsReport };
const accountKey = (provider: Provider, account: string) => `${provider}:${account}`;
const supportsRoutingQuota = (provider: unknown): provider is Provider =>
  isQuotaProvider(provider) && provider !== "grok";

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "-");
const BOUNDARY = /[-_.:/@ ]/;

/** Conservative model match: equal, one id extends the other at a delimiter
 * ("sonnet" ~ "sonnet-4-5", never "gpt-5" ~ "gpt-50"), or a family card name appears as whole
 * delimited words inside the row id (Claude reports `seven_day_opus` as "Opus", which must
 * match "claude-opus-5-5" but never "claude-opusx"). */
export function quotaModelMatches(cardModel: string, rowModel: string): boolean {
  const a = normalize(cardModel);
  const b = normalize(rowModel);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  if (long.startsWith(short) && BOUNDARY.test(long.charAt(short.length))) return true;
  const words = (value: string) => value.split(BOUNDARY).filter(Boolean);
  const family = words(a);
  const id = words(b);
  return id.some((_, start) => family.every((word, offset) => id[start + offset] === word));
}

export type AssistantQuotaReaderDeps = {
  readLimits: (target: QuotaTarget) => Promise<UsageLimitsReport>;
  now?: () => number;
};

/** Host-internal quota view for model-pool selection. Never blocks: `reading()` answers from the
 * last sample and refreshes in the background. Percentages are never combined across accounts;
 * within one account the tightest matching window decides. */
export class AssistantQuotaReader {
  private readonly samples = new Map<string, Sample>();
  private readonly refreshing = new Map<string, Promise<void>>();
  private readonly attempted = new Map<string, number>();
  constructor(private readonly deps: AssistantQuotaReaderDeps) {}
  private now() {
    return (this.deps.now ?? Date.now)();
  }

  reading(harness: string, accountId: string | undefined, model: string): AssistantQuotaReading {
    if (!supportsRoutingQuota(harness)) return { unknown: true, reason: "noQuota" };
    const account = accountId ?? "default";
    this.refreshIfStale(harness, account);
    const sample = this.samples.get(accountKey(harness, account));
    if (!sample) return { unknown: true, reason: "noSample" };
    if (this.now() - sample.sampledAt > QUOTA_STALE_MS) return { unknown: true, reason: "stale" };
    const provider = sample.report.providers.find((entry) => entry.provider === harness);
    if (!provider) return { unknown: true, reason: "noProvider" };
    const status = provider.accounts.find((entry) => entry.id === account);
    if (!status || status.status !== "ok") return { unknown: true, reason: "accountUnavailable" };
    const readings = provider.cards
      .filter((card) => card.model === null || quotaModelMatches(card.model, model))
      .flatMap((card) => card.accounts.filter((entry) => entry.id === account))
      .map((entry) => entry.reading);
    if (!readings.length) return { unknown: true, reason: "noWindow" };
    const tightest = readings.reduce((min, next) =>
      next.leftPercent < min.leftPercent ? next : min,
    );
    return {
      leftPercent: tightest.leftPercent,
      ...(tightest.resetsAt === null ? {} : { resetsAt: tightest.resetsAt }),
      sampledAt: sample.sampledAt,
    };
  }

  /** Bounded warm-up for the settings status read: waits for one refresh when there is no fresh
   * sample, never longer than `timeoutMs`. Run-start selection must not call it. */
  async warm(
    harness: string,
    timeoutMs = QUOTA_WARM_TIMEOUT_MS,
    accountId = "default",
  ): Promise<void> {
    if (!supportsRoutingQuota(harness)) return;
    const key = accountKey(harness, accountId);
    const sample = this.samples.get(key);
    if (sample && this.now() - sample.sampledAt <= QUOTA_STALE_MS) return;
    this.refreshIfStale(harness, accountId);
    const running = this.refreshing.get(key);
    if (!running) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    try {
      await Promise.race([running.catch(() => undefined), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Awaitable refresh for tests and warm-up; selection never calls it. */
  refresh(provider: Provider, accountId = "default"): Promise<void> {
    const key = accountKey(provider, accountId);
    const running = this.refreshing.get(key);
    if (running) return running;
    this.attempted.set(key, this.now());
    const task = this.deps
      .readLimits({ provider, accountId })
      .then((report) => {
        this.samples.set(key, { sampledAt: report.sampledAt, report });
        for (const entry of report.providers) {
          for (const account of entry.accounts) {
            const returnedKey = accountKey(entry.provider, account.id);
            this.samples.set(returnedKey, {
              sampledAt: account.observedAt ?? report.sampledAt,
              report,
            });
            if (returnedKey !== key) this.attempted.set(returnedKey, this.now());
          }
        }
      })
      .finally(() => this.refreshing.delete(key));
    this.refreshing.set(key, task);
    return task;
  }

  private refreshIfStale(provider: Provider, accountId: string) {
    const key = accountKey(provider, accountId);
    if (this.refreshing.has(key)) return;
    const last = this.attempted.get(key);
    if (last !== undefined && this.now() - last < QUOTA_REFRESH_MS) return;
    // A failed read leaves the previous sample to age into unknown.
    this.refresh(provider, accountId).catch(() => undefined);
  }
}
