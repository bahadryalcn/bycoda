import { randomUUID } from "node:crypto";
import { crewMcpServers } from "../../crews/crew-native-tools";
import { truncateGraphemes } from "../../../src/shared/lib/text/truncate";
import { CLIENT_DEADLINE_MS, type HubPeek, type McpHub } from "./hub";
import type { InventoryDefinition } from "./inventory";
import { expandPlaceholders } from "./inventory-sources";
import type { OAuthServerRef } from "./oauth/manager";
import { safeUrl } from "./oauth/net";

export const MAX_LIST_SERVERS = 100;
export const MAX_DESCRIBE_TOOLS = 60;
export const MAX_INSTRUCTIONS = 2_000;
export const MAX_SCHEMA_BYTES = 16 * 1024;
export const MAX_ARGUMENT_BYTES = 256 * 1024;
export const MAX_RESULT_GRAPHEMES = 32_000;
export const DEFAULT_TIMEOUT_SECONDS = 60;
export const MAX_TIMEOUT_SECONDS = 110;
const MAX_RECEIPTS = 500;
const DISCOVERY_DEADLINE_MS = 30_000;
const MAX_HTTP_BYTES = 4 * 1024 * 1024;
const MAX_HTTP_CACHE_ENTRIES = 500;
const SUMMARY_GRAPHEMES = 120;
const PROFILE_DEADLINE_MS = 6_000;
const MAX_PROFILE_TOOL_PAGES = 32;

export type ExternalMcpContext = {
  sessionId: string;
  projectId: string;
  cwd?: string;
  modelSettings?: Readonly<Record<string, string>>;
  runtimeMode?: string;
};

export type ServerEntry = {
  name: string;
  summary: string;
  toolCount: number | null;
  state: "cached" | "unknown";
  scope: "user" | "project";
  direct: boolean;
  auth: "none" | "oauth-signed-in" | "oauth-required" | "project-credentials";
};

export type ToolSummary = { name: string; description: string; access: "read" | "write" };
export type ServerDescription = {
  server: string;
  summary: string;
  instructions?: string;
  tools: ToolSummary[];
  toolCount: number;
  truncated: boolean;
};
export type ToolDescription = {
  server: string;
  name: string;
  description: string;
  access: "read" | "write";
  annotations?: Record<string, unknown>;
  inputSchema?: unknown;
  /** Set instead of `inputSchema` when the schema exceeds the cap. */
  schemaText?: string;
  schemaTruncated?: boolean;
};
export type CallResult = {
  text: string;
  isError: boolean;
  truncated: boolean;
  /** Non-text content parts (images, resources) that were not returned. */
  omittedParts: number;
};

export interface ExternalMcpTools {
  list(ctx: ExternalMcpContext, input: { query?: string }): Promise<{ servers: ServerEntry[] }>;
  describe(
    ctx: ExternalMcpContext,
    input: { server: string; tool?: string; query?: string },
  ): Promise<ServerDescription | ToolDescription>;
  call(
    ctx: ExternalMcpContext,
    input: {
      server: string;
      tool: string;
      arguments: Record<string, unknown>;
      requestId: string;
      timeoutSeconds?: number;
    },
  ): Promise<CallResult>;
  classify(ctx: ExternalMcpContext, server: string, tool: string): Promise<"read" | "write">;
}

export type ExternalMcpToolsOptions = {
  hub: Pick<McpHub, "inventory" | "peek" | "request" | "loadingPolicy"> &
    Partial<
      Pick<
        McpHub,
        | "oauthSignedIn"
        | "oauthProjectScoped"
        | "oauthServerRef"
        | "projectCredentialsFor"
        | "configurationGeneration"
      >
    >;
  projectCwd?: (projectId: string) => Promise<string | undefined>;
  /** Auth headers for an http server (Host OAuth fills this). Undefined means not signed in. */
  httpAuth?: (server: OAuthServerRef) => Promise<Record<string, string> | undefined>;
  fetch?: typeof fetch;
};

type Tool = {
  name: string;
  _meta?: unknown;
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
};
type Rpc = (method: string, params: Record<string, unknown>) => Promise<Record<string, any>>;
type ProjectCredential = Awaited<ReturnType<McpHub["projectCredentialsFor"]>>;

const CLIENT_INFO = { name: "bycoda-mcp-on-demand", version: "1" };
const INIT_PARAMS = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: CLIENT_INFO };
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const baseSession = (sessionId: string) => sessionId.replace(/#\d+$/, "");

const toolAccess = (tool: Tool | undefined): "read" | "write" =>
  tool?.annotations?.readOnlyHint === true && tool.annotations.destructiveHint !== true
    ? "read"
    : "write";

const asTools = (value: unknown): Tool[] =>
  (Array.isArray(value) ? value : []).filter(
    (item): item is Tool => isRecord(item) && typeof item.name === "string",
  );

const summaryOf = (peek: HubPeek | undefined, name: string): string => {
  const line = peek?.instructions?.trim().split(/\r?\n/)[0] ?? "";
  return truncateGraphemes(line || peek?.serverInfo?.name || name, SUMMARY_GRAPHEMES);
};

function profileLabel(result: Record<string, unknown>, bearer: string): string | undefined {
  if (result.isError === true) return undefined;
  let profile = result.structuredContent;
  if (profile === undefined && Array.isArray(result.content) && result.content.length === 1) {
    const [part] = result.content;
    if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
      if (part.text.length <= 4096) profile = JSON.parse(part.text) as unknown;
    }
  }
  if (!isRecord(profile) || typeof profile.id !== "string" || !profile.id.trim()) return undefined;
  const secret = bearer.replace(/^Bearer /i, "");
  return [profile.email, profile.name, profile.nickname]
    .find(
      (label): label is string =>
        typeof label === "string" &&
        label.trim().length > 0 &&
        label.length <= 320 &&
        !/[\p{Cc}\p{Cf}]/u.test(label) &&
        !label.includes(secret),
    )
    ?.trim();
}

/** On-demand listing, description and calls of hub-inventory MCP servers for conversation tools. */
export class HubExternalMcpTools implements ExternalMcpTools {
  private readonly receipts = new Map<
    string,
    { fingerprint: string; result: Promise<CallResult> }
  >();
  private readonly httpPeeks = new Map<string, HubPeek>();
  private readonly authRequired = new Set<string>();

  constructor(private readonly options: ExternalMcpToolsOptions) {}

  /** Settings uses the authenticated connection's declared profile tool. */
  async accountProfile(def: InventoryDefinition, cwd?: string): Promise<string | undefined> {
    try {
      if (def.kind !== "http" || !def.url) return undefined;
      const url = safeUrl(def.url);
      const ref = this.oauthRef(def, cwd);
      const auth = await this.options.httpAuth?.(ref);
      if (!auth?.Authorization) return undefined;
      const rpc = await this.httpRpc(
        { ...def, url: url.href, headers: undefined },
        cwd,
        PROFILE_DEADLINE_MS,
        undefined,
        { auth, signal: AbortSignal.timeout(PROFILE_DEADLINE_MS) },
      );
      const cursors = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PROFILE_TOOL_PAGES; page++) {
        const listing = await rpc("tools/list", cursor ? { cursor } : {});
        const tools = asTools(listing.tools).filter(
          (tool) => isRecord(tool._meta) && tool._meta["openai/profile"] === true,
        );
        if (tools.length > 0) {
          const [tool] = tools;
          if (
            tools.length !== 1 ||
            tool.annotations?.readOnlyHint === false ||
            tool.annotations?.destructiveHint === true ||
            tool.annotations?.consequentialHint === true
          )
            return undefined;
          const result = await rpc("tools/call", { name: tool.name, arguments: {} });
          const current = await this.options.httpAuth?.(ref);
          if (current?.Authorization !== auth.Authorization) return undefined;
          return profileLabel(result, auth.Authorization);
        }
        cursor = typeof listing.nextCursor === "string" ? listing.nextCursor : undefined;
        if (!cursor || cursors.has(cursor)) return undefined;
        cursors.add(cursor);
      }
    } catch {
      // Profile availability is independent of the sign-in state.
    }
    return undefined;
  }

  async list(ctx: ExternalMcpContext, input: { query?: string }) {
    const { defs, cwd } = await this.visible(ctx);
    const policy = await this.options.hub.loadingPolicy();
    const query = input.query?.trim().toLowerCase();
    const entries: ServerEntry[] = [];
    for (const def of defs) {
      const credential = await this.options.hub.projectCredentialsFor?.(cwd, def);
      const peek = await this.cached(def, cwd, credential);
      const privateHttp =
        def.kind === "http" &&
        (credential || (await this.options.hub.oauthProjectScoped?.(def, cwd)));
      const hostHttp = def.kind === "http" && (def.managed || privateHttp);
      const entry: ServerEntry = {
        name: def.name,
        summary: summaryOf(peek, def.name),
        toolCount: peek ? peek.tools.length : null,
        state: peek ? "cached" : "unknown",
        scope:
          credential?.scope ??
          (privateHttp || def.source.endsWith("-project") ? "project" : "user"),
        direct:
          !hostHttp &&
          ((def.kind === "http" && !(await this.signedIn(def, cwd))) ||
            policy.mode === "always" ||
            policy.direct.includes(def.name)),
        auth: credential ? "project-credentials" : await this.authOf(def, cwd),
      };
      if (query && !`${entry.name} ${entry.summary}`.toLowerCase().includes(query)) continue;
      entries.push(entry);
      if (entries.length >= MAX_LIST_SERVERS) break;
    }
    return { servers: entries };
  }

  async describe(
    ctx: ExternalMcpContext,
    input: { server: string; tool?: string; query?: string },
  ): Promise<ServerDescription | ToolDescription> {
    const { def, cwd } = await this.find(ctx, input.server);
    const peek = await this.snapshot(ctx, def, cwd);
    const tools = asTools(peek.tools);
    if (input.tool !== undefined) {
      const tool = tools.find((item) => item.name === input.tool);
      if (!tool) throw new Error(`Unknown tool "${input.tool}" on ${def.name}.`);
      const json = JSON.stringify(tool.inputSchema ?? {});
      const fits = json.length <= MAX_SCHEMA_BYTES;
      return {
        server: def.name,
        name: tool.name,
        description: tool.description ?? "",
        access: toolAccess(tool),
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
        ...(fits
          ? { inputSchema: tool.inputSchema ?? {} }
          : { schemaText: truncateGraphemes(json, MAX_SCHEMA_BYTES), schemaTruncated: true }),
      };
    }
    const query = input.query?.trim().toLowerCase();
    const matching = query
      ? tools.filter((tool) =>
          `${tool.name} ${tool.description ?? ""}`.toLowerCase().includes(query),
        )
      : tools;
    return {
      server: def.name,
      summary: summaryOf(peek, def.name),
      ...(peek.instructions
        ? { instructions: truncateGraphemes(peek.instructions, MAX_INSTRUCTIONS) }
        : {}),
      tools: matching.slice(0, MAX_DESCRIBE_TOOLS).map((tool) => ({
        name: tool.name,
        description: truncateGraphemes(tool.description ?? "", 200),
        access: toolAccess(tool),
      })),
      toolCount: tools.length,
      truncated: matching.length > MAX_DESCRIBE_TOOLS,
    };
  }

  async classify(ctx: ExternalMcpContext, server: string, tool: string) {
    const { def, cwd } = await this.find(ctx, server);
    const peek = await this.snapshot(ctx, def, cwd);
    return toolAccess(asTools(peek.tools).find((item) => item.name === tool));
  }

  async call(
    ctx: ExternalMcpContext,
    input: {
      server: string;
      tool: string;
      arguments: Record<string, unknown>;
      requestId: string;
      timeoutSeconds?: number;
    },
  ): Promise<CallResult> {
    if (!input.requestId) throw new Error("requestId is required.");
    const args = input.arguments ?? {};
    const serialized = JSON.stringify(args);
    if (serialized.length > MAX_ARGUMENT_BYTES) throw new Error("Tool arguments are too large.");
    const seconds = Math.min(
      MAX_TIMEOUT_SECONDS,
      Math.max(1, Math.round(input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS)),
    );
    const fingerprint = JSON.stringify([input.server, input.tool, serialized, seconds]);
    const key = `${baseSession(ctx.sessionId)}\0${input.requestId}`;
    const known = this.receipts.get(key);
    if (known) {
      if (known.fingerprint !== fingerprint)
        throw new Error("requestId was already used for a different call.");
      return await known.result;
    }
    const result = this.execute(ctx, input.server, input.tool, args, seconds * 1000);
    this.receipts.set(key, { fingerprint, result });
    // Failed attempts may be retried under the same id; settled results stay as receipts.
    result.catch(() => this.receipts.delete(key));
    if (this.receipts.size > MAX_RECEIPTS)
      this.receipts.delete(this.receipts.keys().next().value as string);
    return await result;
  }

  private async execute(
    ctx: ExternalMcpContext,
    server: string,
    tool: string,
    args: Record<string, unknown>,
    deadlineMs: number,
  ): Promise<CallResult> {
    const { def, cwd } = await this.find(ctx, server);
    const params = { name: tool, arguments: args };
    let reply: Record<string, any>;
    if (def.kind === "http") {
      const credential = await this.options.hub.projectCredentialsFor?.(cwd, def);
      const rpc = await this.httpRpc(def, cwd, deadlineMs, credential);
      reply = await rpc("tools/call", params);
    } else {
      const response = await this.options.hub.request(
        def.name,
        baseSession(ctx.sessionId),
        { jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params },
        cwd,
        deadlineMs,
      );
      if (response?.error) return failure(String(response.error.message ?? "MCP call failed."));
      reply = response?.result ?? {};
    }
    const content: unknown[] = Array.isArray(reply.content) ? reply.content : [];
    const texts = content.flatMap((part) =>
      isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [],
    );
    const full = texts.join("\n");
    const text = truncateGraphemes(full, MAX_RESULT_GRAPHEMES);
    return {
      text,
      isError: reply.isError === true,
      truncated: text !== full,
      omittedParts: content.length - texts.length,
    };
  }

  /** Inventory narrowed by the crew allowlist; project servers come from the session's folder. */
  private async visible(ctx: ExternalMcpContext) {
    const cwd = ctx.cwd ?? (await this.options.projectCwd?.(ctx.projectId).catch(() => undefined));
    const allow = crewMcpServers(ctx.modelSettings);
    const defs = (await this.options.hub.inventory(cwd)).filter(
      (def) => !allow || allow.includes(def.name),
    );
    return { defs, cwd };
  }

  private async find(ctx: ExternalMcpContext, name: string) {
    const { defs, cwd } = await this.visible(ctx);
    const def = defs.find((item) => item.name === name);
    if (!def) throw new Error("Unknown MCP server.");
    return { def, cwd };
  }

  private oauthRef(def: InventoryDefinition, cwd?: string): OAuthServerRef {
    return this.options.hub.oauthServerRef?.(def, cwd) ?? { name: def.name, url: def.url! };
  }

  private async signedIn(def: InventoryDefinition, cwd?: string): Promise<boolean> {
    return (await this.options.hub.oauthSignedIn?.(this.oauthRef(def, cwd))) === true;
  }

  private async authOf(
    def: InventoryDefinition,
    cwd: string | undefined,
  ): Promise<ServerEntry["auth"]> {
    if (def.kind !== "http") return "none";
    const headers = await this.options.httpAuth?.(this.oauthRef(def, cwd)).catch(() => undefined);
    if (headers && Object.keys(headers).length) return "oauth-signed-in";
    return this.authRequired.has(this.httpCacheKey(def, cwd)) ? "oauth-required" : "none";
  }

  private httpCacheKey(def: InventoryDefinition, cwd?: string, credential?: ProjectCredential) {
    return JSON.stringify([
      cwd,
      def.name,
      def.url,
      credential?.revision,
      this.options.hub.configurationGeneration?.(),
    ]);
  }

  private async cached(
    def: InventoryDefinition,
    cwd: string | undefined,
    credential?: ProjectCredential,
  ) {
    return def.kind === "http"
      ? this.httpPeeks.get(this.httpCacheKey(def, cwd, credential))
      : await this.options.hub.peek(def.name, cwd);
  }

  /** Cached listing, or one real start (with a deadline) when nothing is cached yet. */
  private async snapshot(
    ctx: ExternalMcpContext,
    def: InventoryDefinition,
    cwd: string | undefined,
  ): Promise<HubPeek> {
    const credential =
      def.kind === "http" ? await this.options.hub.projectCredentialsFor?.(cwd, def) : undefined;
    const key = this.httpCacheKey(def, cwd, credential);
    const known = await this.cached(def, cwd, credential);
    if (known) return known;
    const rpc =
      def.kind === "http"
        ? await this.httpRpc(def, cwd, DISCOVERY_DEADLINE_MS, credential)
        : this.stdioRpc(ctx, def, cwd);
    const init = await rpc("initialize", INIT_PARAMS);
    const listed = await rpc("tools/list", {});
    const peek: HubPeek = {
      serverInfo: isRecord(init.serverInfo) ? init.serverInfo : undefined,
      ...(typeof init.instructions === "string" ? { instructions: init.instructions } : {}),
      tools: asTools(listed.tools),
    };
    if (def.kind === "http") {
      this.httpPeeks.set(key, peek);
      if (this.httpPeeks.size > MAX_HTTP_CACHE_ENTRIES)
        this.httpPeeks.delete(this.httpPeeks.keys().next().value!);
    }
    return peek;
  }

  private stdioRpc(
    ctx: ExternalMcpContext,
    def: InventoryDefinition,
    cwd: string | undefined,
  ): Rpc {
    return async (method, params) => {
      const response = await this.options.hub.request(
        def.name,
        baseSession(ctx.sessionId),
        { jsonrpc: "2.0", id: randomUUID(), method, params },
        cwd,
        DISCOVERY_DEADLINE_MS,
      );
      if (!response || response.error)
        throw new Error(truncateGraphemes(String(response?.error?.message ?? "MCP failed."), 300));
      return response.result ?? {};
    };
  }

  /** Streamable-HTTP client: one session per call path, aborted at the deadline. */
  private async httpRpc(
    def: InventoryDefinition,
    cwd: string | undefined,
    deadlineMs: number,
    credential: ProjectCredential,
    profile?: { auth: Record<string, string>; signal: AbortSignal },
  ): Promise<Rpc> {
    const doFetch = this.options.fetch ?? fetch;
    const auth =
      profile?.auth ??
      credential?.values ??
      (await this.options.httpAuth?.(this.oauthRef(def, cwd)));
    if (!auth && (await this.options.hub.oauthProjectScoped?.(def, cwd)))
      throw new Error(`${def.name} requires project sign-in.`);
    const base = new Headers({
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    });
    for (const [key, value] of Object.entries(def.headers ?? {})) {
      const inherited = expandPlaceholders(value, process.env).replace(
        /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g,
        (_match, name) => process.env[name] ?? "",
      );
      if (inherited.trim()) base.set(key, inherited);
    }
    for (const [key, value] of Object.entries(auth ?? {})) base.set(key, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(deadlineMs, CLIENT_DEADLINE_MS));
    timer.unref();
    let session: string | undefined;
    let protocol: string | undefined;
    let id = 0;
    let initialized = false;
    const post = async (body: Record<string, unknown>) => {
      const headers = new Headers(base);
      if (session) headers.set("Mcp-Session-Id", session);
      if (protocol) headers.set("MCP-Protocol-Version", protocol);
      const response = await doFetch(def.url!, {
        method: "POST",
        redirect: "error",
        signal: profile?.signal ?? controller.signal,
        headers,
        body: JSON.stringify(body),
      });
      if (response.status === 401 || response.status === 403) {
        if (!credential) {
          this.authRequired.add(this.httpCacheKey(def, cwd));
          if (this.authRequired.size > MAX_HTTP_CACHE_ENTRIES)
            this.authRequired.delete(this.authRequired.keys().next().value!);
        }
        throw new Error(`${def.name} requires sign-in.`);
      }
      if (!response.ok) throw new Error(`${def.name} MCP returned HTTP ${response.status}.`);
      session = response.headers.get("mcp-session-id") ?? session;
      return response;
    };
    const send = async (method: string, params: Record<string, unknown>) => {
      const requestId = ++id;
      const response = await post({ jsonrpc: "2.0", id: requestId, method, params });
      const message = await readReply(response, requestId);
      if (message.error) {
        if (credential) throw new Error(`${def.name} MCP request failed.`);
        throw new Error(truncateGraphemes(String(message.error.message ?? "MCP failed."), 300));
      }
      return (message.result ?? {}) as Record<string, any>;
    };
    const handshake = async () => {
      const init = await send("initialize", INIT_PARAMS);
      protocol = typeof init.protocolVersion === "string" ? init.protocolVersion : undefined;
      initialized = true;
      await post({ jsonrpc: "2.0", method: "notifications/initialized" });
      return init;
    };
    return async (method, params) => {
      try {
        if (method === "initialize") return await handshake();
        if (!initialized) await handshake();
        return await send(method, params);
      } catch (error) {
        if (controller.signal.aborted) throw new Error(`${def.name} MCP timed out.`);
        throw error;
      } finally {
        if (method !== "initialize") clearTimeout(timer);
      }
    };
  }
}

const failure = (message: string): CallResult => ({
  text: truncateGraphemes(message, 300),
  isError: true,
  truncated: false,
  omittedParts: 0,
});

/** Reads a JSON or event-stream reply, bounded, and returns the message answering `id`. */
async function readReply(response: Response, id: number): Promise<Record<string, any>> {
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > MAX_HTTP_BYTES) {
      await reader.cancel();
      throw new Error("MCP response is too large.");
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!(response.headers.get("content-type") ?? "").includes("text/event-stream"))
    return JSON.parse(text) as Record<string, any>;
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      const message = JSON.parse(data) as Record<string, any>;
      if (message.id === id) return message;
    } catch {
      // Ignore non-JSON events.
    }
  }
  throw new Error("MCP response had no reply.");
}
