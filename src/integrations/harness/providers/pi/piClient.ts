import { writeChild } from "../../core/child";
import { parseJsonLine, parseRpcResponse, stringField } from "./piProtocol";
import {
  captureNativeOutputWork,
  nativeOutputSink,
  trackNativeOutputWork,
  invalidateNativeOutputSession,
  type NativeOutputWork,
} from "../../core/nativeOutputDelivery";

type Pending = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
};

/**
 * JSONL request/response multiplexer for `pi --mode rpc` and the identical
 * `omp --mode rpc`. Agent events and extension UI frames go to `onFrame`.
 */
export class PiRpc {
  private nextId = 1;
  private readonly pending = new Map<string, Pending>();
  private closed = false;

  constructor(
    private readonly sessionId: string,
    private readonly onFrame: (rec: Record<string, unknown>) => void,
    private readonly label = "Pi",
  ) {}

  pushLine(line: string) {
    const rec = parseJsonLine(line);
    if (!rec) return;
    const response = parseRpcResponse(rec);
    if (response?.id && this.pending.has(response.id)) {
      const pending = this.pending.get(response.id);
      this.pending.delete(response.id);
      if (!pending) return;
      if (!response.success) {
        captureNativeOutputWork()?.fail("pi-response-error");
        pending.reject(new Error(response.error || `${this.label} ${response.command} failed`));
        return;
      }
      pending.resolve(rec);
      return;
    }
    // Preserve normal event routing, but a late/unknown response cannot become
    // the original for a replacement request or a binding consumer.
    if (response?.id) captureNativeOutputWork()?.fail("pi-response-unmatched");
    this.onFrame(rec);
  }

  async request(
    command: Record<string, unknown>,
    timeoutMs = 15_000,
    consume?: (
      value: Record<string, unknown>,
      work: NativeOutputWork | null,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    if (this.closed) throw new Error(`${this.label} process is not running`);
    const id = stringField(command, "id") ?? `mc_${this.nextId++}`;
    if (this.pending.has(id)) throw new Error(`Duplicate RPC request id: ${id}`);
    const payload = { ...command, id };
    const pending = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const type = stringField(command, "type") ?? "command";
        reject(new Error(`${this.label} ${type} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          if (!consume) {
            captureNativeOutputWork()?.fail("pi-response-consumer-untracked");
            resolve(value);
            return;
          }
          const work = captureNativeOutputWork();
          const actual = Promise.resolve().then(nativeOutputSink(work, () => consume(value, work)));
          void trackNativeOutputWork(actual, work).then(resolve, reject);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
    void writeChild(this.sessionId, JSON.stringify(payload)).catch((error) => {
      const message = error instanceof Error ? error : new Error(String(error));
      const request = this.pending.get(id);
      this.pending.delete(id);
      request?.reject(message);
    });
    return pending;
  }

  close(error?: Error) {
    if (this.closed) return;
    this.closed = true;
    invalidateNativeOutputSession(this.sessionId, "pi-client-closed");
    const err = error ?? new Error(`${this.label} process exited`);
    for (const pending of this.pending.values()) pending.reject(err);
    this.pending.clear();
  }

  cancelRequest(id: string): void {
    const pending = this.pending.get(id);
    this.pending.delete(id);
    pending?.reject(new Error(`${this.label} request cancelled`));
  }
}
