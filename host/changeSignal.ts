/** Shared wakeup clock. A generation closes the read/subscribe race. */
export class ChangeSignal {
  version = 0;
  private listeners = new Set<() => void>();
  private queued = false;

  notify(): void {
    this.version++;
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      for (const wake of [...this.listeners]) wake();
    });
  }

  async wait(
    deadline: number,
    cancelled: () => boolean | Promise<boolean>,
    version = this.version,
    signal?: AbortSignal,
  ): Promise<void> {
    if (
      signal?.aborted ||
      (await cancelled()) ||
      signal?.aborted ||
      version !== this.version ||
      deadline <= Date.now()
    )
      return;
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.listeners.delete(wake);
        signal?.removeEventListener("abort", wake);
        resolve();
      };
      const timer = setTimeout(wake, Math.max(0, Math.min(1000, deadline - Date.now())));
      this.listeners.add(wake);
      signal?.addEventListener("abort", wake, { once: true });
      if (signal?.aborted) wake();
    });
  }
}
