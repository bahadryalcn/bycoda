import type { UsageLimitsReport } from "../../usage/limits-report";

/** A quota reading is trusted for this long; an older sample counts as unknown. */
export const QUOTA_STALE_MS = 15 * 60_000;
/** Minimum gap between background refreshes of one provider. */
export const QUOTA_REFRESH_MS = 5 * 60_000;

export type AssistantQuotaReading =
  | { leftPercent: number; resetsAt?: number; sampledAt: number }
  | { unknown: true; reason: string };

type Provider = "claude" | "codex" | "opencode";
type Sample = { sampledAt: number; report: UsageLimitsReport };

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
  readLimits: () => Promise<UsageLimitsReport>;
  now?: () => number;
};

/** Host-internal quota view for model-pool selection. Never blocks: `reading()` answers from the
 * last sample and refreshes in the background. Percentages are never combined across accounts;
 * within one account the tightest matching window decides. */
export class AssistantQuotaReader {
  private readonly samples = new Map<Provider, Sample>();
  private readonly refreshing = new Map<Provider, Promise<void>>();
  private readonly attempted = new Map<Provider, number>();
  constructor(private readonly deps: AssistantQuotaReaderDeps) {}
  private now() {
    return (this.deps.now ?? Date.now)();
  }

  reading(harness: string, accountId: string | undefined, model: string): AssistantQuotaReading {
    if (harness !== "claude" && harness !== "codex" && harness !== "opencode")
      return { unknown: true, reason: "noQuota" };
    this.refreshIfStale(harness);
    const sample = this.samples.get(harness);
    if (!sample) return { unknown: true, reason: "noSample" };
    if (this.now() - sample.sampledAt > QUOTA_STALE_MS) return { unknown: true, reason: "stale" };
    const provider = sample.report.providers.find((entry) => entry.provider === harness);
    if (!provider) return { unknown: true, reason: "noProvider" };
    const account = accountId ?? "default";
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

  /** Awaitable refresh for tests and warm-up; selection never calls it. */
  refresh(provider: Provider): Promise<void> {
    const running = this.refreshing.get(provider);
    if (running) return running;
    this.attempted.set(provider, this.now());
    const task = this.deps
      .readLimits()
      .then((report) => {
        // One report covers every provider, so all samples advance together.
        for (const entry of report.providers)
          this.samples.set(entry.provider, { sampledAt: report.sampledAt, report });
      })
      .finally(() => this.refreshing.delete(provider));
    this.refreshing.set(provider, task);
    return task;
  }

  private refreshIfStale(provider: Provider) {
    if (this.refreshing.has(provider)) return;
    const last = this.attempted.get(provider);
    if (last !== undefined && this.now() - last < QUOTA_REFRESH_MS) return;
    // A failed read leaves the previous sample to age into unknown.
    this.refresh(provider).catch(() => undefined);
  }
}
