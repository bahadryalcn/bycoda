/**
 * Owner reads without side effects. They skip the assistant request queue, which
 * a reply model turn can hold for minutes; the store still admits each statement
 * in order, so they never observe another request's open transaction.
 */
export const ASSISTANT_QUEUE_FREE_READS: ReadonlySet<string> = new Set([
  "projects.list",
  "snapshot",
  "profile.get",
  "memory.search",
  "threads.messages",
]);

/**
 * The assistant's exclusive request queue plus its abortable model turns.
 * `released` lets one long provider call run with the queue open, so owner
 * requests (voice start, notes, controls) are not held behind it, then waits
 * for the queue again before the caller commits the result.
 */
export class AssistantRequestQueue {
  private tail: Promise<void> = Promise.resolve();
  private holder?: () => void;
  private readonly active = new Set<Promise<unknown>>();
  private readonly turns = new Set<AbortController>();

  run<T>(work: () => Promise<T>): Promise<T> {
    const task = this.acquire().then(async (release) => {
      this.holder = release;
      try {
        return await work();
      } finally {
        // After `released`, the holder is the re-acquired lock of this same task.
        this.holder?.();
        this.holder = undefined;
      }
    });
    const settled: Promise<unknown> = task.then(
      () => this.active.delete(settled),
      () => this.active.delete(settled),
    );
    this.active.add(settled);
    return task;
  }

  /** Call only from inside `run`. The caller must revalidate state it read before. */
  async released<T>(work: () => Promise<T>): Promise<T> {
    const release = this.holder;
    this.holder = undefined;
    release?.();
    try {
      return await work();
    } finally {
      if (release) this.holder = await this.acquire();
    }
  }

  /** One abortable model turn; `abortTurns` stops every turn in flight. */
  async turn<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    this.turns.add(controller);
    try {
      const result = await work(controller.signal);
      if (controller.signal.aborted) throw new Error("Assistant reasoning was stopped.");
      return result;
    } finally {
      this.turns.delete(controller);
    }
  }

  abortTurns() {
    for (const controller of this.turns) controller.abort();
  }

  /** Settles once every queued and released task has finished. */
  async idle(): Promise<void> {
    while (this.active.size) await Promise.all([...this.active]);
  }

  private acquire(): Promise<() => void> {
    const previous = this.tail;
    let release!: () => void;
    const next = new Promise<void>((resolve) => (release = resolve));
    this.tail = previous.then(() => next);
    return previous.then(() => release);
  }
}
