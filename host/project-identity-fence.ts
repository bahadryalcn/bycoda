/** In-process admission for canonical project identity readers and writers.
 * Acquire a writer before entering SQL ownership; never await a writer from SQL. */
export class ProjectIdentityFence {
  private readers = 0;
  private writer = false;
  private queue: { kind: "read" | "write"; grant: () => void }[] = [];
  private drain() {
    if (this.writer || !this.queue.length) return;
    if (this.queue[0].kind === "write") {
      if (this.readers) return;
      this.writer = true;
      this.queue.shift()!.grant();
      return;
    }
    while (this.queue[0]?.kind === "read" && !this.writer) {
      this.readers++;
      this.queue.shift()!.grant();
    }
  }
  async read<T>(effect: (valid: () => boolean) => Promise<T>): Promise<T> {
    await new Promise<void>(grant => { this.queue.push({ kind: "read", grant }); this.drain(); });
    let active = true;
    try { return await effect(() => active); }
    finally { active = false; this.readers--; this.drain(); }
  }
  async write<T>(effect: () => Promise<T>): Promise<T> {
    await new Promise<void>(grant => { this.queue.push({ kind: "write", grant }); this.drain(); });
    try { return await effect(); }
    finally { this.writer = false; this.drain(); }
  }
}
