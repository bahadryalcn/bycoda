import { writeChild } from "./child";

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
  onNotification?: (method: string, params: unknown) => void;
  onRequest?: (id: JsonRpcId, method: string, params: unknown) => void | Promise<void>;
};

export type JsonRpcClientOptions = {
  /** Include `"jsonrpc":"2.0"` on outbound messages. Default true (ACP). Codex omits it. */
  includeJsonrpc?: boolean;
  label?: string;
  defaultRequestTimeoutMs?: number;
};

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

  constructor(
    private readonly sessionId: string,
    private readonly handlers: JsonRpcHandlers,
    options: JsonRpcClientOptions = {},
  ) {
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
    this.serverRequests.clear();
    const err = error ?? new Error("Harness process exited");
    this.rejectPending(err);
  }

  /** Drop in-flight client requests so a cancelled turn can unwind. */
  rejectPending(error?: Error) {
    const err = error ?? new Error("cancelled");
    for (const [, pending] of this.pending) pending.reject(err);
    this.pending.clear();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  async request<T>(
    method: string,
    params?: unknown,
    timeoutMs = this.defaultRequestTimeoutMs,
  ): Promise<T> {
    if (this.closed) throw new Error("Harness process is not running");
    const id = this.nextId++;
    const key = String(id);
    // Register before writing. A local harness can answer quickly enough for
    // Tauri to deliver its stdout event before harness_write resolves; adding
    // the pending entry after send() silently discarded that response.
    const response = new Promise<T>((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(key);
              reject(
                new Error(
                  `${this.label} ${method} response timed out after ${timeoutMs} ms (session ${this.sessionId})`,
                ),
              );
            }, timeoutMs)
          : undefined;
      this.pending.set(key, {
        resolve: (value) => {
          if (timer) clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          if (timer) clearTimeout(timer);
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
    ).catch((error: unknown) => {
      const pending = this.pending.get(key);
      if (pending) {
        this.pending.delete(key);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    return response;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    if (this.closed) return;
    await this.send(
      {
        ...(this.includeJsonrpc ? { jsonrpc: "2.0" } : {}),
        method,
        ...(params !== undefined ? { params } : {}),
      },
      method,
    );
  }

  async respond(id: JsonRpcId, result: unknown): Promise<void> {
    const method = this.serverRequests.get(String(id)) ?? `request ${id}`;
    this.serverRequests.delete(String(id));
    await this.send(
      {
        ...(this.includeJsonrpc ? { jsonrpc: "2.0" } : {}),
        id,
        result,
      },
      `reply to ${method}`,
    );
  }

  async respondError(
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
    );
  }

  private async send(payload: object, operation: string): Promise<void> {
    if (this.closed) throw new Error("Harness process is not running");
    // Bound the write: a child that stops draining stdin must not let a
    // blocked harness_write outlive the request's own deadline (or wedge a
    // cancellation waiting on the session/cancel notify).
    const line = JSON.stringify(payload);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        writeChild(this.sessionId, line),
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
        console.warn(`[bycoda] ${this.label} unmatched JSON-RPC response`, {
          id: msg.id,
        });
        return;
      }
      this.pending.delete(key);
      if (msg.error) {
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
      try {
        void Promise.resolve(this.handlers.onRequest?.(msg.id, msg.method, msg.params)).catch(() =>
          console.warn(`[bycoda] ${this.label} server request handler failed`),
        );
      } catch {
        console.warn(`[bycoda] ${this.label} server request handler failed`);
      }
      return;
    }

    if (msg.method) {
      this.handlers.onNotification?.(msg.method, msg.params);
    } else if (msg.id != null) {
      console.warn(`[bycoda] ${this.label} malformed JSON-RPC response`, {
        id: msg.id,
      });
    }
  }
}
