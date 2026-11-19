import { errorText } from "./errors";
import { invoke } from "@tauri-apps/api/core";
import { formatDate, t } from "../i18n/core";

// Only GitHub's own wording counts. A loose "rate limit" match would pause every read because an
// unrelated message (a repository or issue title, say) happened to mention the words.
const RATE_LIMITED =
  /API rate limit (?:already )?exceeded|secondary rate limit|abuse detection mechanism|HTTP 429/i;
const MIN_WAIT_MS = 1_000;
/** A stated wait beyond this is treated as malformed, so reads are never parked for days. */
const MAX_WAIT_MS = 24 * 60 * 60_000;
// gh's plain errors rarely carry reset headers. With no stated time wait out GitHub's hourly
// primary window, but let an explicit retry probe once a minute so a lifted limit is noticed.
const UNKNOWN_WAIT_MS = 60 * 60_000;
const UNKNOWN_PROBE_MS = 60_000;
const UNIT_MS = { second: 1_000, minute: 60_000, hour: 3_600_000 } as const;

type Block = {
  /** Automatic reads and every read are refused until then. */
  until: number;
  /** Earliest moment an explicit retry may spend a request. */
  retryAt: number;
  /** GitHub stated the time itself; an explicit retry never bypasses it. */
  stated: boolean;
};

const blocks = new Map<string, Block>();

/** Reads are paused because GitHub is limiting requests; the message is built per throw. */
export class GithubRateLimitError extends Error {
  readonly until: number;
  readonly retryAt: number;
  readonly stated: boolean;

  constructor(block: Block, cause?: unknown) {
    super(
      block.stated
        ? t("GitHub is limiting requests. Automatic reads resume at {p1}.", {
            p1: formatMoment(block.until),
          })
        : t(
            "GitHub is limiting requests and gave no reset time. Automatic reads are paused until about {p1}; Retry can check again from {p2}.",
            { p1: formatMoment(block.until), p2: formatMoment(block.retryAt) },
          ),
      { cause },
    );
    this.name = "GithubRateLimitError";
    this.until = block.until;
    this.retryAt = block.retryAt;
    this.stated = block.stated;
  }
}

function formatMoment(at: number): string {
  const today = new Date().toDateString() === new Date(at).toDateString();
  return formatDate(at, today ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" });
}

/** The reset time GitHub stated in an error, as epoch milliseconds, or null when it did not. */
export function githubRateLimitResetAt(message: string, now = Date.now()): number | null {
  const retryAfter = /retry-after:\s*(\d+)/i.exec(message);
  if (retryAfter) return now + Number(retryAfter[1]) * 1_000;
  const reset = /x-ratelimit-reset:\s*(\d+)/i.exec(message);
  if (reset) return Number(reset[1]) * 1_000;
  const date = /(?:after|until|at)\s+(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*(?:UTC|Z)\b/i.exec(
    message,
  );
  if (date) {
    const at = Date.parse(`${date[1]}T${date[2]}Z`);
    if (Number.isFinite(at)) return at;
  }
  const relative = /(?:try again|retry|wait)\D{0,40}?(\d+)\s*(second|minute|hour)s?\b/i.exec(message);
  if (relative) {
    return now + Number(relative[1]) * UNIT_MS[relative[2]!.toLowerCase() as keyof typeof UNIT_MS];
  }
  return null;
}

function blockFor(message: string, now: number): Block {
  const resetAt = githubRateLimitResetAt(message, now);
  if (resetAt === null || Number.isNaN(resetAt)) {
    return { until: now + UNKNOWN_WAIT_MS, retryAt: now + UNKNOWN_PROBE_MS, stated: false };
  }
  const until = Math.min(Math.max(resetAt, now + MIN_WAIT_MS), now + MAX_WAIT_MS);
  return { until, retryAt: until, stated: true };
}

export async function withGithubRead<T>(work: () => Promise<T>, scope = "local"): Promise<T> {
  const block = blocks.get(scope);
  if (block) {
    if (Date.now() < block.until) throw new GithubRateLimitError(block);
    blocks.delete(scope);
  }
  try {
    return await work();
  } catch (error) {
    if (error instanceof GithubRateLimitError) throw error;
    const message = errorText(error);
    if (!RATE_LIMITED.test(message)) throw error;
    const next = blockFor(message, Date.now());
    const current = blocks.get(scope);
    // A slower in-flight read must not shorten a wait another read already learned.
    const merged = current
      ? {
          until: Math.max(current.until, next.until),
          retryAt: Math.max(current.retryAt, next.retryAt),
          stated: current.stated || next.stated,
        }
      : next;
    blocks.set(scope, merged);
    throw new GithubRateLimitError(merged, error);
  }
}

/**
 * Explicit "Retry": lift a pause GitHub did not time, once a probe is reasonable. A reset time
 * GitHub stated is never bypassed. Returns whether reads may now run for `scope`.
 */
export function releaseGithubReadBlock(scope = "local"): boolean {
  const block = blocks.get(scope);
  if (block && Date.now() >= block.retryAt) blocks.delete(scope);
  return !blocks.has(scope);
}

/** The signed-in account or credential changed; its quota is separate, so old pauses no longer apply. */
export function resetGithubReadBlock(scope?: string): void {
  if (scope === undefined) blocks.clear();
  else blocks.delete(scope);
}

export async function githubRead<T>(command: string, args: Record<string, unknown>): Promise<T> {
  return withGithubRead(() => invoke<T>(command, args));
}
