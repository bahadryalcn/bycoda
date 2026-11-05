import { randomUUID } from "node:crypto";

/** Monotonic owner-local invalidation. A waiter observes only this instance. */
export class DesktopStatusChanges {
  private revision = 0;
  private readonly epoch = randomUUID();
  private readonly waiters = new Set<() => void>();
  private readonly waitersByOwner = new Map<string, number>();

  current(): string {
    return `${this.epoch}:${this.revision}`;
  }
  changed(): void {
    this.revision++;
    for (const wake of this.waiters) wake();
  }
  /**
   * `owner` is the caller's device identity. Waiters are capped globally and per
   * owner so one authorized device cannot starve the others.
   */
  wait(after: string, timeoutMs: number, signal?: AbortSignal, owner = ""): Promise<string> {
    if (after !== this.current()) return Promise.resolve(this.current());
    if (this.waiters.size >= 64)
      return Promise.reject(new Error("Desktop status wait capacity reached."));
    const held = this.waitersByOwner.get(owner) ?? 0;
    if (owner && held >= 8)
      return Promise.reject(new Error("Desktop status wait capacity reached for this device."));
    // A non-finite timeout (for example NaN from a malformed request) is capped instead of
    // becoming setTimeout(NaN), which fires after about 1 ms and turns into a hot poll loop.
    const delay = Number.isFinite(timeoutMs) ? Math.min(Math.max(timeoutMs, 1), 30_000) : 30_000;
    if (owner) this.waitersByOwner.set(owner, held + 1);
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.waiters.delete(finish);
        if (owner) {
          const count = (this.waitersByOwner.get(owner) ?? 1) - 1;
          if (count > 0) this.waitersByOwner.set(owner, count);
          else this.waitersByOwner.delete(owner);
        }
        signal?.removeEventListener("abort", finish);
        resolve(this.current());
      };
      const timer = setTimeout(finish, delay);
      this.waiters.add(finish);
      signal?.addEventListener("abort", finish, { once: true });
      if (signal?.aborted) finish();
      if (after !== this.current()) finish();
    });
  }
}
