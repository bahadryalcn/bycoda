import { createStore } from "../../../shared/lib/store";
import { parseClaudeMcpList, type McpConnection, type McpLoadingState } from "./mcp";
import { invokeMcpConfig, type RemoteMcpConfigTarget } from "./mcpConfigTarget";

export type McpServerRow = McpConnection & {
  status: string;
  /** Provider-reported sign-in state; absent when the provider does not report one. */
  auth?: "signed_in" | "signed_out" | "none";
};

/** A configuration file that exists but could not be read; its servers are absent from the list. */
export type McpConfigWarning = {
  provider: string;
  scope: string;
  configPath: string;
  /** Parse or I/O reason from the native reader; never file content. */
  message: string;
};

type McpDiscoveryResult = {
  connections: McpConnection[];
  warnings?: McpConfigWarning[];
  nativeConfigAvailable?: boolean;
};

export type McpSettingsSnapshot = {
  servers: McpServerRow[];
  /** Files that could not be read: the list is incomplete, which is not the same as "no servers". */
  configWarnings?: McpConfigWarning[];
  error: string;
  claudeError: string;
  /** Claude's health check is still running; Claude rows show their configured state. */
  claudeChecking?: boolean;
  /** Claude stopped before checking every server; unreached rows show their configured state. */
  claudePartial?: boolean;
  nativeConfigAvailable?: boolean;
};

type ClaudeMcpListResult = string | { output: string; timedOut: boolean };
type CodexAuthStatus = { name: string; authStatus: string };

const CODEX_AUTH: Record<string, { status: string; auth: NonNullable<McpServerRow["auth"]> }> = {
  o_auth: { status: "Signed in", auth: "signed_in" },
  bearer_token: { status: "Signed in", auth: "signed_in" },
  not_logged_in: { status: "Needs authentication", auth: "signed_out" },
  unsupported: { status: "Configured", auth: "none" },
};

/** One line per unreadable file: its path and the native reason. */
export function describeMcpConfigWarnings(warnings: readonly McpConfigWarning[]): string {
  return warnings.map((warning) => `${warning.configPath}: ${warning.message}`).join("\n");
}

const snapshots = new Map<string, McpSettingsSnapshot>();
export const MCP_LOCAL_ONLY_ERROR =
  "MCP server configuration is only available for projects on this computer.";
const requests = new Map<string, Promise<McpSettingsSnapshot>>();
const healthRequests = new Map<string, Promise<void>>();
const codexRequests = new Map<string, Promise<void>>();
const listeners = new Map<string, ReturnType<typeof createStore<[McpSettingsSnapshot]>>>();

const settingsMachine = (remote?: RemoteMcpConfigTarget) =>
  remote ? ["remote", remote.machineId, remote.environmentId ?? null] : ["local"];
const settingsKey = (cwd: string, globalOnly: boolean, remote?: RemoteMcpConfigTarget) =>
  JSON.stringify([
    ...settingsMachine(remote),
    globalOnly,
    remote ? (remote.projectId ?? null) : cwd,
  ]);

/** Keep last-good rows. Global entries can be inherited by any project on this computer. */
export function invalidateMcpSettings(_cwd: string, remote?: RemoteMcpConfigTarget) {
  const prefix = `${JSON.stringify(settingsMachine(remote)).slice(0, -1)},`;
  for (const key of requests.keys()) {
    if (!key.startsWith(prefix)) continue;
    requests.delete(key);
    healthRequests.delete(key);
    codexRequests.delete(key);
  }
}

export function getCachedMcpSettings(
  cwd: string,
  globalOnly = false,
  remote?: RemoteMcpConfigTarget,
) {
  return snapshots.get(settingsKey(cwd, globalOnly, remote));
}

export function subscribeMcpSettings(
  cwd: string,
  listener: (snapshot: McpSettingsSnapshot) => void,
  globalOnly = false,
  remote?: RemoteMcpConfigTarget,
) {
  const key = settingsKey(cwd, globalOnly, remote);
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
  options: { claudeHealth?: boolean; globalOnly?: boolean; remote?: RemoteMcpConfigTarget } = {},
) {
  const { remote } = options;
  if (cwd.startsWith("remote://") && !remote) {
    return Promise.resolve<McpSettingsSnapshot>({
      servers: [],
      error: MCP_LOCAL_ONLY_ERROR,
      claudeError: "",
    });
  }
  const globalOnly = options.globalOnly === true;
  const key = settingsKey(cwd, globalOnly, remote);
  let request = requests.get(key);
  if (!request || force) {
    const discovery = fetchMcpSettings(cwd, key, globalOnly, remote, force).then((snapshot) => {
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
      if (!globalOnly && !remote && options.claudeHealth !== false)
        loadClaudeHealth(cwd, discovery, key);
      // Codex reads stored credentials without starting servers, so every open gets sign-in state.
      if (snapshot.servers.some((server) => server.provider === "codex"))
        loadCodexAuth(cwd, discovery, key, remote);
    }
    return snapshots.get(key) ?? snapshot;
  });
}

async function fetchMcpSettings(
  cwd: string,
  key: string,
  globalOnly: boolean,
  remote?: RemoteMcpConfigTarget,
  force = false,
): Promise<McpSettingsSnapshot> {
  try {
    const found = await invokeMcpConfig<McpConnection[] | McpDiscoveryResult>(
      "mcp_discover",
      globalOnly ? { cwd, globalOnly: true } : { cwd },
      remote,
      force,
    );
    // A bare connection list carries no warnings.
    const {
      connections,
      warnings = [],
      nativeConfigAvailable,
    } = Array.isArray(found) ? { connections: found } : found;
    const servers = connections
      .filter((server) => !globalOnly || server.scope === "user")
      .map((server) => ({
        ...server,
        status: server.enabled === false ? "Disabled" : "Configured",
      }));
    const configWarnings = warnings.filter((warning) => !globalOnly || warning.scope === "user");
    return {
      servers,
      ...(configWarnings.length ? { configWarnings } : {}),
      error: "",
      claudeError: "",
      nativeConfigAvailable,
    };
  } catch (cause) {
    const previous = snapshots.get(key);
    return {
      servers: (previous?.servers ?? []).map(({ auth: _auth, ...server }) => ({
        ...server,
        status: server.enabled === false ? "Disabled" : "Configured",
      })),
      // The last good read still describes these files; a failed refresh does not clear it.
      ...(previous?.configWarnings ? { configWarnings: previous.configWarnings } : {}),
      error: String(cause),
      claudeError: "",
      nativeConfigAvailable: previous?.nativeConfigAvailable,
    };
  }
}

function loadClaudeHealth(cwd: string, discovery: Promise<McpSettingsSnapshot>, key: string) {
  if (healthRequests.has(key)) return;
  const current = snapshots.get(key);
  if (current) publish(key, { ...current, claudeChecking: true });
  const request = invokeMcpConfig<ClaudeMcpListResult>("claude_mcp_list", { cwd })
    .then((result) => {
      if (requests.get(key) !== discovery) return;
      const { output, timedOut } =
        typeof result === "string" ? { output: result, timedOut: false } : result;
      const snapshot = snapshots.get(key)!;
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
      publish(key, {
        ...snapshot,
        servers,
        claudeError: "",
        claudeChecking: false,
        claudePartial: timedOut,
      });
    })
    .catch((cause) => {
      if (requests.get(key) !== discovery) return;
      const snapshot = snapshots.get(key)!;
      publish(key, {
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
  healthRequests.set(key, request);
}

/** Codex knows which of its servers hold OAuth credentials; other rows stay as configured. */
function loadCodexAuth(
  cwd: string,
  discovery: Promise<McpSettingsSnapshot>,
  key: string,
  remote?: RemoteMcpConfigTarget,
) {
  if (codexRequests.has(key)) return;
  const request = invokeMcpConfig<CodexAuthStatus[]>("codex_mcp_list", { cwd }, remote)
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

const loadingStates = new Map<string, McpLoadingState>();

/** Last-good loading policy per project, so reopening the section renders before the refetch. */
export const getCachedMcpLoading = (cwd: string) => loadingStates.get(cwd);
export const cacheMcpLoading = (cwd: string, state: McpLoadingState) =>
  void loadingStates.set(cwd, state);
