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

export function httpMcpArgs(
  provider: string | undefined,
  args: string[],
  bridge: McpBridge,
  name: string,
  tokenEnv: string,
): string[] | null {
  const url = mcpMetadata(bridge).mcpUrl;
  if (!url) return null;
  // J2 real-client proof: Claude Code 2.1.301 and Codex 0.162.1.
  // ACP transports and other providers remain on the stdio proxy until verified.
  if (provider === "claude" && args[0]?.startsWith("-")) {
    const server = { type: "http", url, headers: { Authorization: `Bearer \${${tokenEnv}}` } };
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
      ...args,
    ];
  return null;
}
