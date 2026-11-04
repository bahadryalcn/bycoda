/** Deadlines abort actual fetch/read work. Rejection is observation, never proof
 * that a provider did not accept a generation or that remote work stopped. */
export class HttpStreamScope {
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private readonly total: ReturnType<typeof setTimeout>;
  private idle: ReturnType<typeof setTimeout>;
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private response?: Response;
  private cancellation?: Promise<void>;
  private readonly sourceAbort = () => this.controller.abort(this.source.reason);

  constructor(
    private readonly source: AbortSignal,
    private readonly budget: { firstMs: number; idleMs: number; totalMs: number; label: string },
  ) {
    this.signal.addEventListener("abort", () => this.cancelReader(), { once: true });
    const expire = (phase: string) => this.controller.abort(new Error(`${budget.label} ${phase} timed out.`));
    this.total = setTimeout(() => expire("total stream"), budget.totalMs);
    this.idle = setTimeout(() => expire("first response"), budget.firstMs);
    this.total.unref?.();
    this.idle.unref?.();
    source.addEventListener("abort", this.sourceAbort, { once: true });
    if (source.aborted) this.sourceAbort();
  }

  async request(start: (signal: AbortSignal) => Promise<Response>): Promise<Response> {
    this.signal.throwIfAborted();
    const pending = start(this.signal);
    // A custom transport can ignore abort and return later. Its original body
    // still gets disposed; a timeout must not disclose or consume late output.
    void pending.then((response) => {
      this.response = response;
      if (this.signal.aborted) this.cancelReader();
    }, () => {}).catch(() => {});
    const response = await this.wait(pending);
    this.response = response;
    this.signal.throwIfAborted();
    return response;
  }

  body(response: Response): void {
    this.signal.throwIfAborted();
    if (!response.body) throw new Error(`${this.budget.label} returned no body.`);
    this.reader = response.body.getReader();
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.controller.abort(new Error(`${this.budget.label} body timed out.`)), this.budget.idleMs);
    this.idle.unref?.();
  }

  async read(): Promise<ReadableStreamReadResult<Uint8Array>> {
    this.signal.throwIfAborted();
    if (!this.reader) throw new Error("HTTP response reader is unavailable.");
    const value = await this.wait(this.reader.read());
    this.signal.throwIfAborted();
    this.idle.refresh();
    return value;
  }

  private wait<T>(pending: Promise<T>): Promise<T> {
    // Remove each completed wait's listener. Repeated races against one never-
    // settled abort promise would retain a reaction for every tiny body chunk.
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        this.signal.removeEventListener("abort", abort);
        reject(this.signal.reason);
      };
      this.signal.addEventListener("abort", abort, { once: true });
      void pending.then((value) => {
        this.signal.removeEventListener("abort", abort);
        if (this.signal.aborted) reject(this.signal.reason);
        else resolve(value);
      }, (error: unknown) => {
        this.signal.removeEventListener("abort", abort);
        reject(error);
      });
      if (this.signal.aborted) abort();
    });
  }

  private cancelReader(): void {
    if (this.cancellation) return;
    const reader = this.reader, body = this.response?.body;
    if (reader) {
      this.cancellation = Promise.resolve().then(() => reader.cancel(this.signal.reason)).finally(() => reader.releaseLock());
    } else if (body) {
      this.cancellation = Promise.resolve().then(() => body.cancel(this.signal.reason));
    }
    void this.cancellation?.catch(() => {});
  }

  close(): void {
    clearTimeout(this.total);
    clearTimeout(this.idle);
    this.source.removeEventListener("abort", this.sourceAbort);
    this.controller.abort(new Error("HTTP stream scope closed."));
    this.cancelReader();
  }
}

/** Enforce wire-byte limits before retaining or decoding the next body chunk. */
export async function readHttpBytes(scope: HttpStreamScope, response: Response, limit: number): Promise<Uint8Array> {
  scope.body(response);
  const length = response.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > limit)
    throw new Error("HTTP response exceeds byte limit.");
  // Doubling storage bounds both bytes and fragment metadata for tiny chunks.
  let body = new Uint8Array(Math.min(limit, 65536));
  let bytes = 0;
  while (true) {
    const value = await scope.read();
    if (value.done) break;
    const next = bytes + value.value.byteLength;
    if (next > limit) throw new Error("HTTP response exceeds byte limit.");
    if (next > body.length) {
      const grown = new Uint8Array(Math.min(limit, Math.max(next, body.length * 2)));
      grown.set(body);
      body = grown;
    }
    body.set(value.value, bytes);
    bytes = next;
  }
  return bytes === body.length ? body : body.slice(0, bytes);
}
