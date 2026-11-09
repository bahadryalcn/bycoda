import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseTomlSubset } from "./toml";

export type InventoryProvider = "claude" | "codex" | "opencode";
export type InventorySourceLabel =
  | "claude"
  | "claude-plugin"
  | "claude-project"
  | "claude-account"
  | "codex"
  | "codex-project"
  | "codex-account"
  | "opencode";
export type RawDefinition = {
  /** Server key as the provider declares it; becomes the hub name unless it collides. */
  name: string;
  /** Name as the provider itself shows it, used to disable the inherited server. */
  alias: string;
  provider: InventoryProvider;
  source: InventorySourceLabel;
  kind: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
};
export type InventoryFiles = {
  claudeConfig: string;
  pluginsDir: string;
  codexConfig: string;
  opencodeConfig?: string;
};

const MAX_PLUGIN_FILES = 200;
const MAX_SYNCED_DEPTH = 4;

/** CLAUDE_CONFIG_DIR and CODEX_HOME relocate the same files the CLIs read. */
export function inventoryFiles(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): InventoryFiles {
  // Provider-account profiles are discovered separately; a host env var pointing into
  // them must not replace the user's own default files.
  const outsideAccounts = (value: string | undefined) =>
    value && !/[\\/]provider-accounts[\\/]/i.test(value) ? value.trim() : undefined;
  const claudeDir = outsideAccounts(env.CLAUDE_CONFIG_DIR);
  const codexHome = outsideAccounts(env.CODEX_HOME);
  const claudeRoot = claudeDir ? resolve(claudeDir) : undefined;
  return {
    claudeConfig: claudeRoot ? join(claudeRoot, ".claude.json") : join(home, ".claude.json"),
    pluginsDir: join(claudeRoot ?? join(home, ".claude"), "plugins"),
    codexConfig: join(codexHome ? resolve(codexHome) : join(home, ".codex"), "config.toml"),
    opencodeConfig: join(env.XDG_CONFIG_HOME || join(home, ".config"), "opencode", "opencode.json"),
  };
}

/** Expands `${VAR}` and `${VAR:-fallback}` from the host environment only. */
export function expandPlaceholders(
  value: string,
  vars: Record<string, string | undefined>,
): string {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g,
    (_match, name, fallback) => {
      const found = vars[name];
      return found !== undefined && found !== "" ? found : (fallback ?? "");
    },
  );
}

/** Project keys in ~/.claude.json use either slash style; Windows paths ignore case. */
export function sameProjectPath(a: string, b: string, platform = process.platform): boolean {
  const normalize = (value: string) => {
    const slashed = value.replace(/\\/g, "/").replace(/\/+$/, "");
    return platform === "win32" ? slashed.toLowerCase() : slashed;
  };
  return normalize(a) === normalize(b);
}

const readJson = async (path: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
};
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
const stringMap = (value: unknown): Record<string, string> | undefined =>
  isObject(value) && Object.values(value).every((item) => typeof item === "string")
    ? (value as Record<string, string>)
    : undefined;

/** Turns one provider-style server table into a definition. Placeholders in headers stay
 * literal so credentials are expanded by the harness at use time, never published here. */
function normalize(
  alias: string,
  provider: InventoryProvider,
  source: InventorySourceLabel,
  value: unknown,
  vars: Record<string, string | undefined>,
): RawDefinition | undefined {
  if (!isObject(value)) return undefined;
  const type = typeof value.type === "string" ? value.type : undefined;
  const expand = (text: string) => expandPlaceholders(text, vars);
  // Placeholder-only entries (plugin manifests ship `url: ""` for unconfigured connectors,
  // and a blank command cannot be spawned) are not servers; skip them instead of publishing
  // a definition the harness would have to reject.
  if (typeof value.command === "string" && value.command.trim() && (!type || type === "stdio")) {
    const args = strings(value.args) ?? [];
    const env = stringMap(value.env) ?? {};
    return {
      name: alias,
      alias,
      provider,
      source,
      kind: "stdio",
      command: expand(value.command),
      args: args.map(expand),
      env: Object.fromEntries(Object.entries(env).map(([k, v]) => [k, expand(v)])),
    };
  }
  if (
    typeof value.url === "string" &&
    /^https?:\/\/\S+$/i.test(expand(value.url)) &&
    (!type || type === "http" || type === "sse")
  ) {
    const headers = stringMap(value.headers) ?? stringMap(value.http_headers);
    return {
      name: alias,
      alias,
      provider,
      source,
      kind: "http",
      url: expand(value.url),
      ...(headers ? { headers } : {}),
    };
  }
  return undefined;
}

/** `mcpServers` object of a Claude config or project manifest. */
function claudeServers(
  mcpServers: unknown,
  vars: Record<string, string | undefined>,
  source: InventorySourceLabel,
): RawDefinition[] {
  if (!isObject(mcpServers)) return [];
  return Object.entries(mcpServers).flatMap(([name, value]) => {
    const def = normalize(name, "claude", source, value, vars);
    return def ? [def] : [];
  });
}

export async function readClaudeUserServers(
  file: string,
  vars: Record<string, string | undefined>,
  source: "claude" | "claude-account" = "claude",
): Promise<RawDefinition[]> {
  const root = await readJson(file);
  return isObject(root) ? claudeServers(root.mcpServers, vars, source) : [];
}

/** Servers Claude scopes to one project path inside ~/.claude.json. */
export async function readClaudeProjectServers(
  file: string,
  cwd: string,
  vars: Record<string, string | undefined>,
): Promise<RawDefinition[]> {
  const root = await readJson(file);
  if (!isObject(root) || !isObject(root.projects)) return [];
  const match = Object.keys(root.projects).find((key) => sameProjectPath(key, cwd));
  const project = match !== undefined ? root.projects[match] : undefined;
  return isObject(project) ? claudeServers(project.mcpServers, vars, "claude-project") : [];
}

/** `<cwd>/.mcp.json`, the project-scoped manifest Claude reads. */
export async function readProjectMcpJson(
  cwd: string,
  vars: Record<string, string | undefined>,
): Promise<RawDefinition[]> {
  const root = await readJson(join(cwd, ".mcp.json"));
  return isObject(root) ? claudeServers(root.mcpServers, vars, "claude-project") : [];
}

/** Installed plugins first, then any synced manifests (bounded depth and count). */
export async function discoverPluginManifests(
  pluginsDir: string,
): Promise<{ path: string; plugin: string; root: string }[]> {
  const found: { path: string; plugin: string; root: string }[] = [];
  const seen = new Set<string>();
  const installed = await readJson(join(pluginsDir, "installed_plugins.json"));
  const plugins = isObject(installed) && isObject(installed.plugins) ? installed.plugins : {};
  for (const [key, entries] of Object.entries(plugins)) {
    const list = Array.isArray(entries) ? entries : [entries];
    for (const entry of list) {
      if (!isObject(entry) || typeof entry.installPath !== "string") continue;
      const root = resolve(entry.installPath);
      const path = join(root, ".mcp.json");
      if (seen.has(path)) continue;
      seen.add(path);
      found.push({ path, plugin: key.split("@")[0], root });
    }
  }
  const walk = async (dir: string, depth: number, plugin: string): Promise<void> => {
    if (depth > MAX_SYNCED_DEPTH) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (found.length >= MAX_PLUGIN_FILES) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1, plugin);
      else if (entry.isFile() && entry.name === ".mcp.json" && !seen.has(full)) {
        seen.add(full);
        found.push({ path: full, plugin, root: dir });
      }
    }
  };
  await walk(join(pluginsDir, "synced"), 0, "synced");
  return found;
}

export async function readPluginServers(
  pluginsDir: string,
  vars: Record<string, string | undefined>,
): Promise<RawDefinition[]> {
  const out: RawDefinition[] = [];
  for (const manifest of await discoverPluginManifests(pluginsDir)) {
    const root = await readJson(manifest.path);
    if (!isObject(root)) continue;
    const servers = isObject(root.mcpServers) ? root.mcpServers : root;
    const pluginVars = { ...vars, CLAUDE_PLUGIN_ROOT: manifest.root };
    for (const [name, value] of Object.entries(servers)) {
      const def = normalize(
        `plugin:${manifest.plugin}:${name}`,
        "claude",
        "claude-plugin",
        value,
        pluginVars,
      );
      if (def) out.push({ ...def, name });
    }
  }
  return out;
}

/** Every `[mcp_servers.*]` table of a Codex config. Disabled entries are kept. */
async function codexTables(file: string): Promise<Record<string, unknown>> {
  try {
    const root = parseTomlSubset(await readFile(file, "utf8")) as Record<string, unknown>;
    return isObject(root.mcp_servers) ? root.mcp_servers : {};
  } catch {
    // Missing, unreadable or unsupported TOML: the inventory skips this source.
    return {};
  }
}

export async function readCodexServers(
  file: string,
  vars: Record<string, string | undefined>,
  source: "codex" | "codex-project" | "codex-account" = "codex",
): Promise<RawDefinition[]> {
  return Object.entries(await codexTables(file)).flatMap(([name, value]) => {
    if (!isObject(value) || value.enabled === false) return [];
    // The env var name is kept as a placeholder; the secret value is never read here.
    const bearer =
      typeof value.bearer_token_env_var === "string" ? value.bearer_token_env_var : undefined;
    const headers = stringMap(value.http_headers) ?? {};
    const withBearer = bearer
      ? { ...value, http_headers: { ...headers, Authorization: `Bearer \${${bearer}}` } }
      : value;
    const def = normalize(name, "codex", source, withBearer, vars);
    return def ? [def] : [];
  });
}

/** OpenCode accepts local command arrays and remote endpoints in its MCP table. */
export async function readOpencodeServers(
  file: string,
  vars: Record<string, string | undefined>,
): Promise<RawDefinition[]> {
  const root = await readJson(file);
  if (!isObject(root) || !isObject(root.mcp)) return [];
  const readTable = (table: Record<string, unknown>): RawDefinition[] =>
    Object.entries(table).flatMap(([name, value]) => {
      if (!isObject(value) || value.enabled === false) return [];
      if (name === "servers" && !value.type) return readTable(value);
      const command = strings(value.command);
      const adapted =
        value.type === "local" && command?.length
          ? {
              ...value,
              type: "stdio",
              command: command[0],
              args: command.slice(1),
              env: value.environment,
            }
          : value.type === "remote"
            ? { ...value, type: "http" }
            : value;
      const def = normalize(name, "opencode", "opencode", adapted, vars);
      return def ? [def] : [];
    });
  return readTable(root.mcp);
}

/** Table names of a Codex config, enabled or not. */
export async function readCodexTableNames(file: string): Promise<Set<string>> {
  return new Set(Object.keys(await codexTables(file)));
}

/** Project-scoped Codex config, if the project has one. */
export function codexProjectConfig(cwd: string): string {
  return join(cwd, ".codex", "config.toml");
}

/** Files whose metadata decides whether an inventory must be rebuilt. */
export async function inventorySourceFiles(
  files: InventoryFiles,
  cwd: string | undefined,
  accounts: AccountDirs,
): Promise<string[]> {
  const pluginDirs = [files.pluginsDir, ...accounts.claude.map((dir) => join(dir, "plugins"))];
  const manifests = (await Promise.all(pluginDirs.map(discoverPluginManifests))).flat();
  return [
    files.claudeConfig,
    files.codexConfig,
    ...(files.opencodeConfig ? [files.opencodeConfig] : []),
    ...accounts.claude.map((dir) => join(dir, ".claude.json")),
    ...accounts.codex.map((dir) => join(dir, "config.toml")),
    ...pluginDirs.map((dir) => join(dir, "installed_plugins.json")),
    ...manifests.map((manifest) => manifest.path),
    ...(cwd ? [join(cwd, ".mcp.json"), codexProjectConfig(cwd)] : []),
  ];
}

/** Provider-account profile directories (default account excluded). */
export type AccountDirs = { claude: string[]; codex: string[] };

export async function statSignature(paths: string[]): Promise<string> {
  const parts = await Promise.all(
    paths.map(async (path) => {
      try {
        const info = await stat(path);
        return `${path}\0${info.mtimeMs}\0${info.size}`;
      } catch {
        return `${path}\0missing`;
      }
    }),
  );
  return parts.join("\n");
}
