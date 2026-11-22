import { t } from "../../../shared/i18n";

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

export function scopeLabel(scope: McpConnection["scope"]): string {
  return scopeLabelWith(scope, t);
}

export function scopeLabelWith(
  scope: McpConnection["scope"],
  t: (message: string) => string,
): string {
  return scope === "user" ? t("Global") : scope === "project" ? t("Project") : t("Local project");
}

/** Configuration does not prove authentication; these CLIs own remote OAuth. */
export function canSignInMcp(connection: McpConnection): boolean {
  return (
    connection.enabled !== false &&
    ["claude", "codex", "cursor", "opencode"].includes(connection.provider) &&
    ["http", "sse", "streamable-http", "remote"].includes(connection.transport.toLowerCase())
  );
}

/** Claude prints `✓ Connected` on most terminals and `√ Connected` on Windows consoles. */
export function isMcpConnected(status: string): boolean {
  return /^(?:[✔✓√]\s*)?connected$/i.test(status.trim());
}

/** Sign in is offered unless the provider confirmed a connection or sign-in, or needs none. */
export function needsMcpSignIn(
  server: McpConnection & { status: string; auth?: "signed_in" | "signed_out" | "none" },
): boolean {
  return (
    canSignInMcp(server) &&
    server.auth !== "signed_in" &&
    server.auth !== "none" &&
    !isMcpConnected(server.status)
  );
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

/** Mirrors the Host loading policy file; `direct` names stay wired into every session on demand. */
export type McpLoadingPolicy = { version: 1; mode: "onDemand" | "always"; direct: string[] };

/** Result of `mcp.hub.loading.get/set`; `servers` are the hub-hosted names eligible for `direct`. */
export type McpLoadingState = {
  policy: McpLoadingPolicy;
  /** The stored file is invalid: loading stays on demand and saving is refused until repaired. */
  corrupt: boolean;
  servers: string[];
  /** Secret-free hub inventory; absent on older Hosts. */
  inventory?: McpHubServer[];
  managedServers?: boolean;
};

export type ManagedMcpIdentity = {
  name: string;
  scope: "user" | "project";
  revision: string;
  enabled: boolean;
};
export type ManagedMcpConfig =
  | { url: string; type?: "http" }
  | {
      command: string;
      args?: string[];
      type?: "stdio";
    };
export type ManagedMcpRequest =
  | { action: "get"; name: string }
  | { action: "add"; name: string; config: unknown }
  | { action: "update"; name: string; revision: string; config: unknown }
  | { action: "setEnabled"; name: string; revision: string; enabled: boolean }
  | { action: "remove"; name: string; revision: string };

export type McpHubServer = {
  name: string;
  kind: "stdio" | "http";
  source: string;
  sources: string[];
  aliases: { provider: "claude" | "codex" | "opencode"; name: string }[];
  signedIn: boolean;
  projectCredentialsConfigured?: boolean;
  credentialsConfigured?: boolean;
  managed?: ManagedMcpIdentity;
};

/** Adds or removes one name; the result is sorted and unique so repeated toggles stay stable. */
export function withDirectServer(
  policy: McpLoadingPolicy,
  name: string,
  direct: boolean,
): McpLoadingPolicy {
  const rest = policy.direct.filter((entry) => entry !== name);
  return { ...policy, direct: direct ? [...rest, name].sort() : rest };
}

/** Per HTTP server sign-in state from `mcp.oauth.status`; never carries a credential. */
export type McpOAuthState = "none" | "signed-in" | "expired" | "error";
export type McpOAuthServer = {
  name: string;
  state: McpOAuthState;
  error?: string;
  inherited?: boolean;
};
