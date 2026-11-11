/**
 * Joins the two jumps behind "jump to latest": the paging window moves to the
 * tail, then the follow hook pins the scroller. The jumps come from hooks that
 * depend on each other, so each registers here when it exists.
 */
export class JumpRelay {
  private paging: (() => void) | null = null;
  private follow: (() => void) | null = null;

  /** Registers the paging jump; the returned function unregisters it. */
  setPaging(jump: () => void): () => void {
    this.paging = jump;
    return () => {
      if (this.paging === jump) this.paging = null;
    };
  }

  setFollow(jump: (() => void) | null): void {
    this.follow = jump;
  }

  readonly jump = (): void => {
    this.paging?.();
    this.follow?.();
  };
}
