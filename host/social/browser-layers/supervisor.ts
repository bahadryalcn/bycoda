import type { BrowserSession } from "../social-browser";
import { sanitizeSocialError } from "../core/social-helpers";

const HOUR_MS = 3_600_000;

export type BrowserSupervisorOptions = {
  /** Launches the account's browser on its own persistent profile, so cookies and sign-in survive. */
  launch(accountId: string): Promise<BrowserSession>;
  now?: () => number;
  wait?: (ms: number) => Promise<unknown>;
  /** At most this many automatic restarts per account in any rolling hour. */
  maxRestartsPerHour?: number;
  backoffMs?: readonly number[];
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
  private readonly stopped = new Set<string>();
  private closedAll = false;
  private readonly now: () => number;
  private readonly wait: (ms: number) => Promise<unknown>;
  private readonly maxRestarts: number;
  private readonly backoff: readonly number[];

  constructor(private readonly options: BrowserSupervisorOptions) {
    this.now = options.now ?? Date.now;
    this.wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxRestarts = options.maxRestartsPerHour ?? 3;
    this.backoff = options.backoffMs ?? [2_000, 10_000, 30_000];
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
    this.stopped.add(accountId);
    this.watched.delete(accountId);
  }

  /** Host shutdown. Nothing restarts after this. */
  close(): void {
    this.closedAll = true;
    this.watched.clear();
  }

  private async onClosed(accountId: string, session: BrowserSession): Promise<void> {
    if (this.closedAll || this.stopped.has(accountId) || this.watched.get(accountId) !== session)
      return;
    this.watched.delete(accountId);
    await Promise.resolve(this.options.onInterrupted?.(accountId)).catch(() => undefined);
    await this.restart(accountId);
  }

  private async restart(accountId: string): Promise<void> {
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
        const next = await this.options.launch(accountId);
        this.supervise(accountId, next);
        return;
      } catch {
        // The next loop iteration counts this failed launch against the hourly budget.
      }
    }
  }
}
