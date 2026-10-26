import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { HOST_PROTOCOL_VERSION } from "../src/features/connections/model/protocol";
import { assertSessionGrantScope, type SessionGrantScope } from "./session-authority";

export type SessionToolGroup = "conversation" | "runtime-logs" | "social";
export type SessionToolGrant = { token: string; expiresAt: number; scope: SessionGrantScope };
export type SessionToolCapability = { endpoint: string; token: string; dispose(): void };
const METHODS: Record<SessionToolGroup, string> = {
  conversation: "conversation.tools.call",
  "runtime-logs": "runtimeLogs.tools.call",
  social: "social.tools.call",
};
const MAX_INPUT = 8 * 1024 * 1024;
const MAX_OUTPUT = 16 * 1024 * 1024;
const REQUEST_TIMEOUT = 260_000;

type Entry = {
  group: SessionToolGroup;
  upstream: string;
  grant: SessionToolGrant;
  scope: SessionGrantScope;
  renew(scope: SessionGrantScope): Promise<SessionToolGrant>;
  refreshing?: Promise<void>;
  active: boolean;
  requests: Set<AbortController>;
};

async function inputBytes(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_INPUT) throw new Error("Session tool request is too large.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

async function outputBytes(response: Response): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return Buffer.concat(chunks);
      size += next.value.length;
      if (size > MAX_OUTPUT) throw new Error("Session tool response is too large.");
      chunks.push(Buffer.from(next.value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function untilCancelled(work: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error("Session tool request cancelled.");
  await new Promise<void>((resolve, reject) => {
    const cancel = () => reject(new Error("Session tool request cancelled."));
    signal.addEventListener("abort", cancel, { once: true });
    void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel));
  });
}

/** Child credentials stay stable while short-lived Host grants remain private.
 * Only an explicit pre-dispatch rejection permits a single replay. */
export class SessionToolsRelay {
  private readonly entries = new Map<string, Entry>();
  private server?: Server;
  private listening?: Promise<string>;
  private closing = false;
  private closeWork?: Promise<void>;
  private active = 0;

  constructor(private readonly requestTimeout = REQUEST_TIMEOUT) {}

  private endpoint(): Promise<string> {
    if (this.closing) return Promise.reject(new Error("Session tools relay is stopping."));
    if (this.listening) return this.listening;
    const server = createServer((request, response) => {
      const reject = (status: number) => {
        response.writeHead(status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        response.end(JSON.stringify({ error: "Session tools request rejected." }));
      };
      const token = request.headers.authorization?.replace(/^Bearer /, "");
      const entry = token ? this.entries.get(token) : undefined;
      if (!entry?.active || this.closing) {
        reject(401);
        request.resume();
        return;
      }
      const address = server.address();
      if (
        request.headers.origin !== undefined ||
        !address ||
        typeof address === "string" ||
        request.headers.host !== `127.0.0.1:${address.port}` ||
        !/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")
      ) {
        reject(403);
        request.resume();
        return;
      }
      if (
        request.method !== "POST" ||
        !["/rpc", `/mcp/${entry.group}`].includes(request.url ?? "")
      ) {
        reject(404);
        request.resume();
        return;
      }
      if (this.active >= 64 || entry.requests.size >= 16) {
        reject(429);
        request.resume();
        return;
      }
      this.active++;
      const controller = new AbortController();
      entry.requests.add(controller);
      const timer = setTimeout(() => {
        controller.abort();
        request.destroy();
      }, this.requestTimeout);
      const disconnected = () => {
        if (!response.writableFinished) controller.abort();
      };
      response.once("close", disconnected);
      void (async () => {
        try {
          const body = await inputBytes(request);
          const value = JSON.parse(body.toString("utf8"));
          const object = (input: unknown): input is Record<string, unknown> =>
            !!input && typeof input === "object" && !Array.isArray(input);
          if (!object(value)) throw new Error("Invalid session tool request.");
          if (request.url === "/rpc") {
            if (
              value.version !== HOST_PROTOCOL_VERSION ||
              !object(value.params) ||
              value.method !== METHODS[entry.group] ||
              value.environmentId !== entry.scope.environmentId
            )
              throw new Error("Session tools scope mismatch.");
          } else if (
            value.jsonrpc !== "2.0" ||
            typeof value.method !== "string" ||
            (value.params !== undefined && !object(value.params))
          )
            throw new Error("Invalid session MCP request.");
          const usedTokens = new Set<string>();
          const call = (grant: SessionToolGrant) => {
            usedTokens.add(grant.token);
            return fetch(`${entry.upstream}${request.url}`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${grant.token}`,
                "Content-Type": "application/json",
                Accept: "application/json, text/event-stream",
                ...(typeof request.headers["mcp-protocol-version"] === "string"
                  ? { "MCP-Protocol-Version": request.headers["mcp-protocol-version"] }
                  : {}),
              },
              body: new Uint8Array(body),
              redirect: "error",
              signal: controller.signal,
            });
          };
          const sent = entry.grant;
          let upstream = await call(sent);
          if (
            upstream.status === 401 &&
            upstream.headers.get("X-Bycoda-Auth-Stage") === "before-dispatch"
          ) {
            await upstream.body?.cancel();
            await untilCancelled(this.refresh(entry, sent.token), controller.signal);
            if (!entry.active || controller.signal.aborted)
              throw new Error("Session tools request cancelled.");
            upstream = await call(entry.grant);
          }
          const bytes = await outputBytes(upstream);
          if (!entry.active || controller.signal.aborted)
            throw new Error("Session tools request cancelled.");
          response.writeHead(upstream.status, {
            "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
            "Cache-Control": "no-store",
          });
          let text = bytes.toString("utf8");
          for (const token of usedTokens)
            text = text.replaceAll(token, "[session credential redacted]");
          response.end(text);
        } catch {
          if (!response.headersSent && !response.destroyed) reject(502);
          else response.destroy();
        } finally {
          clearTimeout(timer);
          response.off("close", disconnected);
          entry.requests.delete(controller);
          this.active--;
        }
      })();
    });
    server.maxConnections = 128;
    server.headersTimeout = 10_000;
    server.requestTimeout = 15_000;
    server.keepAliveTimeout = 1_000;
    this.server = server;
    this.listening = new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string")
          reject(new Error("Session tools relay unavailable."));
        else resolve(`http://127.0.0.1:${address.port}`);
      });
    });
    return this.listening;
  }

  private async refresh(entry: Entry, rejected: string): Promise<void> {
    if (!entry.active) throw new Error("Session tool capability retired.");
    if (entry.grant.token !== rejected) return;
    if (!entry.refreshing) {
      entry.refreshing = (async () => {
        const grant = await entry.renew(entry.scope);
        assertSessionGrantScope(entry.scope, grant.scope);
        if (!entry.active || this.closing || !grant.token)
          throw new Error("Session tool capability retired.");
        entry.grant = { ...grant, scope: entry.scope };
      })();
      void entry.refreshing
        .finally(() => {
          entry.refreshing = undefined;
        })
        .catch(() => undefined);
    }
    await entry.refreshing;
  }

  async create(options: {
    group: SessionToolGroup;
    upstream: string;
    grant: SessionToolGrant;
    renew(scope: SessionGrantScope): Promise<SessionToolGrant>;
  }): Promise<SessionToolCapability> {
    const parsed = new URL(options.upstream);
    if (
      parsed.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      throw new Error("Headless session tool relay requires the local Host.");
    const endpoint = await this.endpoint();
    if (this.closing || this.entries.size >= 4096)
      throw new Error("Session tools relay unavailable.");
    const token = randomBytes(32).toString("base64url");
    const scope = Object.freeze({ ...options.grant.scope });
    if (
      Object.keys(scope).sort().join(",") !== "environmentId,projectId,provider,sessionId" ||
      !Object.values(scope).every((value) => typeof value === "string" && value.length > 0)
    )
      throw new Error("Invalid session tools scope.");
    assertSessionGrantScope(scope, scope);
    const entry: Entry = {
      group: options.group,
      upstream: parsed.origin,
      grant: { ...options.grant, scope },
      scope,
      renew: options.renew,
      active: true,
      requests: new Set(),
    };
    this.entries.set(token, entry);
    return {
      endpoint,
      token,
      dispose: () => {
        entry.active = false;
        if (this.entries.get(token) === entry) this.entries.delete(token);
        for (const request of entry.requests) request.abort();
      },
    };
  }

  close(): Promise<void> {
    if (this.closeWork) return this.closeWork;
    this.closing = true;
    for (const entry of this.entries.values()) {
      entry.active = false;
      for (const request of entry.requests) request.abort();
    }
    this.entries.clear();
    this.closeWork = (async () => {
      await this.listening?.catch(() => undefined);
      if (this.server)
        await new Promise<void>((resolve) => {
          this.server!.close(() => resolve());
          this.server!.closeAllConnections();
        });
    })();
    return this.closeWork;
  }
}
