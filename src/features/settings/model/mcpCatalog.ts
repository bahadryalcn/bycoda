import type { McpHubServer, McpLoadingState, McpOAuthServer, McpOAuthState } from "./mcp";
import type { McpServerRow } from "./mcpSettingsCache";

/** What the Host knows about one server: it serves it to sessions and may hold its sign-in. */
export type McpHubEntry = {
  /** Hub name used by `mcp.hub.loading.*` and `mcp.oauth.*`; may carry a collision suffix. */
  name: string;
  kind: McpHubServer["kind"];
  /** Where the Host found it, e.g. `claude`, `claude-plugin`, `codex-account`. */
  sources: string[];
  /** Http servers only: Host-held sign-in state; absent until `mcp.oauth.status` answers. */
  oauth?: McpOAuthState;
  /** The name is listed in the loading policy's `direct` list. */
  direct: boolean;
  /** The Host may start it with every session (stdio, or a signed-in http server). */
  directEligible: boolean;
};

/** One server as the owner thinks of it: one name, every provider file that declares it and its Host state. */
export type McpCatalogEntry = {
  name: string;
  /** Provider configuration entries, in discovery order. Empty for plugin- or account-only servers. */
  configs: McpServerRow[];
  hub?: McpHubEntry;
};

/**
 * Groups provider configuration rows by server name and attaches the Host inventory entry
 * whose provider alias matches. Host-only servers (Claude plugins, provider accounts) become
 * entries without configs, so every server the sessions can see is listed once.
 */
export function buildMcpCatalog(
  servers: McpServerRow[],
  loading: McpLoadingState | undefined,
  oauth: McpOAuthServer[] | undefined,
): McpCatalogEntry[] {
  const entries = new Map<string, McpCatalogEntry>();
  for (const server of servers) {
    const entry = entries.get(server.name);
    if (entry) entry.configs.push(server);
    else entries.set(server.name, { name: server.name, configs: [server] });
  }
  const oauthState = new Map(oauth?.map((server) => [server.name, server.state]));
  const direct = new Set(loading?.policy.direct);
  const eligible = new Set(loading?.servers);
  for (const hub of loading?.inventory ?? []) {
    const hubEntry: McpHubEntry = {
      name: hub.name,
      kind: hub.kind,
      sources: hub.sources,
      ...(hub.kind === "http"
        ? { oauth: oauthState.get(hub.name) ?? (hub.signedIn ? "signed-in" : undefined) }
        : {}),
      direct: direct.has(hub.name),
      directEligible: eligible.has(hub.name),
    };
    // A provider row matches when the Host names it under that provider's alias.
    const match = [...entries.values()].find(
      (entry) =>
        !entry.hub &&
        entry.configs.some((config) =>
          hub.aliases.some(
            (alias) => alias.provider === config.provider && alias.name === config.name,
          ),
        ),
    );
    if (match) {
      match.hub = hubEntry;
      continue;
    }
    const name = hub.aliases[0]?.name ?? hub.name;
    const key = entries.has(name) ? hub.name : name;
    entries.set(key, { name: key, configs: [], hub: hubEntry });
  }
  return [...entries.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

export type McpEntryStatus = "off" | "sign-in" | "expired" | "ready" | "configured";

/**
 * One summary state per server. Sign-in is only asked when nothing already proves access:
 * a Host sign-in or a provider-confirmed connection both count.
 */
export function mcpEntryStatus(
  entry: McpCatalogEntry,
  isConnected: (row: McpServerRow) => boolean,
  needsSignIn: (row: McpServerRow) => boolean,
): McpEntryStatus {
  const configs = entry.configs;
  if (configs.length > 0 && configs.every((config) => config.enabled === false)) return "off";
  const live = configs.filter((config) => config.enabled !== false);
  const oauth = entry.hub?.oauth;
  if (
    oauth === "signed-in" ||
    live.some((config) => config.auth === "signed_in" || isConnected(config))
  )
    return "ready";
  if (oauth === "expired") return "expired";
  if (oauth === "none" || oauth === "error" || live.some(needsSignIn)) return "sign-in";
  return "configured";
}

/** Search text for one entry: name, providers, sources, transports and file paths. */
export function mcpEntrySearchText(entry: McpCatalogEntry, labels: (row: McpServerRow) => string) {
  return [
    entry.name,
    entry.hub?.name ?? "",
    ...(entry.hub?.sources ?? []),
    ...entry.configs.flatMap((config) => [labels(config), config.transport, config.configPath]),
  ]
    .join(" ")
    .toLocaleLowerCase();
}
