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

  wait(deadline: number, cancelled: () => boolean, version = this.version): Promise<void> {
    if (cancelled() || version !== this.version || deadline <= Date.now()) return Promise.resolve();
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.listeners.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, Math.max(0, Math.min(1000, deadline - Date.now())));
      this.listeners.add(wake);
    });
  }
}
