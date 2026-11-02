import { invoke } from "@tauri-apps/api/core";
import { parseClaudeMcpList, type McpConnection } from "./mcp";

export type McpServerRow = McpConnection & { status: string };

export type McpSettingsSnapshot = {
  servers: McpServerRow[];
  error: string;
  claudeError: string;
  /** Claude's health check is still running; Claude rows show their configured state. */
  claudeChecking?: boolean;
  /** Claude stopped before checking every server; unreached rows show their configured state. */
  claudePartial?: boolean;
};

type ClaudeMcpListResult = string | { output: string; timedOut: boolean };

const snapshots = new Map<string, McpSettingsSnapshot>();
export const MCP_LOCAL_ONLY_ERROR =
  "MCP server configuration is only available for projects on this computer.";
const requests = new Map<string, Promise<McpSettingsSnapshot>>();
const healthRequests = new Map<string, Promise<void>>();
const listeners = new Map<string, Set<(snapshot: McpSettingsSnapshot) => void>>();

export function getCachedMcpSettings(cwd: string) {
  return snapshots.get(cwd);
}

export function subscribeMcpSettings(
  cwd: string,
  listener: (snapshot: McpSettingsSnapshot) => void,
) {
  const subscribers = listeners.get(cwd) ?? new Set();
  subscribers.add(listener);
  listeners.set(cwd, subscribers);
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) listeners.delete(cwd);
  };
}

function publish(cwd: string, snapshot: McpSettingsSnapshot) {
  snapshots.set(cwd, snapshot);
  listeners.get(cwd)?.forEach((listener) => listener(snapshot));
}

/** Discovery is shared across settings and pickers; health never delays the list. */
export function loadMcpSettings(
  cwd: string,
  force = false,
  options: { claudeHealth?: boolean } = {},
) {
  if (cwd.startsWith("remote://")) {
    return Promise.resolve({ servers: [], error: MCP_LOCAL_ONLY_ERROR, claudeError: "" });
  }
  let request = requests.get(cwd);
  if (!request || force) {
    const discovery = fetchMcpSettings(cwd).then((snapshot) => {
      if (requests.get(cwd) === discovery) {
        healthRequests.delete(cwd);
        publish(cwd, snapshot);
      }
      return snapshot;
    });
    requests.set(cwd, discovery);
    request = discovery;
  }
  const discovery = request;
  return discovery.then((snapshot) => {
    if (options.claudeHealth !== false && !snapshot.error && requests.get(cwd) === discovery) {
      loadClaudeHealth(cwd, discovery);
    }
    return snapshots.get(cwd) ?? snapshot;
  });
}

async function fetchMcpSettings(cwd: string): Promise<McpSettingsSnapshot> {
  try {
    const configured = await invoke<McpConnection[]>("mcp_discover", { cwd });
    const servers = configured.map((server) => ({
      ...server,
      status: server.enabled === false ? "Disabled" : "Configured",
    }));
    return { servers, error: "", claudeError: "" };
  } catch (cause) {
    const previous = snapshots.get(cwd);
    return { servers: previous?.servers ?? [], error: String(cause), claudeError: previous?.claudeError ?? "" };
  }
}

function loadClaudeHealth(cwd: string, discovery: Promise<McpSettingsSnapshot>) {
  if (healthRequests.has(cwd)) return;
  const current = snapshots.get(cwd);
  if (current) publish(cwd, { ...current, claudeChecking: true });
  const request = invoke<ClaudeMcpListResult>("claude_mcp_list", { cwd })
    .then((result) => {
      if (requests.get(cwd) !== discovery) return;
      const { output, timedOut } =
        typeof result === "string" ? { output: result, timedOut: false } : result;
      const snapshot = snapshots.get(cwd)!;
      const health = new Map(
        parseClaudeMcpList(output).map((server) => [server.name, server.status]),
      );
      const servers: McpServerRow[] = snapshot.servers.map((server) => ({
        ...server,
        status:
          server.enabled === false
            ? "Disabled"
            : server.provider === "claude"
              ? (health.get(server.name) ?? "Configured")
              : server.status,
      }));
      // Claude can supply connections that are not stored in a local config file.
      for (const [name, status] of health) {
        if (servers.some((server) => server.provider === "claude" && server.name === name))
          continue;
        servers.push({
          provider: "claude",
          name,
          scope: "local",
          configPath: "",
          transport: "",
          status,
        });
      }
      publish(cwd, {
        ...snapshot,
        servers,
        claudeError: "",
        claudeChecking: false,
        claudePartial: timedOut,
      });
    })
    .catch((cause) => {
      if (requests.get(cwd) !== discovery) return;
      publish(cwd, {
        ...snapshots.get(cwd)!,
        claudeError: String(cause),
        claudeChecking: false,
        claudePartial: false,
      });
    });
  healthRequests.set(cwd, request);
}

export function clearMcpSettingsCache() {
  snapshots.clear();
  requests.clear();
  healthRequests.clear();
}
