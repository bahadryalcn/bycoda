export type WindowsBirth = {
  pid: number;
  state: "alive" | "missing" | "unknown";
  startedAt?: string | null;
};
export type WindowsBirthLookup = (pids: number[]) => WindowsBirth[];

/** Coalesce identity lookups without retaining stale process identities. */
export class WindowsBirthBatch {
  private queue = new Map<
    number,
    Array<{ resolve: (value: WindowsBirth) => void; reject: (error: unknown) => void }>
  >();
  constructor(private readonly lookup: WindowsBirthLookup) {}
  /** Always fresh: callers must never signal using a cached identity. */
  get(pid: number): Promise<WindowsBirth> {
    return new Promise((resolve, reject) => {
      const first = this.queue.size === 0;
      const waiters = this.queue.get(pid) ?? [];
      waiters.push({ resolve, reject });
      this.queue.set(pid, waiters);
      if (!first) return;
      queueMicrotask(() => {
        const batch = this.queue;
        this.queue = new Map();
        try {
          const ids = [...batch.keys()];
          const rows = this.lookup(ids);
          const indexed = new Map(rows.map((row) => [row.pid, row]));
          if (rows.length !== ids.length || indexed.size !== ids.length)
            throw new Error("Invalid native process identity batch");
          for (const [id, listeners] of batch) {
            const row = indexed.get(id);
            if (
              !row ||
              !["alive", "missing", "unknown"].includes(row.state) ||
              (row.state === "alive" &&
                (typeof row.startedAt !== "string" || !/^\d+$/.test(row.startedAt)))
            )
              throw new Error("Invalid native process identity");
            for (const listener of listeners) listener.resolve(row);
          }
        } catch (error) {
          for (const listeners of batch.values())
            for (const listener of listeners) listener.reject(error);
        }
      });
    });
  }
}
