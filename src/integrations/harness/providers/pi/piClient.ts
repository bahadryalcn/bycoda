import {
  writeChild,
  invalidateChildOutput,
  assertChildTurnWriter,
  type ChildProcessHandle,
  type ChildTurnWriter,
} from "../../core/child";
import { parseJsonLine, parseRpcResponse, stringField } from "./piProtocol";
import {
  captureNativeOutputWork,
  nativeOutputSink,
  trackNativeOutputWork,
  type NativeOutputWork,
} from "../../core/nativeOutputDelivery";

type Pending = {
  writer: ChildTurnWriter | undefined;
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
};

export type PiRpcWriterView = Pick<PiRpc, "request" | "cancelRequest">;

/**
 * JSONL request/response multiplexer for `pi --mode rpc` and the identical
 * `omp --mode rpc`. Agent events and extension UI frames go to `onFrame`.
 */
export class PiRpc {
  private nextId = 1;
  private readonly pending = new Map<string, Pending>();
  private closed = false;

  constructor(
    private readonly process: ChildProcessHandle,
    private readonly onFrame: (rec: Record<string, unknown>) => void,
    private readonly label = "Pi",
  ) {}

  pushLine(line: string) {
    const rec = parseJsonLine(line);
    if (!rec) return;
    const response = parseRpcResponse(rec);
    if (response?.id) {
      const pending = this.pending.get(response.id);
      if (pending && this.removePending(response.id, pending)) {
        if (!response.success) {
          captureNativeOutputWork()?.fail("pi-response-error");
          pending.reject(new Error(response.error || `${this.label} ${response.command} failed`));
          return;
        }
        pending.resolve(rec);
        return;
      }
    }
    // Preserve normal event routing, but a late/unknown response cannot become
    // the original for a replacement request or a binding consumer.
    if (response?.id) captureNativeOutputWork()?.fail("pi-response-unmatched");
    this.onFrame(rec);
  }

  assertProcess(handle: ChildProcessHandle): void {
    if (this.process !== handle)
      throw new Error("Pi RPC client belongs to a different process construction");
  }

  withWriter(writer: ChildTurnWriter): PiRpcWriterView {
    assertChildTurnWriter(this.process, writer);
    return Object.freeze({
      request: (
        command: Record<string, unknown>,
        timeoutMs = 15_000,
        consume?: (
          value: Record<string, unknown>,
          work: NativeOutputWork | null,
        ) => Record<string, unknown> | Promise<Record<string, unknown>>,
      ) => this.requestOwned(writer, command, timeoutMs, consume),
      cancelRequest: (id: string) => {
        const pending = this.pending.get(id);
        if (pending?.writer === writer) this.cancelPending(id, pending);
      },
    });
  }

  request(
    command: Record<string, unknown>,
    timeoutMs = 15_000,
    consume?: (
      value: Record<string, unknown>,
      work: NativeOutputWork | null,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    return this.requestOwned(undefined, command, timeoutMs, consume);
  }

  private async requestOwned(
    writer: ChildTurnWriter | undefined,
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
    const type = stringField(payload, "type") ?? "command";
    let original!: Pending;
    const pending = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.removePending(id, original)) return;
        reject(new Error(`${this.label} ${type} timed out`));
      }, timeoutMs);
      original = {
        writer,
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
      };
      this.pending.set(id, original);
    });
    void writeChild(writer ?? this.process, JSON.stringify(payload)).catch((error) => {
      const message = error instanceof Error ? error : new Error(String(error));
      if (this.removePending(id, original)) original.reject(message);
    });
    return pending;
  }

  close(error?: Error) {
    if (this.closed) return;
    this.closed = true;
    invalidateChildOutput(this.process, "pi-client-closed");
    const err = error ?? new Error(`${this.label} process exited`);
    for (const pending of this.pending.values()) pending.reject(err);
    this.pending.clear();
  }

  cancelRequest(id: string): void {
    const pending = this.pending.get(id);
    if (pending) this.cancelPending(id, pending);
  }

  private cancelPending(id: string, pending: Pending): void {
    if (this.removePending(id, pending))
      pending.reject(new Error(`${this.label} request cancelled`));
  }

  private removePending(id: string, original: Pending): boolean {
    if (this.pending.get(id) !== original) return false;
    this.pending.delete(id);
    return true;
  }
}
