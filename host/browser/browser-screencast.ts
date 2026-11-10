type ScreencastSession = {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on?(event: string, listener: (payload: any) => void): unknown;
  detach(): Promise<void>;
};
type ScreencastPage = {
  context?: () => { newCDPSession(page: any): Promise<unknown> };
};

export type ScreencastFrame = {
  sequence: number;
  /** Base64 JPEG. */
  data: string;
  width: number;
  height: number;
  /** Document the picture was painted for. */
  stamp: string;
};

const MAX_WAIT_MS = 2000;
const IDLE_STOP_MS = 5000;

/** Frame cursor of a live read; bounded before it reaches the wait. */
export function browserFrameCursor(after: unknown, waitMs: unknown) {
  if (!Number.isSafeInteger(after) || Number(after) < 0)
    throw new Error("Invalid browser frame cursor");
  if (waitMs !== undefined && !(Number(waitMs) >= 0 && Number(waitMs) <= MAX_WAIT_MS))
    throw new Error("Invalid browser frame wait");
  return { after: Number(after), waitMs: waitMs === undefined ? 1000 : Number(waitMs) };
}

/**
 * Follows one page through Chromium's screencast and keeps only the newest picture.
 * Readers long-poll with the last sequence they saw; the cast stops by itself once
 * nobody has read for a few seconds, so an unwatched page costs nothing. Viewing only.
 */
export class BrowserScreencast {
  private page?: ScreencastPage;
  private session?: ScreencastSession;
  private starting?: Promise<void>;
  private latest?: ScreencastFrame;
  // Never restarts from zero, so a cursor from an earlier browser cannot hide new frames.
  private sequence = Date.now();
  private readonly waiters = new Set<() => void>();
  private idle?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly describe: () => { stamp: string; width: number; height: number },
    private readonly maxBytes = 2 * 1024 * 1024,
  ) {}

  available(page: ScreencastPage | undefined) {
    return typeof page?.context === "function";
  }

  /** The newest picture after `after` for the current document, waiting up to `waitMs`. */
  async next(page: ScreencastPage, after: number, waitMs: number) {
    if (this.page !== page) await this.stop();
    this.page = page;
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => void this.stop().catch(() => {}), IDLE_STOP_MS);
    this.idle.unref?.();
    try {
      await (this.starting ??= this.start(page));
    } catch (error) {
      // Forget the failed start so the next read tries again.
      await this.stop();
      throw error;
    }
    const current = () =>
      this.latest && this.latest.sequence > after && this.latest.stamp === this.describe().stamp
        ? this.latest
        : undefined;
    if (!current() && waitMs > 0)
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          this.waiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, waitMs);
        this.waiters.add(done);
      });
    const frame = current();
    // A document that changed without repainting gets a fresh first picture next read.
    if (!frame && this.page === page && this.latest?.stamp !== this.describe().stamp)
      await this.stop();
    return frame;
  }

  private async start(page: ScreencastPage) {
    const session = (await page.context!().newCDPSession(page)) as ScreencastSession;
    if (this.page !== page) return void session.detach().catch(() => {});
    this.session = session;
    session.on?.("Page.screencastFrame", (frame: { data?: unknown; sessionId?: unknown }) => {
      // Chromium holds the next picture until this one is acknowledged.
      session.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
      if (this.session !== session || typeof frame.data !== "string") return;
      if (frame.data.length * 0.75 > this.maxBytes) return;
      this.latest = { sequence: ++this.sequence, data: frame.data, ...this.describe() };
      for (const wake of this.waiters) wake();
    });
    await session.send("Page.startScreencast", { format: "jpeg", quality: 65, everyNthFrame: 1 });
  }

  async stop() {
    if (this.idle) clearTimeout(this.idle);
    this.idle = undefined;
    const session = this.session;
    this.session = undefined;
    this.page = undefined;
    this.starting = undefined;
    this.latest = undefined;
    for (const wake of this.waiters) wake();
    await session?.detach().catch(() => {});
  }
}
