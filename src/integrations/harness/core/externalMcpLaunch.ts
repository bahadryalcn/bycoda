/** Host "MCP hub" metadata: user MCP servers are exposed over HTTP by the Host, so a
 * Claude/Codex launch can stop spawning them locally. Absent or invalid metadata keeps
 * the previous launch exactly as it was (fail-closed to the old behavior). */
export type ExternalMcpServer = {
  name: string;
  /** The key Codex sees. Differs from `name` when ~/.codex/config.toml already defines that
   * name as stdio: Codex merges overrides, and command plus url fails to load. */
  codexName: string;
  url: string;
  kind: "stdio" | "http";
  /** A user HTTP server forwarded unchanged; it spawns no local process. */
  passthrough?: { url: string; headers?: Record<string, string> };
  mode: "shared" | "perSession";
  sources: string[];
};
export type ExternalMcp = {
  servers: ExternalMcpServer[];
  disable: { claude: string[]; codex: string[]; opencode?: string[] };
};

/** Scoped session token; passed by env reference only, never as an argv value. */
const HUB_TOKEN_ENV = "BYCODA_CONVERSATION_TOKEN";

/** OpenCode loads this inline document after global config; {env:VAR} resolves at runtime.
 * Verified with OpenCode v2.2.5 serve (mcp list may attach to another server). */
export function opencodeConfigContent(external: ExternalMcp): string | undefined {
  const mcp: Record<string, unknown> = {};
  for (const name of [
    ...(external.disable.opencode ?? []),
    ...external.servers.filter((s) => s.kind === "stdio").map((s) => s.name),
  ])
    mcp[name] = { type: "local", command: ["bycoda-hub-hosted"], enabled: false };
  for (const server of external.servers)
    mcp[server.name] = server.passthrough
      ? {
          type: "remote",
          url: server.passthrough.url,
          headers: server.passthrough.headers ?? {},
          enabled: true,
        }
      : {
          type: "remote",
          url: server.url,
          headers: { Authorization: `Bearer {env:${HUB_TOKEN_ENV}}` },
          enabled: true,
        };
  return Object.keys(mcp).length ? JSON.stringify({ mcp }) : undefined;
}
/** Env for an `opencode acp` child; empty when the bridge carries no hub metadata.
 * OpenCode reads its MCP table from its own config, so the hub reaches it through this
 * inline config document in the child environment rather than through launch args. */
export function opencodeLaunchEnv(
  external: ExternalMcp | undefined,
): Record<string, string> | undefined {
  const content = external ? opencodeConfigContent(external) : undefined;
  return content ? { OPENCODE_CONFIG_CONTENT: content } : undefined;
}
const MAX_SERVERS = 100;
const NAME = /^[A-Za-z0-9_-]{1,64}$/;
/** Our own servers are wired separately and must never be shadowed by hub entries. */
const RESERVED = new Set(["bycoda-conversation", "bycoda-social", "bycoda-runtime-logs"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;
const stringRecord = (value: unknown): Record<string, string> | undefined => {
  if (value === undefined) return {};
  if (!isRecord(value) || !Object.values(value).every((item) => typeof item === "string"))
    return undefined;
  return value as Record<string, string>;
};
const httpUrl = (value: unknown, protocols: string[]): string | undefined => {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
};
/** The hub is always a loopback HTTP listener, as for bycoda-conversation's mcpUrl. */
const hubUrl = (value: unknown): string | undefined => {
  const href = httpUrl(value, ["http:"]);
  if (!href) return undefined;
  const url = new URL(href);
  return url.hostname === "127.0.0.1" && !url.username && !url.password && !url.hash
    ? href
    : undefined;
};

function parseServer(value: unknown): ExternalMcpServer | undefined {
  if (!isRecord(value)) return undefined;
  const { name, kind, mode, sources, passthrough } = value;
  if (typeof name !== "string" || !NAME.test(name) || RESERVED.has(name)) return undefined;
  const codexName = value.codexName === undefined ? name : value.codexName;
  if (typeof codexName !== "string" || !NAME.test(codexName) || RESERVED.has(codexName))
    return undefined;
  if (kind !== "stdio" && kind !== "http") return undefined;
  if (mode !== "shared" && mode !== "perSession") return undefined;
  const list = strings(sources);
  if (!list) return undefined;
  if (passthrough !== undefined) {
    if (!isRecord(passthrough)) return undefined;
    const url = httpUrl(passthrough.url, ["http:", "https:"]);
    const headers = stringRecord(passthrough.headers);
    if (!url || !headers) return undefined;
    return { name, codexName, url, kind, mode, sources: list, passthrough: { url, headers } };
  }
  const url = hubUrl(value.url);
  return url ? { name, codexName, url, kind, mode, sources: list } : undefined;
}

/** Returns null when the metadata is missing or malformed in any way. */
export function parseExternalMcp(value: unknown): ExternalMcp | undefined {
  if (!isRecord(value) || !Array.isArray(value.servers) || !isRecord(value.disable))
    return undefined;
  const claude = strings(value.disable.claude);
  const codex = strings(value.disable.codex);
  const opencode = value.disable.opencode === undefined ? [] : strings(value.disable.opencode);
  if (!claude || !codex || !opencode || value.servers.length > MAX_SERVERS) return undefined;
  const servers: ExternalMcpServer[] = [];
  const names = new Set<string>();
  const codexNames = new Set<string>();
  for (const raw of value.servers) {
    const server = parseServer(raw);
    // A malformed passthrough entry (a user's unconfigured http connector) only loses itself;
    // a malformed hub entry still rejects the whole payload, since hub wiring changes launches.
    if (!server && isRecord(raw) && raw.passthrough !== undefined) continue;
    if (!server || names.has(server.name) || codexNames.has(server.codexName)) return undefined;
    names.add(server.name);
    codexNames.add(server.codexName);
    servers.push(server);
  }
  return { servers, disable: { claude, codex, opencode } };
}

/** The Host publishes hub URLs on its relay port; the desktop broker re-exposes only
 * `/mcp/ext/<name>` on its own port, reported as the bridge `mcpUrl`. Hub servers move to
 * that origin, passthrough URLs stay as published. Without a broker URL the published URL is kept. */
export function rebaseExternalMcp(external: ExternalMcp, mcpUrl: string | undefined): ExternalMcp {
  let origin: string | undefined;
  try {
    origin = mcpUrl ? new URL(mcpUrl).origin : undefined;
  } catch {
    origin = undefined;
  }
  if (!origin) return external;
  return {
    ...external,
    servers: external.servers.map((server) =>
      server.passthrough ? server : { ...server, url: `${origin}${new URL(server.url).pathname}` },
    ),
  };
}

/** Claude: every hub server is HTTP with the session token referenced from env. */
export function claudeExternalMcpServers(external: ExternalMcp): Record<string, unknown> {
  return Object.fromEntries(
    external.servers.map((server) => [
      server.name,
      server.passthrough
        ? {
            type: "http",
            url: server.passthrough.url,
            ...(Object.keys(server.passthrough.headers ?? {}).length
              ? { headers: server.passthrough.headers }
              : {}),
          }
        : {
            type: "http",
            url: server.url,
            headers: { Authorization: `Bearer \${${HUB_TOKEN_ENV}}` },
          },
    ]),
  );
}

const BARE_KEY = /^[A-Za-z0-9_-]+$/;

/** Codex `-c` keys split on every dot, even inside quotes, so only bare names can be
 * addressed per launch. Verified with codex-cli 0.167.0: `mcp_servers."a.b"` fails to
 * load. shortcut: dotted user server names stay enabled, upgrade if Codex accepts quoted keys. */
export function codexExternalMcpArgs(external: ExternalMcp): string[] {
  const args: string[] = [];
  const set = (value: string) => args.push("-c", value);
  for (const name of external.disable.codex)
    if (BARE_KEY.test(name)) set(`mcp_servers.${name}={enabled=false}`);
  for (const server of external.servers) {
    const base = `mcp_servers.${server.codexName}`;
    if (server.passthrough) {
      set(`${base}.url=${JSON.stringify(server.passthrough.url)}`);
      const headers = Object.entries(server.passthrough.headers ?? {});
      if (headers.length)
        set(
          `${base}.http_headers={${headers
            .map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`)
            .join(",")}}`,
        );
    } else {
      set(`${base}.url=${JSON.stringify(server.url)}`);
      set(`${base}.bearer_token_env_var=${JSON.stringify(HUB_TOKEN_ENV)}`);
    }
  }
  return args;
}

const parseRecord = (value: string | undefined) => {
  if (value === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

/** Applies hub wiring to an already-assembled launch. Claude interactive launches
 * switch to --strict-mcp-config so the user's global/project/plugin stdio servers
 * are not spawned; the user's other settings (hooks, permissions, plugins) still load
 * because --setting-sources is unchanged. */
export function withExternalMcpArgs(
  provider: string | undefined,
  args: string[],
  external: ExternalMcp,
): string[] {
  if (provider === "claude" && args[0]?.startsWith("-")) {
    const next = [...args];
    const index = next.lastIndexOf("--mcp-config");
    const parsed = index >= 0 ? parseRecord(next[index + 1]) : undefined;
    const config = JSON.stringify({
      ...parsed,
      mcpServers: {
        ...(parsed && isRecord(parsed.mcpServers) ? parsed.mcpServers : {}),
        ...claudeExternalMcpServers(external),
      },
    });
    if (parsed && index >= 0) {
      next[index + 1] = config;
      return [...next.slice(0, index), "--strict-mcp-config", ...next.slice(index)];
    }
    // A user-owned config file argument stays intact; the hub config is added beside it.
    return [...next, "--strict-mcp-config", "--mcp-config", config];
  }
  let index = 0;
  while (args[index] === "-c" && typeof args[index + 1] === "string") index += 2;
  if (provider === "codex" && args[index] === "app-server")
    return [...codexExternalMcpArgs(external), ...args];
  return args;
}
