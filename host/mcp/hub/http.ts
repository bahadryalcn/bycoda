import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import type { McpHub } from "./hub";

export const EXT_ROUTE_PREFIX = "/mcp/ext/";
const MAX_BYTES = 1024 * 1024;
const VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const WINDOW_MS = 60_000;
const TOKEN_LIMIT = 240;
const TOKEN_ACTIVE = 16;
const GLOBAL_ACTIVE = 64;

export type ExternalMcpAuth = {
  /** Only a session grant resolves here; external project tokens resolve to undefined. */
  principalForToken(
    token: string,
  ): Promise<{ kind: string; sessionId?: string; projectId?: string } | undefined>;
  projectCwd(projectId: string): Promise<string | undefined>;
};

/** Streamable-HTTP POST route for hubbed servers, authorized with the session token. */
export class ExternalMcpRoute {
  private active = 0;
  private readonly tokens = new Map<string, { start: number; count: number; active: number }>();

  constructor(
    private readonly hub: McpHub,
    private readonly auth: ExternalMcpAuth,
    private readonly now: () => number = Date.now,
  ) {}

  async handle(request: IncomingMessage, response: ServerResponse, name: string): Promise<true> {
    const reject = (status: number, message: string, stage = false) => {
      if (stage) response.setHeader("X-Bycoda-Auth-Stage", "before-dispatch");
      response.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify({ error: message }));
      request.resume();
      return true as const;
    };
    const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) return reject(401, "MCP credential required.", true);
    const principal = await this.auth.principalForToken(token);
    if (!principal || principal.kind !== "session" || !principal.sessionId)
      return reject(401, "MCP credential is invalid, expired or outside this scope.", true);
    const cwd = principal.projectId ? await this.auth.projectCwd(principal.projectId) : undefined;
    if (!NAME.test(name) || !(await this.hub.hosts(name, cwd)))
      return reject(404, "Unknown MCP server.");
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      return reject(405, "MCP subscriptions and session deletion are not supported.");
    }
    if (!request.headers["content-type"]?.startsWith("application/json"))
      return reject(415, "JSON required.");
    const accept = request.headers.accept ?? "";
    if (!accept.includes("application/json") || !accept.includes("text/event-stream"))
      return reject(406, "Accept must include application/json and text/event-stream.");
    const protocol = request.headers["mcp-protocol-version"];
    if (protocol !== undefined && (typeof protocol !== "string" || !VERSIONS.includes(protocol)))
      return reject(400, "Unsupported MCP protocol version.");
    if (Number(request.headers["content-length"] ?? 0) > MAX_BYTES)
      return reject(413, "MCP request too large.");
    const limit = this.admit(token);
    if (!limit) {
      response.setHeader("Retry-After", "1");
      return reject(429, "MCP request limit exceeded.");
    }
    try {
      const raw = await readBounded(request, MAX_BYTES).catch(() => null);
      if (raw === null) return reject(400, "Invalid MCP request.");
      if (!raw) return reject(413, "MCP request too large.");
      // Revocation or expiry during the body read must stop dispatch.
      const again = await this.auth.principalForToken(token);
      if (!again || again.sessionId !== principal.sessionId)
        return reject(401, "MCP credential is invalid or revoked.", true);
      let message: Record<string, any>;
      try {
        message = JSON.parse(raw.toString("utf8"));
      } catch {
        return this.send(response, {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Invalid JSON." },
        });
      }
      if (
        !message ||
        Array.isArray(message) ||
        message.jsonrpc !== "2.0" ||
        typeof message.method !== "string" ||
        (message.id !== undefined &&
          typeof message.id !== "string" &&
          typeof message.id !== "number")
      )
        return this.send(response, {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Invalid JSON-RPC request." },
        });
      let reply: Record<string, unknown> | undefined;
      try {
        reply = await this.hub.serve(name, principal.sessionId, message, cwd);
      } catch (error) {
        if (message.id === undefined) {
          response.writeHead(202).end();
          return true;
        }
        return this.send(response, {
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32603, message: safeMessage(error) },
        });
      }
      if (message.id === undefined || reply === undefined) {
        response.writeHead(202).end();
        return true;
      }
      return this.send(response, reply);
    } finally {
      limit.release();
    }
  }

  private send(response: ServerResponse, body: unknown): true {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify(body));
    return true;
  }

  /** Same per-credential and global caps as the group routes, counted per credential digest. */
  private admit(token: string): { release(): void } | undefined {
    const now = this.now();
    const key = createHash("sha256").update(token).digest("hex");
    let entry = this.tokens.get(key);
    if (!entry) this.tokens.set(key, (entry = { start: now, count: 0, active: 0 }));
    else if (now - entry.start >= WINDOW_MS) Object.assign(entry, { start: now, count: 0 });
    if (++entry.count > TOKEN_LIMIT || entry.active >= TOKEN_ACTIVE || this.active >= GLOBAL_ACTIVE)
      return undefined;
    const owned = entry;
    this.active++;
    owned.active++;
    return {
      release: () => {
        this.active--;
        owned.active--;
      },
    };
  }
}

async function readBounded(request: IncomingMessage, limit: number): Promise<Buffer | undefined> {
  return await new Promise<Buffer | undefined>((resolve, reject) => {
    let bytes = 0;
    let oversized = false;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      if (oversized) return;
      bytes += chunk.length;
      if (bytes > limit) {
        oversized = true;
        chunks.length = 0;
        resolve(undefined);
      } else chunks.push(chunk);
    });
    request.once("end", () => {
      if (!oversized) resolve(Buffer.concat(chunks));
    });
    request.once("error", reject);
    request.once("aborted", () => reject(new Error("Request aborted.")));
  });
}

function safeMessage(error: unknown): string {
  return error instanceof Error && error.message.length < 200
    ? error.message
    : "MCP hub request failed.";
}
