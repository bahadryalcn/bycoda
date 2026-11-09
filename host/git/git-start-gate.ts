import { setTimeout as delay } from "node:timers/promises";

/** Space Windows process creation, without holding a lock while Git performs its work. */
export class GitStartGate {
  private tail = Promise.resolve();
  private previous = Number.NEGATIVE_INFINITY;
  constructor(private readonly spacingMs: number) {}

  enter(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.spacingMs <= 0) return Promise.resolve();
    const turn = this.tail
      .catch(() => {})
      .then(async () => {
        signal?.throwIfAborted();
        const remaining = this.spacingMs - (Date.now() - this.previous);
        if (remaining > 0) await delay(remaining, undefined, { signal });
        this.previous = Date.now();
      });
    this.tail = turn;
    if (!signal) return turn;
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      void turn.then(
        () => {
          signal.removeEventListener("abort", abort);
          resolve();
        },
        (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
      if (signal.aborted) abort();
    });
  }
}

export const hostGitStarts = new GitStartGate(process.platform === "win32" ? 100 : 0);
