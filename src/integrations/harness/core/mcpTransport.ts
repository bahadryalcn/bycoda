/** Public metadata only. Scoped credentials are injected into the provider environment. */
export type McpBridge = { command: string; args: string[]; mcpUrl?: string };

export function mcpMetadata(bridge: McpBridge): McpBridge {
  const metadata: McpBridge = { command: bridge.command, args: [...bridge.args] };
  try {
    const url = new URL(bridge.mcpUrl ?? "");
    if (
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/mcp\/(conversation|runtime-logs|social)$/.test(url.pathname)
    )
      metadata.mcpUrl = url.href;
  } catch {
    /* Older hosts expose stdio metadata only. */
  }
  return metadata;
}

/** Hard per-call deadline bycoda sets for the bycoda-conversation MCP server where the
 * provider accepts one: Claude per-server `timeout` (ms) and Codex `tool_timeout_sec` (s).
 * Verified against Claude Code 2.1.319 (`timeout` schema: "Per-server tool-call timeout in
 * milliseconds") and the Codex 0.135.0 binary (`tool_timeout_sec` in the MCP server config). */
export const MCP_TOOL_TIMEOUT_SECONDS = 300;

export function httpMcpArgs(
  provider: string | undefined,
  args: string[],
  bridge: McpBridge,
  name: string,
  tokenEnv: string,
  toolTimeoutSeconds?: number,
): string[] | null {
  const url = mcpMetadata(bridge).mcpUrl;
  if (!url) return null;
  // J2 real-client proof: Claude Code 2.1.301 and Codex 0.162.1.
  // ACP transports and other providers remain on the stdio proxy until verified.
  if (provider === "claude" && args[0]?.startsWith("-")) {
    const server = {
      type: "http",
      url,
      headers: { Authorization: `Bearer \${${tokenEnv}}` },
      ...(toolTimeoutSeconds ? { timeout: toolTimeoutSeconds * 1000 } : {}),
    };
    const index = args.lastIndexOf("--mcp-config");
    if (index >= 0 && args[index + 1]) {
      try {
        const config = JSON.parse(args[index + 1]);
        if (config && typeof config === "object" && !Array.isArray(config)) {
          const next = [...args];
          next[index + 1] = JSON.stringify({
            ...config,
            mcpServers: { ...config.mcpServers, [name]: server },
          });
          return next;
        }
      } catch {
        /* Preserve user-owned file arguments. */
      }
    }
    return [...args, "--mcp-config", JSON.stringify({ mcpServers: { [name]: server } })];
  }
  let index = 0;
  while (args[index] === "-c" && typeof args[index + 1] === "string") index += 2;
  if (provider === "codex" && args[index] === "app-server")
    return [
      "-c",
      `mcp_servers.${name}.url=${JSON.stringify(url)}`,
      "-c",
      `mcp_servers.${name}.bearer_token_env_var=${JSON.stringify(tokenEnv)}`,
      ...(toolTimeoutSeconds
        ? ["-c", `mcp_servers.${name}.tool_timeout_sec=${toolTimeoutSeconds}`]
        : []),
      ...args,
    ];
  return null;
}

/** Shell-safe host CLI prefix for providers that were not offered the MCP server. */
export function mcpCliCommand(bridge: McpBridge): string {
  const windows = /^[A-Za-z]:[\\/]/.test(bridge.command);
  const quote = (value: string) =>
    windows ? `'${value.replace(/'/g, "''")}'` : `'${value.replace(/'/g, "'\\''")}'`;
  return `${windows ? "& " : ""}${[bridge.command, ...bridge.args].map(quote).join(" ")}`;
}
