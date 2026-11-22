import {
  codexProjectConfig,
  inventoryFiles,
  inventorySourceFiles,
  opencodeProjectConfigs,
  readClaudeProjectServers,
  readClaudeUserServers,
  readCodexServers,
  readCodexTableNames,
  readOpencodeServers,
  readPluginServers,
  readProjectMcpJson,
  statSignature,
  type AccountDirs,
  type InventoryFiles,
  type InventorySourceLabel,
  type RawDefinition,
} from "./inventory-sources";
import { discoverAccountDirs } from "./accounts";
import { join } from "node:path";

export type InventoryDefinition = {
  /** Name the hub serves under `/mcp/ext/<name>`; unique within one inventory. */
  name: string;
  source: InventorySourceLabel;
  /** Every provider or source that declared this exact launch or endpoint. */
  sources: string[];
  /** Harness-visible names per provider, used to switch inherited servers off. */
  aliases: { provider: "claude" | "codex" | "opencode"; name: string }[];
  kind: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  managed?: { name: string; scope: "user" | "project"; revision: string; enabled: boolean };
};

const REFRESH_MS = 30_000;
const MAX_PROJECT_SNAPSHOTS = 32;

/** Compatible launch or endpoint from several sources becomes one entry. Otherwise the
 * first claim keeps the plain name. Project servers that collide get a `-project` suffix. */
export function mergeDefinitions(raw: RawDefinition[]): InventoryDefinition[] {
  const byIdentity = new Map<string, InventoryDefinition[]>();
  const definitions: InventoryDefinition[] = [];
  const names = new Set<string>();
  for (const def of raw) {
    const identity =
      def.kind === "stdio"
        ? `stdio\0${def.command}\0${JSON.stringify(def.args ?? [])}`
        : `http\0${def.url}`;
    const alias = { provider: def.provider, name: def.alias };
    const candidates = byIdentity.get(identity) ?? [];
    const existing = candidates.find((candidate) => sameSettings(candidate, def));
    if (existing) {
      if (!existing.sources.includes(def.source)) existing.sources.push(def.source);
      // The same launch may carry its env in only one config (dokploy: Codex sets
      // DOKPLOY_URL, Claude does not). Keep every variable; the first claim wins a conflict.
      if (def.kind === "stdio" && existing.kind === "stdio" && def.env)
        existing.env = { ...def.env, ...existing.env };
      if (
        !existing.aliases.some(
          (item) => item.provider === alias.provider && item.name === alias.name,
        )
      )
        existing.aliases.push(alias);
      continue;
    }
    // Hub names are URL path segments, so only the safe subset survives.
    const base =
      def.name
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "server";
    const project = def.source.endsWith("-project");
    const suffix = project ? "project" : def.source;
    let name = base;
    if (names.has(name)) name = `${base}-${suffix}`;
    for (let n = 2; names.has(name); n++) name = `${base}-${suffix}-${n}`;
    names.add(name);
    const entry: InventoryDefinition = {
      name,
      source: def.source,
      sources: [def.source],
      aliases: [alias],
      kind: def.kind,
      ...(def.kind === "stdio"
        ? { command: def.command, args: def.args ?? [], env: def.env ?? {} }
        : { url: def.url, ...(def.headers ? { headers: def.headers } : {}) }),
    };
    candidates.push(entry);
    byIdentity.set(identity, candidates);
    definitions.push(entry);
  }
  return definitions;
}

function sameSettings(existing: InventoryDefinition, next: RawDefinition): boolean {
  if (!next.source.endsWith("-project") && !existing.source.endsWith("-project")) return true;
  const currentSettings = existing.kind === "stdio" ? existing.env : existing.headers;
  const nextSettings = next.kind === "stdio" ? next.env : next.headers;
  const caseInsensitive = next.kind === "http" || process.platform === "win32";
  const keyOf = (key: string) => (caseInsensitive ? key.toLowerCase() : key);
  const current = new Map(
    Object.entries(currentSettings ?? {}).map(([key, value]) => [keyOf(key), value]),
  );
  return Object.entries(nextSettings ?? {}).every(
    ([key, value]) => !current.has(keyOf(key)) || current.get(keyOf(key)) === value,
  );
}

type Snapshot = { signature: string; definitions: InventoryDefinition[]; checkedAt: number };

/** Read-only discovery. Files are re-stat'ed at most every 30 s; nothing is watched.
 * Sources are the default user files plus every provider-account profile, and without a
 * cwd no project sources. A cwd adds that project's files. */
export class McpInventory {
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly pending = new Map<string, Promise<InventoryDefinition[]>>();
  private generation = 0;

  constructor(
    private readonly files: InventoryFiles = inventoryFiles(),
    private readonly now: () => number = Date.now,
    private readonly refreshMs = REFRESH_MS,
    private readonly accountDirs: () => Promise<AccountDirs> = discoverAccountDirs,
  ) {}

  async definitions(cwd?: string): Promise<InventoryDefinition[]> {
    const key = cwd ?? "";
    const snapshot = this.snapshots.get(key);
    if (snapshot && this.now() - snapshot.checkedAt < this.refreshMs) return snapshot.definitions;
    // Concurrent sessions share one scan; callers never wait on each other's stat calls.
    let pending = this.pending.get(key);
    if (!pending) {
      const generation = this.generation;
      pending = this.refresh(cwd, generation).finally(() => {
        if (generation === this.generation) this.pending.delete(key);
      });
      this.pending.set(key, pending);
    }
    return pending;
  }

  invalidate(): void {
    this.generation++;
    this.pending.clear();
    this.snapshots.clear();
  }

  /** One codex table-name set per config a session may load: the default config and each
   * account's, each joined with the project config when a cwd is known. */
  async codexNameSets(cwd?: string): Promise<Set<string>[]> {
    const accounts = await this.accounts();
    const project = cwd ? await readCodexTableNames(codexProjectConfig(cwd)) : new Set<string>();
    const configs = [
      this.files.codexConfig,
      ...accounts.codex.map((dir) => join(dir, "config.toml")),
    ];
    return Promise.all(
      configs.map(async (file) => new Set([...(await readCodexTableNames(file)), ...project])),
    );
  }

  private accounts(): Promise<AccountDirs> {
    return this.accountDirs().catch(() => ({ claude: [], codex: [] }));
  }

  private async refresh(
    cwd: string | undefined,
    generation: number,
  ): Promise<InventoryDefinition[]> {
    const key = cwd ?? "";
    const accounts = await this.accounts();
    const signature = await statSignature(await inventorySourceFiles(this.files, cwd, accounts));
    const previous = this.snapshots.get(key);
    if (previous && previous.signature === signature) {
      previous.checkedAt = this.now();
      return previous.definitions;
    }
    const vars = process.env;
    const raw: RawDefinition[] = [
      ...(await readClaudeUserServers(this.files.claudeConfig, vars)),
      ...(await readPluginServers(this.files.pluginsDir, vars)),
      ...(await readCodexServers(this.files.codexConfig, vars)),
      ...(this.files.opencodeConfig
        ? await readOpencodeServers(this.files.opencodeConfig, vars)
        : []),
    ];
    for (const file of this.files.additionalOpencodeConfigs ?? [])
      raw.push(...(await readOpencodeServers(file, vars)));
    for (const dir of accounts.claude) {
      raw.push(
        ...(await readClaudeUserServers(join(dir, ".claude.json"), vars, "claude-account")),
        ...(await readPluginServers(join(dir, "plugins"), vars)),
      );
    }
    for (const dir of accounts.codex)
      raw.push(...(await readCodexServers(join(dir, "config.toml"), vars, "codex-account")));
    if (cwd) {
      raw.push(
        ...(await readClaudeProjectServers(this.files.claudeConfig, cwd, vars)),
        ...(await readProjectMcpJson(cwd, vars)),
        ...(await readCodexServers(codexProjectConfig(cwd), vars, "codex-project")),
      );
      const opencode = await Promise.all(
        opencodeProjectConfigs(cwd).map((file) =>
          readOpencodeServers(file, vars, "opencode-project"),
        ),
      );
      raw.push(...opencode.flat());
    }
    const definitions = mergeDefinitions(raw);
    if (generation !== this.generation) return definitions;
    if (!previous && this.snapshots.size >= MAX_PROJECT_SNAPSHOTS && cwd)
      this.snapshots.delete(this.snapshots.keys().next().value!);
    this.snapshots.set(key, { signature, definitions, checkedAt: this.now() });
    return definitions;
  }
}
