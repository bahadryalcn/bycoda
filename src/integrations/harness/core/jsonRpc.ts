import {
  writeChild,
  invalidateChildOutput,
  assertChildTurnWriter,
  type ChildProcessHandle,
  type ChildTurnWriter,
} from "./child";
import { DeliveryUnknownError, type DeliverySettlement } from "../../../shared/lib/deliveryUnknown";
import {
  captureNativeOutputWork,
  nativeOutputSink,
  trackNativeOutputWork,
  type NativeOutputWork,
} from "./nativeOutputDelivery";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type JsonRpcId = number | string;

export type JsonRpcMessage = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

export class JsonRpcResponseError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "JsonRpcResponseError";
  }
}

// A child wedged hard enough to block stdin writes is unrecoverable; the
// write deadline fails the request so the caller can recycle the generation.
const WRITE_TIMEOUT_MS = 15_000;

export type JsonRpcHandlers = {
  onNotification?: (
    method: string,
    params: unknown,
    work?: NativeOutputWork,
  ) => void | Promise<void>;
  onRequest?: (
    id: JsonRpcId,
    method: string,
    params: unknown,
    work?: NativeOutputWork,
  ) => void | Promise<void>;
};

export type JsonRpcClientOptions = {
  /** Include `"jsonrpc":"2.0"` on outbound messages. Default true (ACP). Codex omits it. */
  includeJsonrpc?: boolean;
  label?: string;
  defaultRequestTimeoutMs?: number;
};

export type JsonRpcWriterView = Pick<
  JsonRpcClient,
  "request" | "requestWithNativeOutput" | "notify" | "respond" | "respondError" | "isClosed"
>;

/**
 * Bidirectional JSON-RPC / JSONL client over a harness child process stdin/stdout.
 * Supports numeric and string request ids; Codex app-server uses headerless frames.
 */
export class JsonRpcClient {
  private nextId = 1;
  private readonly pending = new Map<string, Pending>();
  private closed = false;
  private readonly includeJsonrpc: boolean;
  private readonly label: string;
  private readonly defaultRequestTimeoutMs: number;
  private readonly serverRequests = new Map<string, string>();
  private readonly sessionId: string;

  constructor(
    private readonly child: ChildProcessHandle,
    private readonly handlers: JsonRpcHandlers,
    options: JsonRpcClientOptions = {},
  ) {
    this.sessionId = child.sessionId;
    this.includeJsonrpc = options.includeJsonrpc !== false;
    this.label = options.label ?? "rpc";
    this.defaultRequestTimeoutMs = options.defaultRequestTimeoutMs ?? 0;
  }

  pushLine(line: string) {
    if (this.closed) return;
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(trimmed) as JsonRpcMessage;
    } catch {
      console.debug(`[${this.label} ${this.sessionId}] non-json`, trimmed.slice(0, 200));
      return;
    }
    if (
      !msg ||
      typeof msg !== "object" ||
      Array.isArray(msg) ||
      (msg.id != null && typeof msg.id !== "string" && typeof msg.id !== "number") ||
      (typeof msg.id === "number" && !Number.isFinite(msg.id)) ||
      (msg.method !== undefined && typeof msg.method !== "string") ||
      (msg.error !== undefined &&
        (msg.error === null || typeof msg.error !== "object" || Array.isArray(msg.error)))
    ) {
      console.warn(`[bycoda] ${this.label} malformed JSON-RPC envelope`);
      return;
    }
    this.handle(msg);
  }

  close(error?: Error) {
    if (this.closed) return;
    this.closed = true;
    invalidateChildOutput(this.child, "rpc-client-closed");
    this.serverRequests.clear();
    const err = error ?? new Error("Harness process exited");
    this.rejectPending(err);
  }

  /** Drop in-flight client requests so a cancelled turn can unwind. */
  rejectPending(error?: Error) {
    if (this.pending.size) invalidateChildOutput(this.child, "rpc-pending-rejected");
    const err = error ?? new Error("cancelled");
    for (const [, pending] of this.pending) pending.reject(err);
    this.pending.clear();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  assertProcess(handle: ChildProcessHandle): void {
    if (this.child !== handle)
      throw new Error("RPC client belongs to a different process construction");
  }

  withWriter(writer: ChildTurnWriter): JsonRpcWriterView {
    assertChildTurnWriter(this.child, writer);
    const client = this;
    return Object.freeze({
      get isClosed() {
        return client.isClosed;
      },
      request: <T>(
        method: string,
        params?: unknown,
        timeoutMs = this.defaultRequestTimeoutMs,
        consume?: (value: T, work: NativeOutputWork | null) => T | Promise<T>,
      ) => this.requestOwned(writer, method, params, timeoutMs, consume),
      requestWithNativeOutput: <T>(
        method: string,
        params: unknown,
        consume: (value: T, work: NativeOutputWork | null) => T | Promise<T>,
        timeoutMs = this.defaultRequestTimeoutMs,
      ) => this.requestOwned(writer, method, params, timeoutMs, consume),
      notify: (method: string, params?: unknown) => this.notifyOwned(writer, method, params),
      respond: (id: JsonRpcId, result: unknown, onActualWrite?: (write: Promise<void>) => void) =>
        this.respondOwned(writer, id, result, onActualWrite),
      respondError: (id: JsonRpcId, error: { code: number; message: string; data?: unknown }) =>
        this.respondErrorOwned(writer, id, error),
    });
  }

  request<T>(
    method: string,
    params?: unknown,
    timeoutMs = this.defaultRequestTimeoutMs,
    consume?: (value: T, work: NativeOutputWork | null) => T | Promise<T>,
  ): Promise<T> {
    return this.requestOwned(undefined, method, params, timeoutMs, consume);
  }

  private async requestOwned<T>(
    writer: ChildTurnWriter | undefined,
    method: string,
    params?: unknown,
    timeoutMs = this.defaultRequestTimeoutMs,
    consume?: (value: T, work: NativeOutputWork | null) => T | Promise<T>,
  ): Promise<T> {
    if (this.closed) throw new Error("Harness process is not running");
    const id = this.nextId++;
    const key = String(id);
    let timedOut = false;
    let rejectWrite: ((error: Error) => void) | undefined;
    let responseTimer: ReturnType<typeof setTimeout> | undefined;
    let lateTimer: ReturnType<typeof setTimeout> | undefined;
    let settleLate!: (value: DeliverySettlement) => void;
    const settlement = new Promise<DeliverySettlement>((resolve) => {
      settleLate = resolve;
    });
    // Register before writing. A local harness can answer quickly enough for
    // Tauri to deliver its stdout event before harness_write resolves; adding
    // the pending entry after send() silently discarded that response.
    const response = new Promise<T>((resolve, reject) => {
      rejectWrite = reject;
      const timer = (responseTimer =
        timeoutMs > 0
          ? setTimeout(() => {
              const message = `${this.label} ${method} response timed out after ${timeoutMs} ms (session ${this.sessionId})`;
              if (method === "turn/steer") {
                timedOut = true;
                // Keep a bounded reconciliation window. Expiry remains unknown,
                // never permission to resend a request whose write may have landed.
                lateTimer = setTimeout(() => {
                  this.pending.delete(key);
                  settleLate("unknown");
                }, 5 * 60_000);
                reject(new DeliveryUnknownError(message, settlement));
              } else {
                this.pending.delete(key);
                reject(new Error(message));
              }
            }, timeoutMs)
          : undefined);
      this.pending.set(key, {
        resolve: (value) => {
          if (timer) clearTimeout(timer);
          if (lateTimer) clearTimeout(lateTimer);
          if (timedOut) {
            settleLate("accepted");
            return;
          }
          if (!consume) {
            // A bare await has no automatic asynchronous renderer scope.
            captureNativeOutputWork()?.fail("rpc-response-consumer-untracked");
            resolve(value as T);
            return;
          }
          const work = captureNativeOutputWork();
          try {
            const actual = Promise.resolve().then(
              nativeOutputSink(work, () => consume(value as T, work)),
            );
            void trackNativeOutputWork(actual, work).then(resolve, reject);
          } catch (error) {
            work?.fail("rpc-response-consumer-failed");
            reject(error);
          }
        },
        reject: (error) => {
          if (timer) clearTimeout(timer);
          if (lateTimer) clearTimeout(lateTimer);
          if (timedOut) {
            settleLate(error instanceof JsonRpcResponseError ? "rejected" : "unknown");
            return;
          }
          if (method === "turn/steer" && !(error instanceof JsonRpcResponseError)) {
            // Process exit/Stop can race with an already accepted write. Losing
            // the transport is not proof that this mutation never arrived.
            settleLate("unknown");
            reject(new DeliveryUnknownError(error.message, settlement));
            return;
          }
          reject(error);
        },
      });
    });
    // The deadline may settle `response` while we are still suspended in
    // send() below; mark it handled so that window can't surface as an
    // unhandled rejection. The promise returned to the caller still settles.
    response.catch(() => undefined);
    // A response proves delivery even if the desktop IPC write acknowledgement
    // is delayed. Cancellation and response deadlines must also settle promptly.
    void this.send(
      {
        ...(this.includeJsonrpc ? { jsonrpc: "2.0" } : {}),
        id,
        method,
        ...(params !== undefined ? { params } : {}),
      },
      method,
      undefined,
      writer,
    ).catch((error: unknown) => {
      const pending = this.pending.get(key);
      if (pending) {
        const failure = error instanceof Error ? error : new Error(String(error));
        if (method === "turn/steer") {
          // A failed IPC write acknowledgement cannot prove the child did not receive it.
          timedOut = true;
          if (responseTimer) clearTimeout(responseTimer);
          lateTimer ??= setTimeout(() => {
            this.pending.delete(key);
            settleLate("unknown");
          }, 5 * 60_000);
          // The pending reject now belongs to the late settlement; reject the
          // caller through its original response promise below instead.
          rejectWrite?.(new DeliveryUnknownError(failure.message, settlement));
        } else {
          this.pending.delete(key);
          pending.reject(failure);
        }
      }
    });
    return response;
  }

  /** Invoke the real response consumer before leaving the original frame's
   * synchronous scope. The work owns its actual promise, not just its waiter. */
  requestWithNativeOutput<T>(
    method: string,
    params: unknown,
    consume: (value: T, work: NativeOutputWork | null) => T | Promise<T>,
    timeoutMs = this.defaultRequestTimeoutMs,
  ): Promise<T> {
    return this.request(method, params, timeoutMs, consume);
  }

  notify(method: string, params?: unknown): Promise<void> {
    return this.notifyOwned(undefined, method, params);
  }

  private async notifyOwned(
    writer: ChildTurnWriter | undefined,
    method: string,
    params?: unknown,
  ): Promise<void> {
    if (this.closed) return;
    await this.send(
      {
        ...(this.includeJsonrpc ? { jsonrpc: "2.0" } : {}),
        method,
        ...(params !== undefined ? { params } : {}),
      },
      method,
      undefined,
      writer,
    );
  }

  respond(
    id: JsonRpcId,
    result: unknown,
    onActualWrite?: (write: Promise<void>) => void,
  ): Promise<void> {
    return this.respondOwned(undefined, id, result, onActualWrite);
  }

  private async respondOwned(
    writer: ChildTurnWriter | undefined,
    id: JsonRpcId,
    result: unknown,
    onActualWrite?: (write: Promise<void>) => void,
  ): Promise<void> {
    const method = this.serverRequests.get(String(id)) ?? `request ${id}`;
    this.serverRequests.delete(String(id));
    await this.send(
      {
        ...(this.includeJsonrpc ? { jsonrpc: "2.0" } : {}),
        id,
        result,
      },
      `reply to ${method}`,
      onActualWrite,
      writer,
    );
  }

  respondError(
    id: JsonRpcId,
    error: { code: number; message: string; data?: unknown },
  ): Promise<void> {
    return this.respondErrorOwned(undefined, id, error);
  }

  private async respondErrorOwned(
    writer: ChildTurnWriter | undefined,
    id: JsonRpcId,
    error: { code: number; message: string; data?: unknown },
  ): Promise<void> {
    const method = this.serverRequests.get(String(id)) ?? `request ${id}`;
    this.serverRequests.delete(String(id));
    await this.send(
      {
        ...(this.includeJsonrpc ? { jsonrpc: "2.0" } : {}),
        id,
        error,
      },
      `reply to ${method}`,
      undefined,
      writer,
    );
  }

  private async send(
    payload: object,
    operation: string,
    onActualWrite?: (write: Promise<void>) => void,
    writer?: ChildTurnWriter,
  ): Promise<void> {
    if (this.closed) throw new Error("Harness process is not running");
    // Bound this caller's wait. The accepted harness_write can outlive it while
    // the backend still owns an actual stdin callback or process retirement.
    // Cancellation waiting on session/cancel notify must still have a deadline.
    const line = JSON.stringify(payload);
    // The caller's response/write waiter can time out first. The actual IPC
    // promise remains charged until its own settlement.
    const writeWork = captureNativeOutputWork();
    let actualWrite: Promise<void>;
    try {
      actualWrite = trackNativeOutputWork(writeChild(writer ?? this.child, line), writeWork);
    } catch (error) {
      writeWork?.fail("rpc-write-rejected");
      throw error;
    }
    // Source owners retain the actual write independently of this bounded waiter.
    // Its settlement is not provider consumption or process-route attestation.
    onActualWrite?.(actualWrite);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        actualWrite,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `${this.label} ${operation} write timed out after ${WRITE_TIMEOUT_MS} ms (session ${this.sessionId}, ${new TextEncoder().encode(line).length} bytes)`,
                ),
              ),
            WRITE_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      if (
        /timed out/.test(failure.message) &&
        !failure.message.startsWith(`${this.label} ${operation}`)
      )
        throw new Error(`${this.label} ${operation}: ${failure.message}`);
      throw failure;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private handle(msg: JsonRpcMessage) {
    if (msg.id != null && (msg.result !== undefined || msg.error)) {
      const key = String(msg.id);
      const pending = this.pending.get(key);
      if (!pending) {
        captureNativeOutputWork()?.fail("rpc-response-unmatched");
        console.warn(`[bycoda] ${this.label} unmatched JSON-RPC response`, {
          id: msg.id,
        });
        return;
      }
      this.pending.delete(key);
      if (msg.error) {
        captureNativeOutputWork()?.fail("rpc-response-error");
        pending.reject(
          new JsonRpcResponseError(
            msg.error.message || `${this.label} error ${msg.error.code ?? ""}`,
            msg.error.code,
          ),
        );
        return;
      }
      pending.resolve(msg.result);
      return;
    }

    if (msg.method && msg.id != null) {
      this.serverRequests.set(String(msg.id), msg.method);
      const work = captureNativeOutputWork();
      try {
        const actual = this.handlers.onRequest?.(
          msg.id,
          msg.method,
          msg.params,
          ...(work ? ([work] as const) : []),
        );
        void trackNativeOutputWork(Promise.resolve(actual), work).catch(() =>
          console.warn(`[bycoda] ${this.label} server request handler failed`),
        );
      } catch {
        work?.fail("rpc-request-handler-failed");
        console.warn(`[bycoda] ${this.label} server request handler failed`);
      }
      return;
    }

    if (msg.method) {
      const work = captureNativeOutputWork();
      try {
        const actual = this.handlers.onNotification?.(
          msg.method,
          msg.params,
          ...(work ? ([work] as const) : []),
        );
        if (actual)
          void trackNativeOutputWork(Promise.resolve(actual), work).catch(() =>
            console.warn(`[bycoda] ${this.label} notification handler failed`),
          );
        else work?.finish();
      } catch (error) {
        work?.fail("rpc-notification-handler-failed");
        throw error;
      }
    } else if (msg.id != null) {
      console.warn(`[bycoda] ${this.label} malformed JSON-RPC response`, {
        id: msg.id,
      });
    }
  }
}
