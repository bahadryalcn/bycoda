import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import type { DevServerDetails } from "../../src/features/host-tools/devServerTypes";
import { DevServerAccess } from "./dev-server-access";
import {
  attachDevServerTunnel,
  parseTunnelQuery,
  RequestHeadRewriter,
  ResponseHeadRewriter,
  rewriteRequestHead,
  rewriteResponseHead,
  TUNNEL_SUBPROTOCOL,
  validTunnelAlias,
  type DevServerTunnelOptions,
} from "./dev-server-tunnel";

const TOKEN = "T".repeat(43);
const ALIAS = `b${"0123456789abcdef".repeat(2)}.test`;
const cleanups: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const text = (buffers: Buffer[]) => Buffer.concat(buffers).toString("latin1");

describe("rewriteRequestHead", () => {
  const head = (lines: string[]) => Buffer.from(lines.join("\r\n"), "latin1");
  const rewrite = (lines: string[]) => rewriteRequestHead(head(lines), ALIAS, 5173);

  it("rewrites Host, Origin and Referer and forces Connection: close", () => {
    const result = rewrite([
      "GET /a?b=1 HTTP/1.1",
      `Host: ${ALIAS}:5173`,
      `Origin: http://${ALIAS}:5173`,
      `Referer: http://${ALIAS}:5173/page?x=1`,
      "Connection: keep-alive",
      "Accept: */*",
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.head.toString("latin1")).toBe(
      [
        "GET /a?b=1 HTTP/1.1",
        "Host: localhost:5173",
        "Origin: http://localhost:5173",
        "Referer: http://localhost:5173/page?x=1",
        "Accept: */*",
        "Connection: close",
        "",
        "",
      ].join("\r\n"),
    );
    expect(result.upgrade).toBe(false);
  });

  it("leaves foreign origins alone and does not match a longer authority", () => {
    const result = rewrite([
      "GET / HTTP/1.1",
      `Host: ${ALIAS}:5173`,
      `Origin: http://${ALIAS}:51730`,
      "Referer: https://example.com/",
    ]);
    expect(result.ok && result.head.toString("latin1")).toContain(`Origin: http://${ALIAS}:51730`);
    expect(result.ok && result.head.toString("latin1")).toContain("Referer: https://example.com/");
  });

  it("passes a WebSocket upgrade without forcing Connection: close", () => {
    const result = rewrite([
      "GET /hmr HTTP/1.1",
      `Host: ${ALIAS}:5173`,
      "Connection: Upgrade",
      "Upgrade: websocket",
    ]);
    expect(result.ok && result.upgrade).toBe(true);
    expect(result.ok && result.head.toString("latin1")).toContain("Connection: Upgrade");
    expect(result.ok && result.head.toString("latin1")).not.toContain("Connection: close");
  });

  it.each([
    ["wrong host", ["GET / HTTP/1.1", "Host: evil.test:5173"]],
    ["wrong port", ["GET / HTTP/1.1", `Host: ${ALIAS}:80`]],
    ["missing host", ["GET / HTTP/1.1", "Accept: */*"]],
    ["duplicate host", ["GET / HTTP/1.1", `Host: ${ALIAS}:5173`, `Host: ${ALIAS}:5173`]],
    ["bad request line", ["GET /\tHTTP/1.1", `Host: ${ALIAS}:5173`]],
    ["connect method", ["CONNECT x:1 HTTP/1.1", `Host: ${ALIAS}:5173`]],
    ["obs-fold", ["GET / HTTP/1.1", `Host: ${ALIAS}:5173`, " folded: x"]],
    [
      "smuggling",
      ["POST / HTTP/1.1", `Host: ${ALIAS}:5173`, "Content-Length: 1", "Transfer-Encoding: chunked"],
    ],
    ["bad length", ["POST / HTTP/1.1", `Host: ${ALIAS}:5173`, "Content-Length: 1x"]],
    ["gzip encoding", ["POST / HTTP/1.1", `Host: ${ALIAS}:5173`, "Transfer-Encoding: gzip"]],
  ])("rejects %s", (_name, lines) => {
    expect(rewrite(lines).ok).toBe(false);
  });
});

describe("RequestHeadRewriter", () => {
  const get = (path: string, extra = "") =>
    `GET ${path} HTTP/1.1\r\nHost: ${ALIAS}:5173\r\n${extra}\r\n`;

  it("handles heads split across arbitrary chunks", () => {
    const rewriter = new RequestHeadRewriter(ALIAS, 5173);
    const input = Buffer.from(get("/split", `Origin: http://${ALIAS}:5173\r\n`));
    const out: Buffer[] = [];
    for (let index = 0; index < input.length; index += 3) {
      const result = rewriter.push(input.subarray(index, index + 3));
      expect(result.error).toBeUndefined();
      out.push(...result.out);
    }
    expect(text(out)).toContain("Host: localhost:5173\r\n");
    expect(text(out)).toContain("Origin: http://localhost:5173\r\n");
    expect(text(out).endsWith("Connection: close\r\n\r\n")).toBe(true);
  });

  it("rewrites the second request on the same connection after a Content-Length body", () => {
    const rewriter = new RequestHeadRewriter(ALIAS, 5173);
    const body = "Host: not-a-header";
    const input =
      `POST /a HTTP/1.1\r\nHost: ${ALIAS}:5173\r\nContent-Length: ${body.length}\r\n\r\n${body}` +
      get("/b");
    const result = rewriter.push(Buffer.from(input));
    expect(result.error).toBeUndefined();
    const output = text(result.out);
    expect(output).toContain(body);
    expect(output.match(/Host: localhost:5173/g)).toHaveLength(2);
    expect(output).not.toContain(ALIAS);
  });

  it("frames chunked bodies and keeps rewriting afterwards", () => {
    const rewriter = new RequestHeadRewriter(ALIAS, 5173);
    const chunked = `POST /a HTTP/1.1\r\nHost: ${ALIAS}:5173\r\nTransfer-Encoding: chunked\r\n\r\n4;ext=1\r\nabcd\r\n0\r\nX-Trailer: 1\r\n\r\n`;
    const input = Buffer.from(chunked + get("/next"));
    const out: Buffer[] = [];
    for (let index = 0; index < input.length; index += 7)
      out.push(...rewriter.push(input.subarray(index, index + 7)).out);
    const output = text(out);
    expect(output).toContain("4;ext=1\r\nabcd\r\n0\r\nX-Trailer: 1\r\n\r\n");
    expect(output.match(/Host: localhost:5173/g)).toHaveLength(2);
  });

  it("goes raw after an upgrade head", () => {
    const rewriter = new RequestHeadRewriter(ALIAS, 5173);
    const input = Buffer.concat([
      Buffer.from(
        `GET /hmr HTTP/1.1\r\nHost: ${ALIAS}:5173\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
      ),
      Buffer.from(`Host: ${ALIAS}:5173\r\n\r\n`),
      Buffer.from([0x81, 0x80, 1, 2, 3, 4]),
    ]);
    const result = rewriter.push(input);
    expect(result.error).toBeUndefined();
    const output = Buffer.concat(result.out);
    expect(output.includes(Buffer.from(`Host: ${ALIAS}:5173\r\n\r\n`))).toBe(true);
    expect(output.subarray(output.length - 6)).toEqual(Buffer.from([0x81, 0x80, 1, 2, 3, 4]));
  });

  it("rejects oversize heads, with and without a terminator", () => {
    const filler = `X-Fill: ${"a".repeat(70 * 1024)}\r\n`;
    expect(
      new RequestHeadRewriter(ALIAS, 5173).push(Buffer.from(get("/", filler))).error,
    ).toBeDefined();
    expect(
      new RequestHeadRewriter(ALIAS, 5173).push(Buffer.from(`GET / HTTP/1.1\r\n${filler}`)).error,
    ).toBeDefined();
  });

  it("rejects a bad Host and stays failed", () => {
    const rewriter = new RequestHeadRewriter(ALIAS, 5173);
    expect(rewriter.push(Buffer.from("GET / HTTP/1.1\r\nHost: evil.test:5173\r\n\r\n")).error).toBe(
      "host",
    );
    expect(rewriter.push(Buffer.from(get("/"))).error).toBeDefined();
  });

  it("rejects an invalid chunk size", () => {
    const rewriter = new RequestHeadRewriter(ALIAS, 5173);
    const input = `POST / HTTP/1.1\r\nHost: ${ALIAS}:5173\r\nTransfer-Encoding: chunked\r\n\r\nzz\r\n`;
    expect(rewriter.push(Buffer.from(input)).error).toBe("chunk");
  });
});

describe("response rewriting", () => {
  it("rewrites loopback Location values to the alias", () => {
    for (const origin of ["http://localhost:5173", "http://127.0.0.1:5173"]) {
      expect(
        rewriteResponseHead(`HTTP/1.1 302 Found\r\nLocation: ${origin}/login?x=1`, ALIAS, 5173),
      ).toBe(`HTTP/1.1 302 Found\r\nLocation: http://${ALIAS}:5173/login?x=1`);
    }
    const other = "HTTP/1.1 302 Found\r\nLocation: http://localhost:51730/x";
    expect(rewriteResponseHead(other, ALIAS, 5173)).toBe(other);
    const external = "HTTP/1.1 302 Found\r\nLocation: https://example.com/";
    expect(rewriteResponseHead(external, ALIAS, 5173)).toBe(external);
  });

  it("rewrites only the first final head, across chunk splits", () => {
    const rewriter = new ResponseHeadRewriter(ALIAS, 5173);
    const body = "Location: http://localhost:5173/body\r\n\r\n";
    const input = Buffer.from(
      `HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 302 Found\r\nLocation: http://localhost:5173/a\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
    );
    const out: Buffer[] = [];
    for (let index = 0; index < input.length; index += 5)
      out.push(...rewriter.push(input.subarray(index, index + 5)));
    const output = text(out);
    expect(output).toContain(`Location: http://${ALIAS}:5173/a`);
    expect(output).toContain("Location: http://localhost:5173/body");
  });
});

describe("tunnel query and alias", () => {
  const query = (overrides: Record<string, string | undefined> = {}) => {
    const params = new URLSearchParams({
      projectId: "p",
      id: "dev",
      pid: "42",
      startedAt: "2026-01-01T00:00:00Z",
      port: "5173",
      address: "127.0.0.1",
      alias: ALIAS,
    });
    for (const [key, value] of Object.entries(overrides))
      if (value === undefined) params.delete(key);
      else params.set(key, value);
    return `/ws-tunnel?${params}`;
  };

  it("parses a full query", () => {
    expect(parseTunnelQuery(query())).toMatchObject({ projectId: "p", pid: 42, port: 5173 });
  });

  it.each([
    ["missing key", { id: undefined }],
    ["bad port", { port: "70000" }],
    ["zero pid", { pid: "0" }],
    ["alias outside .test/.localhost", { alias: "abc.example" }],
    ["alias uppercase", { alias: "ABC.test" }],
  ])("rejects %s", (_name, overrides) => {
    expect(parseTunnelQuery(query(overrides))).toBeNull();
  });

  it("rejects duplicate and unknown keys", () => {
    expect(parseTunnelQuery(`${query()}&id=other`)).toBeNull();
    expect(parseTunnelQuery(`${query()}&extra=1`)).toBeNull();
  });

  it("validates aliases", () => {
    expect(validTunnelAlias("abc.localhost")).toBe(true);
    expect(validTunnelAlias("abc.test")).toBe(true);
    expect(validTunnelAlias("test")).toBe(false);
    expect(validTunnelAlias(`${"a".repeat(70)}.test`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration: a real loopback HTTP dev server reached through the tunnel.
// ---------------------------------------------------------------------------

type Seen = { host?: string; origin?: string; connection?: string; url?: string };

async function fixture(options: { limits?: DevServerTunnelOptions["limits"] } = {}) {
  const seen: Seen[] = [];
  const dev = createServer((request: IncomingMessage, response) => {
    seen.push({
      host: request.headers.host,
      origin: request.headers.origin,
      connection: request.headers.connection,
      url: request.url,
    });
    if (request.url === "/redirect") {
      response.writeHead(302, { Location: `http://localhost:${devPort()}/landing` }).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "text/plain" }).end(`hello ${request.url}`);
  });
  const echo = new WebSocketServer({ server: dev });
  echo.on("connection", (socket) =>
    socket.on("message", (data, binary) => socket.send(data, { binary })),
  );
  await new Promise<void>((resolve) => dev.listen(0, "127.0.0.1", resolve));
  const fixedPort = (dev.address() as AddressInfo).port;
  const devPort = () => fixedPort;
  cleanups.push(async () => {
    for (const client of echo.clients) client.terminate();
    dev.closeAllConnections();
    await new Promise<void>((resolve) => dev.close(() => resolve()));
  });

  const revoked = { value: false };
  const core = createServer((_request, response) => response.writeHead(404).end());
  await new Promise<void>((resolve) => core.listen(0, "127.0.0.1", resolve));
  const corePort = (core.address() as AddressInfo).port;
  const details: DevServerDetails = {
    server: {
      id: "dev",
      projectId: "project",
      process: { pid: 42, startedAt: "birth", name: "node" },
      endpoints: [
        { port: devPort(), address: "127.0.0.1", url: `http://127.0.0.1:${devPort()}` },
        { port: corePort, address: "127.0.0.1", url: `http://127.0.0.1:${corePort}` },
      ],
      managed: false,
      state: "running",
      name: "dev",
      association: "cwd",
      logsAvailable: false,
    },
    descendants: [],
    affectedPorts: [devPort()],
  };
  const access = new DevServerAccess(
    async () => details,
    () => corePort,
  );
  const tunnel = attachDevServerTunnel({
    server: core,
    authenticate: async (token) =>
      token === TOKEN && !revoked.value
        ? { id: "device", authorized: async () => !revoked.value }
        : null,
    endpoint: async (params) => await access.endpoint(params),
    limits: options.limits,
  });
  cleanups.push(async () => {
    await tunnel.close();
    access.close();
    core.closeAllConnections();
    await new Promise<void>((resolve) => core.close(() => resolve()));
  });

  const open = (
    input: { port?: number; pid?: number; token?: string | null; startedAt?: string } = {},
  ) => {
    const port = input.port ?? devPort();
    const query = new URLSearchParams({
      projectId: "project",
      id: "dev",
      pid: String(input.pid ?? 42),
      startedAt: input.startedAt ?? "birth",
      port: String(port),
      address: "127.0.0.1",
      alias: ALIAS,
    });
    const client = new WebSocket(
      `ws://127.0.0.1:${corePort}/ws-tunnel?${query}`,
      TUNNEL_SUBPROTOCOL,
      {
        headers: input.token === null ? {} : { Authorization: `Bearer ${input.token ?? TOKEN}` },
      },
    );
    client.on("error", () => {});
    cleanups.push(() => client.terminate());
    return { client, port };
  };
  const failure = (client: WebSocket) =>
    new Promise<{ status: number; code?: string }>((resolve, reject) => {
      client.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve({
          status: response.statusCode!,
          code: response.headers["x-bycoda-tunnel-error"] as string | undefined,
        });
      });
      client.once("open", () => reject(new Error("Tunnel unexpectedly opened.")));
    });
  const opened = (client: WebSocket) =>
    new Promise<void>((resolve, reject) => {
      client.once("open", () => resolve());
      client.once("unexpected-response", (_request, response) =>
        reject(new Error(`Tunnel refused with ${response.statusCode}.`)),
      );
    });
  const collect = (client: WebSocket) =>
    new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      client.on("message", (data) => chunks.push(data as Buffer));
      client.once("close", () => resolve(Buffer.concat(chunks).toString("latin1")));
    });
  return { tunnel, dev, devPort, core, corePort, seen, revoked, open, failure, opened, collect };
}

describe("dev server tunnel", () => {
  it("serves a GET with the Host rewritten and the connection closed after one response", async () => {
    const input = await fixture();
    const { client, port } = input.open();
    await input.opened(client);
    const response = input.collect(client);
    client.send(
      Buffer.from(
        `GET /hi HTTP/1.1\r\nHost: ${ALIAS}:${port}\r\nOrigin: http://${ALIAS}:${port}\r\nConnection: keep-alive\r\n\r\n`,
      ),
    );
    const output = await response;
    expect(output).toContain("hello /hi");
    expect(input.seen).toEqual([
      {
        host: `localhost:${port}`,
        origin: `http://localhost:${port}`,
        connection: "close",
        url: "/hi",
      },
    ]);
  });

  it("rewrites a Location redirect back to the alias", async () => {
    const input = await fixture();
    const { client, port } = input.open();
    await input.opened(client);
    const response = input.collect(client);
    client.send(Buffer.from(`GET /redirect HTTP/1.1\r\nHost: ${ALIAS}:${port}\r\n\r\n`));
    expect(await response).toContain(`Location: http://${ALIAS}:${port}/landing`);
  });

  it("relays a WebSocket upgrade and echoes frames", async () => {
    const input = await fixture();
    const { client, port } = input.open();
    await input.opened(client);
    const received: Buffer[] = [];
    client.on("message", (data) => received.push(data as Buffer));
    client.send(
      Buffer.from(
        `GET /hmr HTTP/1.1\r\nHost: ${ALIAS}:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`,
      ),
    );
    await expect
      .poll(() => Buffer.concat(received).toString("latin1"), { timeout: 5000 })
      .toContain("101 Switching Protocols");
    expect(input.seen).toEqual([]);
    // Masked client text frame "hi" -> unmasked echo.
    const mask = Buffer.from([1, 2, 3, 4]);
    const payload = Buffer.from("hi").map((byte, index) => byte ^ mask[index % 4]);
    received.length = 0;
    client.send(Buffer.concat([Buffer.from([0x81, 0x80 | 2]), mask, payload]));
    await expect
      .poll(() => Buffer.concat(received), { timeout: 5000 })
      .toEqual(Buffer.from([0x81, 2, ...Buffer.from("hi")]));
  });

  it("answers 401 without a bearer token and for an unknown token", async () => {
    const input = await fixture();
    expect(await input.failure(input.open({ token: null }).client)).toEqual({
      status: 401,
      code: "unauthorized",
    });
    expect(await input.failure(input.open({ token: "U".repeat(43) }).client)).toEqual({
      status: 401,
      code: "unauthorized",
    });
  });

  it("answers 403 for a mismatched process identity", async () => {
    const input = await fixture();
    expect(await input.failure(input.open({ pid: 43 }).client)).toEqual({
      status: 403,
      code: "identity",
    });
    expect(await input.failure(input.open({ startedAt: "other" }).client)).toEqual({
      status: 403,
      code: "identity",
    });
  });

  it("refuses the Host's own port", async () => {
    const input = await fixture();
    const result = await input.failure(input.open({ port: input.corePort }).client);
    expect(result.status).toBe(403);
  });

  it("answers 429 past the per-device limit", async () => {
    const input = await fixture({ limits: { perDevice: 1 } });
    const first = input.open();
    await input.opened(first.client);
    expect(await input.failure(input.open().client)).toEqual({ status: 429, code: "limit" });
  });

  it("answers 502 when the dev server refuses the connection", async () => {
    const input = await fixture();
    const { client } = input.open();
    await input.opened(client);
    client.terminate();
    input.dev.closeAllConnections();
    await new Promise<void>((resolve) => input.dev.close(() => resolve()));
    expect(await input.failure(input.open().client)).toEqual({ status: 502, code: "connect" });
  });

  it("closes with 1003 on a text frame and 1008 on a bad Host", async () => {
    const input = await fixture();
    const text = input.open();
    await input.opened(text.client);
    const textClosed = new Promise<number>((resolve) =>
      text.client.once("close", (code) => resolve(code)),
    );
    text.client.send("not binary");
    expect(await textClosed).toBe(1003);

    const bad = input.open();
    await input.opened(bad.client);
    const badClosed = new Promise<number>((resolve) =>
      bad.client.once("close", (code) => resolve(code)),
    );
    bad.client.send(Buffer.from(`GET / HTTP/1.1\r\nHost: localhost:${bad.port}\r\n\r\n`));
    expect(await badClosed).toBe(1008);
    expect(input.seen).toEqual([]);
  });

  it("closes an open tunnel once the device is revoked", async () => {
    const input = await fixture({ limits: { reauthMs: 40 } });
    const { client } = input.open();
    await input.opened(client);
    const closed = new Promise<number>((resolve) => client.once("close", (code) => resolve(code)));
    input.revoked.value = true;
    expect(await closed).toBe(1008);
  });

  it("closes idle tunnels", async () => {
    const input = await fixture({ limits: { idleMs: 60 } });
    const { client } = input.open();
    await input.opened(client);
    const closed = new Promise<number>((resolve) => client.once("close", (code) => resolve(code)));
    expect(await closed).toBe(1000);
  });

  it("closes every tunnel when the Host shuts the endpoint down", async () => {
    const input = await fixture();
    const { client } = input.open();
    await input.opened(client);
    const closed = new Promise<number>((resolve) => client.once("close", (code) => resolve(code)));
    await input.tunnel.close();
    expect(await closed).toBe(1001);
  });
});
