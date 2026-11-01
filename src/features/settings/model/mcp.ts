export type McpServer = { name: string; status: string };

export type McpConnection = {
  provider: "claude" | "claude_desktop" | "codex" | "cursor" | "opencode";
  name: string;
  scope: "local" | "project" | "user";
  configPath: string;
  transport: string;
  enabled?: boolean;
};

export const MCP_PROVIDER_LABELS: Record<McpConnection["provider"], string> = {
  claude: "Claude Code",
  claude_desktop: "Claude Desktop",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
};

/** Configuration does not prove authentication; these CLIs own remote OAuth. */
export function canSignInMcp(connection: McpConnection): boolean {
  return connection.enabled !== false &&
    ["claude", "codex", "cursor", "opencode"].includes(connection.provider) &&
    ["http", "sse", "streamable-http", "remote"].includes(connection.transport.toLowerCase());
}

export function isMcpConnected(status: string): boolean {
  return /^(?:[✔✓]\s*)?connected$/i.test(status.trim());
}

/** Claude's list output is for humans; keep only names and health text. */
export function parseClaudeMcpList(output: string): McpServer[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Za-z0-9_-]+):\s+(.+)$/);
    if (!match) return [];
    const detail = match[2];
    const parts = detail.split(/ - | — /);
    const status = parts[parts.length - 1];
    return [{ name: match[1], status }];
  });
}
