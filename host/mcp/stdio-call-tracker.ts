/** Most `tools/call` requests one stdio MCP server runs at once; more are refused, not queued. */
export const MCP_STDIO_MAX_IN_FLIGHT = 32;

/**
 * Lets a JSON-line MCP stdio server keep reading while tool calls run, so `ping`,
 * `tools/list` and parallel calls are answered without waiting behind a slow one.
 * A call started here is aborted by `cancel` (MCP `notifications/cancelled`) and
 * `drain` resolves once every started call has settled.
 */
export class McpStdioCallTracker {
  readonly #active = new Map<string | number, AbortController>();
  readonly #tasks = new Set<Promise<void>>();

  /** True when another call would exceed {@link MCP_STDIO_MAX_IN_FLIGHT}. */
  get full(): boolean {
    return this.#tasks.size >= MCP_STDIO_MAX_IN_FLIGHT;
  }

  /** Runs `work` without blocking the caller. `work` must write its own response unless aborted. */
  start(id: string | number, work: (signal: AbortSignal) => Promise<void>): void {
    const controller = new AbortController();
    // A client reusing an id still in flight must not hide the older call from `cancel`.
    if (!this.#active.has(id)) this.#active.set(id, controller);
    const task: Promise<void> = Promise.resolve()
      .then(() => work(controller.signal))
      // Backstop: `work` reports its own failures, an escaped one must not become unhandled.
      .catch(() => undefined)
      .finally(() => {
        if (this.#active.get(id) === controller) this.#active.delete(id);
        this.#tasks.delete(task);
      });
    this.#tasks.add(task);
  }

  /** Aborts the in-flight call with this JSON-RPC id, if any. */
  cancel(id: unknown): void {
    if (typeof id === "string" || typeof id === "number") this.#active.get(id)?.abort();
  }

  /** Resolves when every started call has settled, including ones started while waiting. */
  async drain(): Promise<void> {
    while (this.#tasks.size) await Promise.all([...this.#tasks]);
  }
}
