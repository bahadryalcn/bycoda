import {
  JsonRpcClient,
  type JsonRpcHandlers,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcWriterView,
} from "./jsonRpc";
import { socialAcpServers, socialBridge } from "./socialBridge";
import { runtimeLogsAcpServers, runtimeLogsBridge } from "./runtimeLogsBridge";
import { conversationToolsAcpServers, conversationToolsBridge } from "./conversationToolsBridge";
import type { NativeOutputWork } from "./nativeOutputDelivery";
import type { ChildProcessHandle, ChildTurnWriter } from "./child";

export type { JsonRpcMessage };

export type AcpHandlers = {
  onNotification?: (
    method: string,
    params: unknown,
    work?: NativeOutputWork,
  ) => void | Promise<void>;
  onRequest?: (
    id: number,
    method: string,
    params: unknown,
    work?: NativeOutputWork,
  ) => void | Promise<void>;
};

export type AcpWriterView = Pick<
  AcpClient,
  "request" | "requestWithNativeOutput" | "notify" | "respond" | "respondError" | "isClosed"
>;

/** ACP JSON-RPC client — thin wrapper preserving the Cursor numeric-id API. */
export class AcpClient {
  private readonly rpc: JsonRpcClient;
  private readonly sessionId: string;

  constructor(
    child: ChildProcessHandle,
    private readonly handlers: AcpHandlers,
  ) {
    this.sessionId = child.sessionId;
    const rpcHandlers: JsonRpcHandlers = {
      onNotification: (method, params, work) =>
        this.handlers.onNotification?.(method, params, work),
      onRequest: (id, method, params, work) => {
        const numeric = typeof id === "number" ? id : Number(id);
        return this.handlers.onRequest?.(numeric, method, params, work);
      },
    };
    this.rpc = new JsonRpcClient(child, rpcHandlers, {
      includeJsonrpc: true,
      label: "acp",
    });
  }

  pushLine(line: string) {
    this.rpc.pushLine(line);
  }

  close(error?: Error) {
    this.rpc.close(error);
  }

  rejectPending(error?: Error, options?: { keepNativeOutput?: boolean }) {
    this.rpc.rejectPending(error, options);
  }

  get isClosed(): boolean {
    return this.rpc.isClosed;
  }

  assertProcess(handle: ChildProcessHandle): void {
    this.rpc.assertProcess(handle);
  }

  withWriter(writer: ChildTurnWriter): AcpWriterView {
    // This exact view is captured before any bridge Promise is scheduled.
    const rpc = this.rpc.withWriter(writer);
    return Object.freeze({
      get isClosed() {
        return rpc.isClosed;
      },
      request: <T>(
        method: string,
        params?: unknown,
        timeoutMs = 0,
        consume?: (value: T, work: NativeOutputWork | null) => T | Promise<T>,
      ) => this.requestOwned(rpc, method, params, timeoutMs, consume),
      requestWithNativeOutput: <T>(
        method: string,
        params: unknown,
        consume: (value: T, work: NativeOutputWork | null) => T | Promise<T>,
        timeoutMs = 0,
      ) => this.requestOwned(rpc, method, params, timeoutMs, consume),
      notify: (method: string, params?: unknown) => rpc.notify(method, params),
      respond: (id: number, result: unknown, onActualWrite?: (write: Promise<void>) => void) =>
        rpc.respond(id, result, onActualWrite),
      respondError: (id: number, error: { code: number; message: string; data?: unknown }) =>
        rpc.respondError(id, error),
    });
  }

  request<T>(
    method: string,
    params?: unknown,
    timeoutMs = 0,
    consume?: (value: T, work: NativeOutputWork | null) => T | Promise<T>,
  ): Promise<T> {
    return this.requestOwned(this.rpc, method, params, timeoutMs, consume);
  }

  private requestOwned<T>(
    rpc: JsonRpcClient | JsonRpcWriterView,
    method: string,
    params?: unknown,
    timeoutMs = 0,
    consume?: (value: T, work: NativeOutputWork | null) => T | Promise<T>,
  ): Promise<T> {
    if (
      ["session/new", "session/load", "session/resume", "session/fork"].includes(method) &&
      params &&
      typeof params === "object" &&
      "mcpServers" in params
    ) {
      const sessionId = this.sessionId.replace(/#\d+$/, "");
      return Promise.all([
        socialBridge(sessionId),
        runtimeLogsBridge(sessionId),
        conversationToolsBridge(sessionId),
      ]).then(([bridge, logs, conversation]) => {
        const value = params as Record<string, unknown>;
        const servers = Array.isArray(value.mcpServers) ? value.mcpServers : [];
        return rpc.request<T>(
          method,
          {
            ...value,
            mcpServers: [
              ...servers.filter(
                (server) =>
                  !(bridge && server?.name === "bycoda-social") &&
                  !(logs && server?.name === "bycoda-runtime-logs") &&
                  !(conversation && server?.name === "bycoda-conversation"),
              ),
              ...socialAcpServers(bridge),
              ...runtimeLogsAcpServers(logs),
              ...conversationToolsAcpServers(conversation),
            ],
          },
          timeoutMs,
          ...(consume ? ([consume] as const) : []),
        );
      });
    }
    return rpc.request<T>(method, params, timeoutMs, ...(consume ? ([consume] as const) : []));
  }

  requestWithNativeOutput<T>(
    method: string,
    params: unknown,
    consume: (value: T, work: NativeOutputWork | null) => T | Promise<T>,
    timeoutMs = 0,
  ): Promise<T> {
    return this.request(method, params, timeoutMs, consume);
  }

  notify(method: string, params?: unknown): Promise<void> {
    return this.rpc.notify(method, params);
  }

  respond(
    id: number,
    result: unknown,
    onActualWrite?: (write: Promise<void>) => void,
  ): Promise<void> {
    return this.rpc.respond(id as JsonRpcId, result, onActualWrite);
  }

  respondError(
    id: number,
    error: { code: number; message: string; data?: unknown },
  ): Promise<void> {
    return this.rpc.respondError(id as JsonRpcId, error);
  }
}
