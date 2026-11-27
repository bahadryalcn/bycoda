import type { BrowserSession } from "../social-browser";
import { sanitizeSocialError } from "../core/social-helpers";

const HOUR_MS = 3_600_000;
/** A relaunch that has not exposed its browser by then counts as a failed attempt. */
const DEFAULT_LAUNCH_TIMEOUT_MS = 60_000;

export type BrowserSupervisorOptions = {
  /** Launches the account's browser on its own persistent profile, so cookies and sign-in survive. */
  launch(accountId: string): Promise<BrowserSession>;
  now?: () => number;
  wait?: (ms: number) => Promise<unknown>;
  /** At most this many automatic restarts per account in any rolling hour. */
  maxRestartsPerHour?: number;
  backoffMs?: readonly number[];
  /** Deadline for one `launch` call; a late session is closed, never supervised. */
  launchTimeoutMs?: number;
  /** A running browser task was cut off. The caller moves that job to review; nothing is resent here. */
  onInterrupted?(accountId: string): void | Promise<void>;
  /** Automatic restarts are exhausted; the owner must start the account again. */
  onGaveUp?(accountId: string): void | Promise<void>;
};

/**
 * Restarts a browser that closed or crashed without being stopped by the owner. Stopping on purpose is
 * `stop(accountId)`, which never restarts. The supervisor never resends work.
 */
export class BrowserSupervisor {
  private readonly watched = new Map<string, BrowserSession>();
  private readonly restarts = new Map<string, number[]>();
  /** Accounts whose restart loop is in flight; only that loop can read `stopped` for them. */
  private readonly recovering = new Set<string>();
  private readonly stopped = new Set<string>();
  private closedAll = false;
  private readonly now: () => number;
  private readonly wait: (ms: number) => Promise<unknown>;
  private readonly maxRestarts: number;
  private readonly backoff: readonly number[];
  private readonly launchTimeoutMs: number;

  constructor(private readonly options: BrowserSupervisorOptions) {
    this.now = options.now ?? Date.now;
    this.wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxRestarts = options.maxRestartsPerHour ?? 3;
    this.backoff = options.backoffMs ?? [2_000, 10_000, 30_000];
    this.launchTimeoutMs = options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS;
  }

  supervise(accountId: string, session: BrowserSession): void {
    if (this.closedAll) return;
    this.stopped.delete(accountId);
    this.watched.set(accountId, session);
    const handled = (): void => {
      void this.onClosed(accountId, session).catch((error) =>
        console.error("Social browser restart failed:", sanitizeSocialError(error)),
      );
    };
    void session.closed.then(handled, handled);
  }

  /** The owner stopped the account on purpose. No restart follows. */
  stop(accountId: string): void {
    this.watched.delete(accountId);
    // Only an in-flight restart loop can still act on this account; it must see the stop.
    if (this.recovering.has(accountId)) this.stopped.add(accountId);
    this.prune(this.now());
  }

  /** Host shutdown. Nothing restarts after this. */
  close(): void {
    this.closedAll = true;
    this.watched.clear();
    this.stopped.clear();
    this.restarts.clear();
  }

  private async onClosed(accountId: string, session: BrowserSession): Promise<void> {
    if (this.closedAll || this.stopped.has(accountId) || this.watched.get(accountId) !== session)
      return;
    this.watched.delete(accountId);
    await Promise.resolve(this.options.onInterrupted?.(accountId)).catch(() => undefined);
    await this.restart(accountId);
  }

  private async restart(accountId: string): Promise<void> {
    this.recovering.add(accountId);
    try {
      for (;;) {
        if (this.closedAll || this.stopped.has(accountId)) return;
        const now = this.now();
        const recent = (this.restarts.get(accountId) ?? []).filter((at) => now - at < HOUR_MS);
        this.restarts.set(accountId, recent);
        if (recent.length >= this.maxRestarts) {
          await Promise.resolve(this.options.onGaveUp?.(accountId)).catch(() => undefined);
          return;
        }
        const delay = this.backoff[Math.min(recent.length, this.backoff.length - 1)] ?? 0;
        recent.push(now);
        await this.wait(delay);
        if (this.closedAll || this.stopped.has(accountId)) return;
        try {
          const next = await this.launchBounded(accountId);
          // A stop, a close or a takeover that arrived during the launch wins: the new browser is ours to end.
          if (this.closedAll || this.stopped.has(accountId) || this.watched.has(accountId)) {
            discard(next);
            return;
          }
          this.supervise(accountId, next);
          return;
        } catch {
          // The next loop iteration counts this failed launch against the hourly budget.
        }
      }
    } finally {
      this.recovering.delete(accountId);
      this.stopped.delete(accountId);
      this.prune(this.now());
    }
  }

  /** Races one launch against the deadline. A launch that lands after the deadline is closed here. */
  private async launchBounded(accountId: string): Promise<BrowserSession> {
    let abandoned = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const launched = this.options.launch(accountId);
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abandoned = true;
        reject(new Error("Social browser launch timed out"));
      }, this.launchTimeoutMs);
    });
    try {
      return await Promise.race([launched, deadline]);
    } catch (error) {
      launched.then(
        (late) => {
          if (abandoned) discard(late);
        },
        () => undefined,
      );
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Drops restart history only for accounts nothing can use: no watched browser, no restart in flight,
   * and no launch still counting against the hourly budget.
   */
  private prune(now: number): void {
    for (const [accountId, times] of this.restarts) {
      const recent = times.filter((at) => now - at < HOUR_MS);
      if (recent.length > 0) this.restarts.set(accountId, recent);
      else if (!this.watched.has(accountId) && !this.recovering.has(accountId))
        this.restarts.delete(accountId);
      else this.restarts.set(accountId, recent);
    }
  }
}

/** Closes a browser nobody will supervise. A synchronous throw from `close` is contained too. */
function discard(session: BrowserSession): void {
  void Promise.resolve()
    .then(() => session.close())
    .catch(() => undefined);
}
