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

const settingsKey = (cwd: string, globalOnly: boolean) =>
  globalOnly ? JSON.stringify(["global", cwd]) : cwd;

/** Keep last-good rows, but reread both views after a configuration change. */
export function invalidateMcpSettings(cwd: string) {
  for (const key of [settingsKey(cwd, false), settingsKey(cwd, true)]) {
    requests.delete(key);
    healthRequests.delete(key);
    codexRequests.delete(key);
  }
}

export function getCachedMcpSettings(cwd: string, globalOnly = false) {
  return snapshots.get(settingsKey(cwd, globalOnly));
}

export function subscribeMcpSettings(
  cwd: string,
  listener: (snapshot: McpSettingsSnapshot) => void,
  globalOnly = false,
) {
  const key = settingsKey(cwd, globalOnly);
  let subscribers = listeners.get(key);
  if (!subscribers) {
    subscribers = createStore<[McpSettingsSnapshot]>();
    listeners.set(key, subscribers);
  }
  const unsubscribe = subscribers.subscribe(listener);
  return () => {
    unsubscribe();
    if (subscribers.size === 0) listeners.delete(key);
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
  options: { claudeHealth?: boolean; globalOnly?: boolean } = {},
) {
  if (cwd.startsWith("remote://")) {
    return Promise.resolve({ servers: [], error: MCP_LOCAL_ONLY_ERROR, claudeError: "" });
  }
  const globalOnly = options.globalOnly === true;
  const key = settingsKey(cwd, globalOnly);
  let request = requests.get(key);
  if (!request || force) {
    const discovery = fetchMcpSettings(cwd, key, globalOnly).then((snapshot) => {
      if (requests.get(key) === discovery) {
        healthRequests.delete(key);
        codexRequests.delete(key);
        publish(key, snapshot);
      }
      return snapshot;
    });
    requests.set(key, discovery);
    request = discovery;
  }
  const discovery = request;
  return discovery.then((snapshot) => {
    if (!snapshot.error && requests.get(key) === discovery) {
      // Claude CLI health is project-scoped and cannot describe a global-only view.
      if (!globalOnly && options.claudeHealth !== false) loadClaudeHealth(cwd, discovery);
      // Codex reads stored credentials without starting servers, so every open gets sign-in state.
      if (snapshot.servers.some((server) => server.provider === "codex"))
        loadCodexAuth(cwd, discovery, key);
    }
    return snapshots.get(key) ?? snapshot;
  });
}

async function fetchMcpSettings(
  cwd: string,
  key: string,
  globalOnly: boolean,
): Promise<McpSettingsSnapshot> {
  try {
    const configured = await invoke<McpConnection[]>(
      "mcp_discover",
      globalOnly ? { cwd, globalOnly: true } : { cwd },
    );
    const servers = configured
      .filter((server) => !globalOnly || server.scope === "user")
      .map((server) => ({
        ...server,
        status: server.enabled === false ? "Disabled" : "Configured",
      }));
    return { servers, error: "", claudeError: "" };
  } catch (cause) {
    const previous = snapshots.get(key);
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
function loadCodexAuth(cwd: string, discovery: Promise<McpSettingsSnapshot>, key: string) {
  if (codexRequests.has(key)) return;
  const request = invoke<CodexAuthStatus[]>("codex_mcp_list", { cwd })
    .then((list) => {
      if (requests.get(key) !== discovery || !Array.isArray(list)) return;
      const auth = new Map(list.map((entry) => [entry.name, CODEX_AUTH[entry.authStatus]]));
      const snapshot = snapshots.get(key)!;
      publish(key, {
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
  codexRequests.set(key, request);
}

export function clearMcpSettingsCache() {
  snapshots.clear();
  requests.clear();
  healthRequests.clear();
  codexRequests.clear();
}
