import { TurnNotReadyError } from "../../core/types";

/** Tracks the original query whose terminal result is still owed after Stop.
 * The CLI stream does not identify a result by query, so no later query may
 * enter the same process until that exact outstanding slot has drained. */
export class ClaudeQueryFence {
  private generation = 0;
  private current: { generation: number; interrupted: boolean } | null = null;
  private uncertain = false;

  /** A typed pre-write refusal: the caller queues the message and retries
   * once the provider confirms idle, instead of failing the send. */
  assertReady(): void {
    if (this.current || this.uncertain)
      throw new TurnNotReadyError(
        "Claude is still settling a previous query. The message stays queued.",
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

  /** The provider confirmed idle (the turn's result arrived and nothing is
   * outstanding, or the wait for a background wakeup expired). Clears the
   * uncertainty latch so later messages are admitted again. */
  settle(): void {
    this.uncertain = false;
  }

  /** A failed/unknown write cannot prove that the query did not reach Claude. */
  writeFailed(generation: number): void {
    if (this.current?.generation === generation) this.uncertain = true;
  }

  terminal(): { generation: number; interrupted: boolean } | null {
    const current = this.current;
    if (!current) {
      // A stray result is the provider's terminal for an earlier query. It is
      // consumed here, so nothing remains outstanding that the latch guards.
      this.uncertain = false;
      return null;
    }
    this.current = null;
    return current;
  }
}
