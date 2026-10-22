import {
  JsonRpcClient,
  type JsonRpcHandlers,
  type JsonRpcId,
  type JsonRpcMessage,
} from "./jsonRpc";
import { socialAcpServers, socialBridge } from "./socialBridge";
import { runtimeLogsAcpServers, runtimeLogsBridge } from "./runtimeLogsBridge";
import { conversationToolsAcpServers, conversationToolsBridge } from "./conversationToolsBridge";

export type { JsonRpcMessage };

export type AcpHandlers = {
  onNotification?: (method: string, params: unknown) => void;
  onRequest?: (id: number, method: string, params: unknown) => void | Promise<void>;
};

/** ACP JSON-RPC client — thin wrapper preserving the Cursor numeric-id API. */
export class AcpClient {
  private readonly rpc: JsonRpcClient;

  constructor(
    private readonly sessionId: string,
    private readonly handlers: AcpHandlers,
  ) {
    const rpcHandlers: JsonRpcHandlers = {
      onNotification: (method, params) => this.handlers.onNotification?.(method, params),
      onRequest: (id, method, params) => {
        const numeric = typeof id === "number" ? id : Number(id);
        return this.handlers.onRequest?.(numeric, method, params);
      },
    };
    this.rpc = new JsonRpcClient(sessionId, rpcHandlers, {
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

  rejectPending(error?: Error) {
    this.rpc.rejectPending(error);
  }

  request<T>(method: string, params?: unknown, timeoutMs = 0): Promise<T> {
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
        return this.rpc.request<T>(
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
        );
      });
    }
    return this.rpc.request<T>(method, params, timeoutMs);
  }

  notify(method: string, params?: unknown): Promise<void> {
    return this.rpc.notify(method, params);
  }

  respond(id: number, result: unknown): Promise<void> {
    return this.rpc.respond(id as JsonRpcId, result);
  }

  respondError(
    id: number,
    error: { code: number; message: string; data?: unknown },
  ): Promise<void> {
    return this.rpc.respondError(id as JsonRpcId, error);
  }
}
