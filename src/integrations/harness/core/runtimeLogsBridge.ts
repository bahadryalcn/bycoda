import { httpMcpArgs, mcpMetadata, type McpBridge } from "./mcpTransport";
import { invokeProviderCommand } from "./child";
import type { ConfigurableBinaryProvider } from "../../../features/providers/model/providerBinaryPaths";

export type RuntimeLogsBridge = McpBridge;
const cache = new Map<string, RuntimeLogsBridge>();

/** Renderer metadata has no token. Native/headless spawn supplies the grant. */
export async function runtimeLogsBridge(sessionId: string): Promise<RuntimeLogsBridge | null> {
  const primary = sessionId.replace(/#\d+$/, "");
  if (cache.has(primary)) return cache.get(primary)!;
  try {
    const bridge = await invokeProviderCommand<RuntimeLogsBridge | null>(
      "harness_runtime_logs_bridge",
      {
        sessionId: primary,
      },
    );
    if (
      bridge &&
      typeof bridge.command === "string" &&
      bridge.command.length > 0 &&
      Array.isArray(bridge.args) &&
      bridge.args.every((value) => typeof value === "string")
    ) {
      // Copy only executable metadata; never forward an accidental host credential.
      const metadata = mcpMetadata(bridge);
      cache.set(primary, metadata);
      return metadata;
    }
  } catch {
    /* An older or offline host must not prevent ordinary provider work. */
  }
  return null;
}

export function runtimeLogsAcpServers(bridge: RuntimeLogsBridge | null) {
  return bridge
    ? [
        {
          name: "bycoda-runtime-logs",
          command: bridge.command,
          args: [...bridge.args, "runtime-logs-mcp"],
          env: [],
        },
      ]
    : [];
}

export function runtimeLogsSpawnArgs(
  provider: ConfigurableBinaryProvider | undefined,
  args: string[],
  bridge: RuntimeLogsBridge | null,
): string[] {
  if (!bridge || args.includes("--strict-mcp-config") || args.includes("--max-turns")) return args;
  const http = httpMcpArgs(
    provider,
    args,
    bridge,
    "bycoda-runtime-logs",
    "BYCODA_RUNTIME_LOGS_TOKEN",
  );
  if (http) return http;
  const server = { command: bridge.command, args: [...bridge.args, "runtime-logs-mcp"] };
  if (provider === "claude" && args[0]?.startsWith("-")) {
    // Merge the app's existing Social Media MCP config, preserving other servers.
    const index = args.lastIndexOf("--mcp-config");
    if (index >= 0 && args[index + 1]) {
      try {
        const config = JSON.parse(args[index + 1]);
        if (config && typeof config === "object" && !Array.isArray(config)) {
          const next = [...args];
          next[index + 1] = JSON.stringify({
            ...config,
            mcpServers: { ...config.mcpServers, "bycoda-runtime-logs": server },
          });
          return next;
        }
      } catch {
        /* A user-owned file/config argument remains intact. */
      }
    }
    return [
      ...args,
      "--mcp-config",
      JSON.stringify({ mcpServers: { "bycoda-runtime-logs": server } }),
    ];
  }
  let commandIndex = 0;
  while (args[commandIndex] === "-c" && typeof args[commandIndex + 1] === "string")
    commandIndex += 2;
  if (provider === "codex" && args[commandIndex] === "app-server") {
    const quote = (value: string) => JSON.stringify(value);
    return [
      "-c",
      `mcp_servers.bycoda-runtime-logs.command=${quote(server.command)}`,
      "-c",
      `mcp_servers.bycoda-runtime-logs.args=[${server.args.map(quote).join(",")}]`,
      "-c",
      'mcp_servers.bycoda-runtime-logs.env_vars=["BYCODA_RUNTIME_LOGS_TOKEN","BYCODA_RUNTIME_LOGS_ENDPOINT","BYCODA_RUNTIME_LOGS_ENVIRONMENT"]',
      ...args,
    ];
  }
  return args;
}

/** Short capability line; the CLI prefix is stated once by harnessRuntimeHints. */
export function runtimeLogsCliHint(bridge: RuntimeLogsBridge | null): string {
  if (!bridge) return "";
  return "Runtime logs (MCP bycoda-runtime-logs, CLI group runtime-logs): read-only browser/server logs for this project via runtime_logs_sources and runtime_logs_read (CLI <read|sources>).";
}
