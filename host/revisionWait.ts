/** Bounded, cancellable long-poll. Reads must be metadata-only/cache hits. */
export class RevisionWaits {
  private active = 0;
  constructor(private readonly maximum = 64) {}
  async wait(
    read: () => number,
    revision: number,
    duration: number,
    cancelled: () => boolean = () => false,
  ): Promise<void> {
    if (this.active >= this.maximum || read() !== revision) return;
    this.active++;
    const deadline = Date.now() + Math.min(10_000, Math.max(0, duration));
    try {
      while (!cancelled() && read() === revision && Date.now() < deadline)
        await new Promise<void>((resolve) =>
          setTimeout(resolve, Math.min(100, deadline - Date.now())),
        );
    } finally {
      this.active--;
    }
  }
}
