/** Tracks the original query whose terminal result is still owed after Stop.
 * The CLI stream does not identify a result by query, so no later query may
 * enter the same process until that exact outstanding slot has drained. */
export class ClaudeQueryFence {
  private generation = 0;
  private current: { generation: number; interrupted: boolean } | null = null;
  private uncertain = false;

  assertReady(): void {
    if (this.current || this.uncertain)
      throw new Error(
        "Claude is still settling a previous query. Stop the session before retrying.",
      );
  }

  begin(): number {
    this.assertReady();
    const generation = ++this.generation;
    this.current = { generation, interrupted: false };
    return generation;
  }

  interrupt(generation: number): void {
    if (this.current?.generation === generation) this.current.interrupted = true;
  }

  /** A background wakeup may produce an uncorrelated future result. */
  hold(): void {
    this.uncertain = true;
  }

  /** A failed/unknown write cannot prove that the query did not reach Claude. */
  writeFailed(generation: number): void {
    if (this.current?.generation === generation) this.uncertain = true;
  }

  terminal(): { generation: number; interrupted: boolean } | null {
    const current = this.current;
    if (!current) {
      this.uncertain = true;
      return null;
    }
    this.current = null;
    return current;
  }
}
