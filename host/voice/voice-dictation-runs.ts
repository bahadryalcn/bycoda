/** Owner-scoped cleanup cancellation survives RPC reordering for the maximum request lifetime. */
export class DictationCleanupRuns {
  private active = new Map<string, AbortController>();
  private cancelled = new Map<string, number>();
  private readonly lifetimeMs = 5 * 60_000;
  private key(owner: string, id: unknown): string {
    if (
      !owner ||
      typeof id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    )
      throw new Error("Invalid dictation run identity.");
    return JSON.stringify([owner, id]);
  }
  private prune() {
    const now = Date.now();
    for (const [key, expires] of this.cancelled) if (expires <= now) this.cancelled.delete(key);
  }
  cancel(owner: string, id: unknown): void {
    const key = this.key(owner, id);
    this.prune();
    if (
      !this.cancelled.has(key) &&
      !this.active.has(key) &&
      this.cancelled.size + this.active.size >= 4096
    )
      throw new Error("Too many cancelled dictation runs.");
    this.cancelled.set(key, Date.now() + this.lifetimeMs);
    this.active.get(key)?.abort();
  }
  async process<T>(
    owner: string,
    id: unknown,
    input: T,
    run: (input: T, signal: AbortSignal) => Promise<{ text: string }>,
  ): Promise<{ text: string }> {
    const key = this.key(owner, id);
    this.prune();
    if (this.cancelled.has(key)) throw new Error("Dictation cleanup cancelled.");
    if (this.active.has(key)) throw new Error("Dictation cleanup already active.");
    if (this.cancelled.size + this.active.size >= 4096) throw new Error("Too many dictation runs.");
    const controller = new AbortController();
    this.active.set(key, controller);
    try {
      return await run(input, controller.signal);
    } finally {
      this.active.delete(key);
    }
  }
}
