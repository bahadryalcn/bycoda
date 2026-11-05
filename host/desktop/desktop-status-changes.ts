import { randomUUID } from "node:crypto";

/** Monotonic owner-local invalidation. A waiter observes only this instance. */
export class DesktopStatusChanges {
  private revision = 0;
  private readonly epoch = randomUUID();
  private readonly waiters = new Set<() => void>();

  current(): string { return `${this.epoch}:${this.revision}`; }
  changed(): void {
    this.revision++;
    for (const wake of this.waiters) wake();
  }
  wait(after: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
    if (after !== this.current()) return Promise.resolve(this.current());
    if (this.waiters.size >= 64) return Promise.reject(new Error("Desktop status wait capacity reached."));
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.waiters.delete(finish);
        signal?.removeEventListener("abort", finish);
        resolve(this.current());
      };
      const timer = setTimeout(finish, Math.min(Math.max(timeoutMs, 1), 30_000));
      this.waiters.add(finish);
      signal?.addEventListener("abort", finish, { once: true });
      if (signal?.aborted) finish();
      if (after !== this.current()) finish();
    });
  }
}
