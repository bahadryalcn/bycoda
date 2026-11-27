type Result = { sequence: number; blocks?: string[]; failed?: boolean };
type Listener = { result: (source: string, blocks: string[]) => void; error: () => void };
type Port = Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror">;

/** One worker, one in-flight parse, and only the latest queued text per mounted reply. */
export class MarkdownParseQueue {
  private worker: Port | null = null;
  private listeners = new Map<string, Listener>();
  private latest = new Map<string, string>();
  private queued = new Map<string, string>();
  private flight: { stream: string; text: string; sequence: number } | null = null;
  private sequence = 0;
  private failed = false;
  /** Replies whose parse exceeded the deadline; they keep the bounded fallback without poisoning siblings. */
  private timedOut = new Set<string>();
  private deadline?: ReturnType<typeof setTimeout>;
  constructor(
    private readonly create: () => Port,
    private readonly timeoutMs = 15_000,
  ) {}

  subscribe(stream: string, listener: Listener) {
    this.listeners.set(stream, listener);
    return () => {
      if (this.listeners.get(stream) !== listener) return;
      this.listeners.delete(stream);
      this.latest.delete(stream);
      this.queued.delete(stream);
      this.timedOut.delete(stream);
      if (!this.listeners.size) {
        this.failed = false;
        this.worker?.terminate();
        this.worker = null;
        this.flight = null;
        clearTimeout(this.deadline);
        this.deadline = undefined;
      }
    };
  }

  request(stream: string, text: string) {
    if (!this.listeners.has(stream)) return;
    if (this.failed || this.timedOut.has(stream)) {
      this.listeners.get(stream)?.error();
      return;
    }
    this.latest.set(stream, text);
    this.queued.set(stream, text);
    this.pump();
  }

  private pump() {
    if (this.flight || !this.queued.size) return;
    if (!this.worker) {
      try {
        const worker = this.create();
        this.worker = worker;
        worker.onmessage = (event: MessageEvent<Result>) => {
          if (this.worker !== worker || this.flight?.sequence !== event.data.sequence) return;
          const completed = this.flight;
          this.flight = null;
          clearTimeout(this.deadline);
          this.deadline = undefined;
          const desired = this.latest.get(completed.stream);
          const listener = this.listeners.get(completed.stream);
          if (
            event.data.failed ||
            !Array.isArray(event.data.blocks) ||
            event.data.blocks.some((block) => typeof block !== "string")
          )
            listener?.error();
          else if (desired?.startsWith(completed.text))
            listener?.result(completed.text, event.data.blocks);
          this.pump();
        };
        worker.onerror = () => {
          if (this.worker === worker) this.fail();
        };
      } catch {
        this.fail();
        return;
      }
    }
    const [stream, text] = this.queued.entries().next().value!;
    this.queued.delete(stream);
    this.flight = { stream, text, sequence: ++this.sequence };
    this.deadline = setTimeout(() => this.expire(), this.timeoutMs);
    try {
      this.worker!.postMessage(this.flight);
    } catch {
      this.fail();
    }
  }

  /** A slow parse blocks the single worker: replace it, fail only that reply, keep the rest in order. */
  private expire() {
    const slow = this.flight?.stream;
    this.deadline = undefined;
    this.worker?.terminate();
    this.worker = null;
    this.flight = null;
    if (slow === undefined) return;
    this.latest.delete(slow);
    this.queued.delete(slow);
    const listener = this.listeners.get(slow);
    if (listener) {
      this.timedOut.add(slow);
      listener.error();
    }
    this.pump();
  }

  private fail() {
    this.failed = true;
    clearTimeout(this.deadline);
    this.deadline = undefined;
    this.worker?.terminate();
    this.worker = null;
    this.flight = null;
    this.queued.clear();
    for (const listener of this.listeners.values()) listener.error();
  }
}
