import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { measure } from "../../diagnostics/perf-metrics";
import { HubCacheStore, type HubCache } from "./cache";
import { McpChild, REQUEST_TIMEOUT_MS, STOP_GRACE_MS } from "./child";
import { McpInventory, type InventoryDefinition } from "./inventory";
import { hubIdleMs, hubMode, type HubMode } from "./policy";
import { readRssBytes } from "./rss";
import { inventoryFiles, type AccountDirs, type InventoryFiles } from "./inventory-sources";

type Rpc = Record<string, any>;

export const MAX_HUB_CHILDREN = 48;
const RSS_SAMPLE_MS = 10_000;
const PRUNE_IDLE_MS = 60 * 60_000;
/** The describe call is on the session spawn path; the web side re-fetches a hub-less answer. */
export const EXTERNAL_MCP_WAIT_MS = 1_000;
/** A served publication is refreshed in the background once it is this old. */
export const PUBLICATION_REFRESH_MS = 30_000;

export type HubOptions = {
  /** Host data directory; caches live in `<dataDir>/mcp-hub/`. */
  dataDir: string;
  /** Test seam. Defaults to read-only discovery of the user's global MCP definitions. */
  inventory?: (cwd?: string) => Promise<InventoryDefinition[]>;
  /** Resolves a session's project to its folder, for project-scoped servers. */
  projectCwd?: (projectId: string) => Promise<string | undefined>;
  now?: () => number;
  maxChildren?: number;
  idleMs?: Partial<Record<HubMode, number>>;
  requestTimeoutMs?: number;
  stopGraceMs?: number;
  /** User config files; defaults to the host user's own Claude and Codex files. */
  files?: InventoryFiles;
  /** Provider-account profile dirs; defaults to discovery on this Host. */
  accountDirs?: () => Promise<AccountDirs>;
  /** Longest `externalMcp` waits for discovery before answering without the hub. */
  externalMcpWaitMs?: number;
};

/** Hosts inherited stdio MCP servers behind `/mcp/ext/<name>`, one child per (name, scope). */
export class McpHub {
  private readonly children = new Map<string, McpChild>();
  private readonly cacheStore: HubCacheStore;
  private readonly cacheMemo = new Map<string, Promise<HubCache | undefined>>();
  private readonly discovery: (cwd?: string) => Promise<InventoryDefinition[]>;
  private readonly now: () => number;
  private readonly maxChildren: number;
  private readonly codexSets: (cwd?: string) => Promise<Set<string>[]>;
  private rss = new Map<number, number>();
  private rssSampledAt = 0;
  private rssSampling?: Promise<void>;

  constructor(private readonly options: HubOptions) {
    this.cacheStore = new HubCacheStore(options.dataDir);
    this.now = options.now ?? Date.now;
    this.maxChildren = options.maxChildren ?? MAX_HUB_CHILDREN;
    const discovered = new McpInventory(
      options.files ?? inventoryFiles(),
      Date.now,
      undefined,
      options.accountDirs,
    );
    this.discovery = options.inventory ?? ((cwd) => discovered.definitions(cwd));
    this.codexSets = (cwd) => discovered.codexNameSets(cwd);
  }

  inventory(cwd?: string): Promise<InventoryDefinition[]> {
    return this.discovery(cwd);
  }

  /** Only stdio entries are hubbed; http entries are passed through by the harness. */
  async hosts(name: string, cwd?: string): Promise<boolean> {
    return (await this.inventory(cwd)).some((def) => def.name === name && def.kind === "stdio");
  }

  /** Returns the response for a request, or undefined for a notification. */
  async serve(
    name: string,
    scopeKey: string,
    message: Rpc,
    cwd?: string,
  ): Promise<Rpc | undefined> {
    return await measure("mcp.ext.request", async () => {
      const definition = (await this.inventory(cwd)).find(
        (def) => def.name === name && def.kind === "stdio",
      );
      if (!definition) throw new Error("Unknown MCP server.");
      this.prune();
      const mode = hubMode(name, definition);
      const scope = mode === "shared" ? "shared" : scopeKey;
      // Launch identity keeps same-named project servers from different folders apart.
      const launch = launchKey(definition);
      const key = `${name}\0${launch}\0${scope}`;
      const cacheKey = `${name.slice(0, 40)}-${launch}`;
      let child = this.children.get(key);
      if (!child) {
        child = new McpChild({
          definition,
          scopeKey: scope,
          cwd: mode === "perSession" && cwd ? cwd : homedir(),
          idleMs: this.options.idleMs?.[mode] ?? hubIdleMs(mode),
          requestTimeoutMs: this.options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
          stopGraceMs: this.options.stopGraceMs ?? STOP_GRACE_MS,
          now: this.now,
          loadCache: () => this.loadCache(cacheKey),
          saveCache: async (cache) => this.saveCache(cacheKey, cache),
          beforeStart: (starting) => this.reserve(starting),
        });
        this.children.set(key, child);
      }
      return await child.handle(message);
    });
  }

  private loadCache(name: string): Promise<HubCache | undefined> {
    let memo = this.cacheMemo.get(name);
    if (!memo) {
      memo = this.cacheStore.read(name);
      this.cacheMemo.set(name, memo);
    }
    return memo;
  }

  private async saveCache(name: string, cache: HubCache): Promise<void> {
    this.cacheMemo.set(name, Promise.resolve(cache));
    await this.cacheStore.write(name, cache).catch(() => undefined);
  }

  /** Keeps at most `maxChildren` processes. Shared idle children go first, then least recent. */
  private async reserve(starting: McpChild): Promise<void> {
    const running = [...this.children.values()].filter((child) => child !== starting && child.proc);
    if (running.length < this.maxChildren) return;
    const victim = running
      .filter((child) => child.evictable)
      .sort(
        (a, b) =>
          Number(a.scopeKey !== "shared") - Number(b.scopeKey !== "shared") ||
          a.lastUsed - b.lastUsed,
      )[0];
    if (!victim) throw new Error("MCP hub is at capacity; retry shortly.");
    victim.stop();
  }

  private prune(): void {
    const cutoff = this.now() - PRUNE_IDLE_MS;
    for (const [key, child] of this.children)
      if (!child.proc && child.lastUsed < cutoff) this.children.delete(key);
  }

  /** Sampling is bounded to one OS query per 10 s and never blocks the caller. */
  async status() {
    if (this.now() - this.rssSampledAt >= RSS_SAMPLE_MS) this.sampleRss();
    const running = [...this.children.values()].filter((child) => child.proc);
    const definitions = await this.inventory();
    return {
      cap: this.maxChildren,
      running: running.length,
      children: running.map((child) => {
        const pid = child.proc?.pid;
        return {
          name: child.name,
          scope: child.scopeKey === "shared" ? "shared" : "perSession",
          pid,
          rssBytes: pid !== undefined ? (this.rss.get(pid) ?? null) : null,
          pending: child.pendingCount,
          startedAt: child.startedAt ?? null,
        };
      }),
      rssSampledAt: this.rssSampledAt || null,
      inventory: {
        servers: definitions.length,
        stdio: definitions.filter((def) => def.kind === "stdio").length,
        http: definitions.filter((def) => def.kind === "http").length,
        perSession: definitions.filter(
          (def) => def.kind === "stdio" && hubMode(def.name, def) === "perSession",
        ).length,
      },
    };
  }

  private sampleRss(): void {
    this.rssSampling ??= (async () => {
      const pids = [...this.children.values()].flatMap((child) =>
        child.proc?.pid !== undefined ? [child.proc.pid] : [],
      );
      this.rss = await readRssBytes(pids);
      this.rssSampledAt = this.now();
    })()
      .catch(() => undefined)
      .finally(() => {
        this.rssSampling = undefined;
      });
  }

  /** What the app publishes to the harness. Stdio launch details never leave the host. */
  async publication(endpoint: string, cwd?: string) {
    const definitions = await this.inventory(cwd);
    // Every `[mcp_servers.*]` table, including disabled ones, is a name Codex already owns.
    // A session's account is not known here, so each candidate config is considered.
    const codexSets = await this.codexSets(cwd);
    const codexNames = new Set(codexSets.flatMap((set) => [...set]));
    const servers = definitions.map((def) => {
      const mode = def.kind === "http" ? "shared" : hubMode(def.name, def);
      const codexName = codexNameFor(def.name, codexNames);
      if (def.kind === "http")
        return {
          name: def.name,
          url: def.url!,
          kind: "http" as const,
          passthrough: { url: def.url!, ...(def.headers ? { headers: def.headers } : {}) },
          mode,
          sources: def.sources,
          codexName,
        };
      return {
        name: def.name,
        url: `${endpoint}/mcp/ext/${def.name}`,
        kind: "stdio" as const,
        mode,
        sources: def.sources,
        codexName,
      };
    });
    const disable = {
      claude: new Set<string>(),
      codex: new Set<string>(),
      opencode: new Set<string>(),
    };
    for (const def of definitions) {
      if (def.kind !== "stdio") continue;
      for (const alias of def.aliases) {
        // Codex refuses overrides for names a candidate config lacks, so only names every
        // candidate has are safe to disable.
        if (alias.provider === "codex" && !codexSets.every((set) => set.has(alias.name))) continue;
        disable[alias.provider].add(alias.name);
      }
    }
    return {
      servers,
      disable: {
        claude: [...disable.claude],
        codex: [...disable.codex],
        opencode: [...disable.opencode],
      },
    };
  }

  /** Published hub fragments by relay origin and project, refreshed off the request path. */
  private readonly publications = new Map<string, { value: unknown; at: number }>();
  private readonly publishing = new Map<string, Promise<unknown>>();

  private refreshPublication(key: string, origin: string, cwd: string | undefined) {
    let pending = this.publishing.get(key);
    if (!pending) {
      pending = this.publication(origin, cwd)
        .then((value) => {
          this.publications.set(key, { value, at: this.now() });
          return value;
        })
        .catch(() => undefined)
        .finally(() => this.publishing.delete(key));
      this.publishing.set(key, pending);
    }
    return pending;
  }

  /** Conversation bridge fragment; the relay origin is the endpoint the harness can reach.
   * The describe call sits on the session spawn path and is cut off by the desktop after
   * about two seconds, so a known publication is answered at once (and refreshed in the
   * background when older than the inventory's 30 s re-stat window); only the very first
   * request for an origin/project waits, and never longer than `externalMcpWaitMs`. */
  async externalMcp(
    mcpUrl: string | undefined,
    projectId?: string,
  ): Promise<{ externalMcp: unknown } | undefined> {
    const match = /^(.*)\/mcp\/conversation$/.exec(mcpUrl ?? "");
    if (!match) return undefined;
    const cwd = projectId
      ? await this.options.projectCwd?.(projectId).catch(() => undefined)
      : undefined;
    const key = [match[1], cwd ?? ""].join("\n");
    const known = this.publications.get(key);
    if (known) {
      if (this.now() - known.at > PUBLICATION_REFRESH_MS)
        // oxlint-disable-next-line bycoda/handled-background-promise -- refreshPublication swallows its own failures
        void this.refreshPublication(key, match[1], cwd);
      return known.value ? { externalMcp: known.value } : undefined;
    }
    let timer: number | undefined;
    const externalMcp = await Promise.race([
      this.refreshPublication(key, match[1], cwd),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(resolve, this.options.externalMcpWaitMs ?? EXTERNAL_MCP_WAIT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    return externalMcp ? { externalMcp } : undefined;
  }

  /** Runs the first discovery off the request path so the first describe finds it warm. */
  warm(port: number): void {
    this.externalMcp(`http://127.0.0.1:${port}/mcp/conversation`).catch(() => undefined);
  }

  shutdown(): void {
    for (const child of this.children.values()) child.stop();
    this.children.clear();
  }
}

/** Codex overlays are addressed by `-c mcp_servers.<name>`, so dots are not allowed and a
 * name already present in config.toml gets a distinct `-hub` suffix. */
export function codexNameFor(name: string, codexNames: ReadonlySet<string>): string {
  const base = name.replaceAll(".", "-");
  return codexNames.has(name) || codexNames.has(base) ? `${base}-hub` : base;
}

/** Short digest of what would be launched or fetched. Environment values are excluded. */

function launchKey(def: InventoryDefinition): string {
  return createHash("sha256")
    .update(JSON.stringify([def.kind, def.command, def.args, def.url]))

    .digest("hex")

    .slice(0, 10);
}
