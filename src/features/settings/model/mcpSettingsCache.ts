import { invoke } from "@tauri-apps/api/core";
import { createStore } from "../../../shared/lib/store";
import { parseClaudeMcpList, type McpConnection } from "./mcp";

export type McpServerRow = McpConnection & {
  status: string;
  /** Provider-reported sign-in state; absent when the provider does not report one. */
  auth?: "signed_in" | "signed_out" | "none";
};

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
type CodexAuthStatus = { name: string; authStatus: string };

const CODEX_AUTH: Record<string, { status: string; auth: NonNullable<McpServerRow["auth"]> }> = {
  o_auth: { status: "Signed in", auth: "signed_in" },
  bearer_token: { status: "Signed in", auth: "signed_in" },
  not_logged_in: { status: "Needs authentication", auth: "signed_out" },
  unsupported: { status: "Configured", auth: "none" },
};

const snapshots = new Map<string, McpSettingsSnapshot>();
export const MCP_LOCAL_ONLY_ERROR =
  "MCP server configuration is only available for projects on this computer.";
const requests = new Map<string, Promise<McpSettingsSnapshot>>();
const healthRequests = new Map<string, Promise<void>>();
const codexRequests = new Map<string, Promise<void>>();
const listeners = new Map<string, ReturnType<typeof createStore<[McpSettingsSnapshot]>>>();

export function getCachedMcpSettings(cwd: string) {
  return snapshots.get(cwd);
}

export function subscribeMcpSettings(
  cwd: string,
  listener: (snapshot: McpSettingsSnapshot) => void,
) {
  let subscribers = listeners.get(cwd);
  if (!subscribers) {
    subscribers = createStore<[McpSettingsSnapshot]>();
    listeners.set(cwd, subscribers);
  }
  const unsubscribe = subscribers.subscribe(listener);
  return () => {
    unsubscribe();
    if (subscribers.size === 0) listeners.delete(cwd);
  };
}

function publish(cwd: string, snapshot: McpSettingsSnapshot) {
  snapshots.set(cwd, snapshot);
  listeners.get(cwd)?.notify(snapshot);
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
        codexRequests.delete(cwd);
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
      if (snapshot.servers.some((server) => server.provider === "codex"))
        loadCodexAuth(cwd, discovery);
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
    return {
      servers: (previous?.servers ?? []).map(({ auth: _auth, ...server }) => ({
        ...server,
        status: server.enabled === false ? "Disabled" : "Configured",
      })),
      error: String(cause),
      claudeError: "",
    };
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
      const snapshot = snapshots.get(cwd)!;
      publish(cwd, {
        ...snapshot,
        servers: snapshot.servers.map((server) =>
          server.provider === "claude"
            ? { ...server, status: server.enabled === false ? "Disabled" : "Configured" }
            : server,
        ),
        claudeError: String(cause),
        claudeChecking: false,
        claudePartial: false,
      });
    });
  healthRequests.set(cwd, request);
}

/** Codex knows which of its servers hold OAuth credentials; other rows stay as configured. */
function loadCodexAuth(cwd: string, discovery: Promise<McpSettingsSnapshot>) {
  if (codexRequests.has(cwd)) return;
  const request = invoke<CodexAuthStatus[]>("codex_mcp_list", { cwd })
    .then((list) => {
      if (requests.get(cwd) !== discovery || !Array.isArray(list)) return;
      const auth = new Map(list.map((entry) => [entry.name, CODEX_AUTH[entry.authStatus]]));
      const snapshot = snapshots.get(cwd)!;
      publish(cwd, {
        ...snapshot,
        servers: snapshot.servers.map((server) => {
          const known =
            server.provider === "codex" && server.enabled !== false
              ? auth.get(server.name)
              : undefined;
          return known ? { ...server, ...known } : server;
        }),
      });
    })
    // Without Codex status the rows keep their configured state and Sign in stays available.
    .catch(() => undefined);
  codexRequests.set(cwd, request);
}

export function clearMcpSettingsCache() {
  snapshots.clear();
  requests.clear();
  healthRequests.clear();
  codexRequests.clear();
}
