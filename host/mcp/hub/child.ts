import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { recordDuration } from "../../diagnostics/perf-metrics";
import { resolveHubLaunch } from "./launch";
import type { InventoryDefinition } from "./inventory";
import type { HubCache } from "./cache";

type Rpc = Record<string, any>;
type Pending = {
  resolve: (message: Rpc) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export const REQUEST_TIMEOUT_MS = 120_000;
export const STOP_GRACE_MS = 3_000;
const DEFAULT_CLIENT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "bycoda-mcp-hub", version: "1" },
};
const LIST_METHODS = new Set(["resources/list", "resources/templates/list", "prompts/list"]);

export type ChildOptions = {
  definition: InventoryDefinition;
  /** "shared" or the session id, which is also the `cwd` source for perSession children. */
  scopeKey: string;
  cwd: string;
  idleMs: number;
  requestTimeoutMs?: number;
  stopGraceMs?: number;
  now: () => number;
  loadCache: () => Promise<HubCache | undefined>;
  saveCache: (cache: HubCache) => Promise<void>;
  /** Called before a process is spawned so the hub can free capacity. */
  beforeStart: (child: McpChild) => Promise<void>;
};

const rpcError = (id: unknown, code: number, message: string): Rpc => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

/** One stdio server process for one (name, scope). Requests are remapped to internal ids
 * so concurrent clients keep their own ids; the process starts only when a request needs it. */
export class McpChild {
  proc?: ChildProcess;
  private ready?: Promise<void>;
  private readonly pending = new Map<string, Pending>();
  private clientParams?: Record<string, unknown>;
  private initResult?: Rpc;
  private idleTimer?: NodeJS.Timeout;
  private seq = 0;
  private handshaken = false;
  lastUsed: number;
  startedAt?: number;

  constructor(private readonly options: ChildOptions) {
    this.lastUsed = options.now();
  }

  get name(): string {
    return this.options.definition.name;
  }

  get scopeKey(): string {
    return this.options.scopeKey;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /** Returns the response for requests, or undefined for notifications. */
  async handle(message: Rpc): Promise<Rpc | undefined> {
    this.touch();
    const method = typeof message.method === "string" ? message.method : "";
    if (message.id === undefined) {
      // The client's initialized notification is replayed to each child on start.
      if (method === "notifications/initialized" || !this.proc) return undefined;
      this.write({ jsonrpc: "2.0", method, ...(message.params ? { params: message.params } : {}) });
      return undefined;
    }
    const cache = await this.options.loadCache();
    if (method === "initialize") {
      this.clientParams = (message.params ?? {}) as Record<string, unknown>;
      if (cache && this.cacheUsable(cache))
        return { jsonrpc: "2.0", id: message.id, result: cache.initialize };
      try {
        await this.start(true);
        return { jsonrpc: "2.0", id: message.id, result: this.initResult };
      } catch (error) {
        return rpcError(message.id, -32603, `${this.name} MCP failed to start: ${reason(error)}`);
      }
    }
    if (!this.proc && cache) {
      if (method === "ping") return { jsonrpc: "2.0", id: message.id, result: {} };
      if (method === "tools/list" && cache.tools)
        return { jsonrpc: "2.0", id: message.id, result: { tools: cache.tools } };
      if (LIST_METHODS.has(method) && cache.lists[method] !== undefined)
        return { jsonrpc: "2.0", id: message.id, result: cache.lists[method] };
    }
    try {
      await this.start(false);
    } catch (error) {
      return rpcError(message.id, -32603, `${this.name} MCP failed to start: ${reason(error)}`);
    }
    const reply = await this.send(message).catch((error: unknown) =>
      rpcError(message.id, -32603, `${this.name} MCP request failed: ${reason(error)}`),
    );
    return { ...reply, id: message.id };
  }

  private cacheUsable(cache: HubCache): boolean {
    return cache.protocolVersion === this.clientParams?.protocolVersion;
  }

  /** Starts the process and handshake once. `fill` waits for listings to be cached. */
  private start(fill: boolean): Promise<void> {
    if (this.ready) return this.ready;
    const began = performance.now();
    // Deferred so the shared `ready` is set before any await can let a second caller in.
    const ready: Promise<void> = Promise.resolve().then(async () => {
      await this.options.beforeStart(this);
      await this.spawnProcess();
      const init = (await this.request("initialize", this.clientParams ?? DEFAULT_CLIENT)) as Rpc;
      this.write({ jsonrpc: "2.0", method: "notifications/initialized" });
      this.initResult = init;
      this.startedAt = this.options.now();
      this.handshaken = true;
      recordDuration("mcp.ext.start", performance.now() - began);
      this.touch();
      const refresh = this.refreshCache(init);
      if (fill) await refresh;
      else void refresh.catch(() => undefined);
    });
    this.ready = ready;
    ready.catch(() => {
      if (this.ready === ready) this.ready = undefined;
      this.stop();
    });
    return ready;
  }

  /** Running, handshaken and idle: the hub may stop it to free capacity. */
  get evictable(): boolean {
    return !!this.proc && this.handshaken && this.pending.size === 0;
  }

  private async spawnProcess(): Promise<void> {
    const { definition, cwd } = this.options;
    if (definition.kind !== "stdio" || !definition.command)
      throw new Error("Only stdio servers run as hub children.");
    const env = { ...process.env, ...definition.env };
    // Bare `npx`/`uvx` definitions resolve on PATH; Windows .cmd shims need cmd.exe.
    const launch = await resolveHubLaunch(definition.command, definition.args ?? [], env);
    const proc = spawn(launch.shell?.command ?? launch.command, launch.shell?.args ?? launch.args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
      ...(launch.shell ? { windowsVerbatimArguments: true } : {}),
    });
    this.proc = proc;
    // Errors carry paths and arguments, so only the code is kept.
    proc.on("error", (error) =>
      this.childGone(proc, `spawn failed (${(error as NodeJS.ErrnoException).code ?? "error"})`),
    );
    proc.on("exit", () => this.childGone(proc, "exited"));
    proc.stdin?.on("error", () => undefined);
    createInterface({ input: proc.stdout!, crlfDelay: Infinity }).on("line", (line) =>
      this.onLine(proc, line),
    );
  }

  private onLine(proc: ChildProcess, line: string): void {
    if (this.proc !== proc || !line.trim()) return;
    let message: Rpc;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;
    if (message.method === undefined && message.id !== undefined) {
      const key = String(message.id);
      const waiting = this.pending.get(key);
      if (!waiting) return;
      this.pending.delete(key);
      clearTimeout(waiting.timer);
      waiting.resolve(message);
      this.touch();
      return;
    }
    // Server-to-client requests cannot be answered over stateless HTTP.
    if (message.method !== undefined && message.id !== undefined)
      this.write({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "Unsupported client request." },
      });
  }

  private childGone(proc: ChildProcess, why: string): void {
    if (this.proc !== proc) return;
    this.proc = undefined;
    this.ready = undefined;
    this.handshaken = false;
    clearTimeout(this.idleTimer);
    this.rejectAll(new Error(`${this.name} MCP server ${why}`));
  }

  private rejectAll(error: Error): void {
    for (const [key, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      this.pending.delete(key);
      waiting.reject(error);
    }
  }

  private write(message: Rpc): void {
    this.proc?.stdin?.write(JSON.stringify(message) + "\n");
  }

  /** Internal request (handshake, listings) that is not tied to a client id. */
  private async request(method: string, params: unknown): Promise<unknown> {
    const reply = await this.send({ jsonrpc: "2.0", method, params });
    if (reply.error) throw new Error(String(reply.error.message ?? "request failed"));
    return reply.result;
  }

  /** Remaps the id, writes one line, and resolves with the child's full reply. */
  private send(message: Rpc): Promise<Rpc> {
    const id = `hub-${++this.seq}`;
    return new Promise<Rpc>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("request timed out"));
      }, this.options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ ...message, id });
    });
  }

  private async refreshCache(init: Rpc): Promise<void> {
    const caps = (init?.capabilities ?? {}) as Rpc;
    const listing = async (method: string, enabled: unknown) => {
      if (!enabled) return undefined;
      try {
        return await this.request(method, {});
      } catch {
        return undefined;
      }
    };
    const tools = caps.tools ? await listing("tools/list", true) : {};
    if (!tools) return;
    const lists: Record<string, unknown> = {};
    for (const [method, enabled] of [
      ["resources/list", caps.resources],
      ["resources/templates/list", caps.resources],
      ["prompts/list", caps.prompts],
    ] as const) {
      const value = await listing(method, enabled);
      if (value !== undefined) lists[method] = value;
    }
    await this.options.saveCache({
      protocolVersion: String(init.protocolVersion ?? ""),
      initialize: init,
      tools: Array.isArray((tools as Rpc).tools) ? (tools as Rpc).tools : [],
      lists,
      savedAt: this.options.now(),
    });
  }

  private touch(): void {
    this.lastUsed = this.options.now();
    clearTimeout(this.idleTimer);
    if (this.proc) this.idleTimer = setTimeout(() => this.onIdle(), this.options.idleMs);
  }

  private onIdle(): void {
    if (this.pending.size > 0) return this.touch();
    recordDuration("mcp.ext.idleStop", 0);
    this.stop();
  }

  /** Closes stdin, then kills the process if it has not exited after the grace period. */
  stop(): void {
    const proc = this.proc;
    if (!proc) return;
    this.proc = undefined;
    this.ready = undefined;
    this.handshaken = false;
    this.startedAt = undefined;
    clearTimeout(this.idleTimer);
    this.rejectAll(new Error(`${this.name} MCP server stopped`));
    try {
      proc.stdin?.end();
    } catch {
      // The process is already gone; the kill timer below is harmless.
    }
    const kill = setTimeout(() => proc.kill(), this.options.stopGraceMs ?? STOP_GRACE_MS);
    kill.unref();
    proc.once("exit", () => clearTimeout(kill));
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
