import { ChangeSignal } from "./changeSignal";
/** Bounded, cancellable long-poll. Reads must be metadata-only/cache hits. */
export class RevisionWaits {
  private active = 0;
  constructor(
    private readonly maximum = 64,
    private readonly signal = new ChangeSignal(),
  ) {}
  async wait(
    read: () => number | Promise<number>,
    revision: number,
    duration: number,
    cancelled: () => boolean | Promise<boolean> = () => false,
    recheckMs: () => number | Promise<number> = () => 1000,
  ): Promise<void> {
    let version = this.signal.version;
    if (this.active >= this.maximum) return;
    this.active++;
    const deadline = Date.now() + Math.min(10_000, Math.max(0, duration));
    try {
      while (!(await cancelled()) && (await read()) === revision && Date.now() < deadline) {
        await this.signal.wait(
          Math.min(deadline, Date.now() + (await recheckMs())),
          cancelled,
          version,
        );
        version = this.signal.version;
      }
    } finally {
      this.active--;
    }
  }
}
