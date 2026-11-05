import { afterEach, expect, it, vi } from "vitest";
import { createServer as createHttpServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { connect as connectTcp } from "node:net";
import { WebSocket, type ClientOptions } from "ws";
import { MobileTlsAuthority } from "./mobile-tls";
import { createMobileWssGateway, type MobileWssOptions } from "./mobile-wss";
import { createLanGateway, MobileLanAccess } from "../mobile/mobile-lan";
import { attachHostWebSocketTransport } from "../transport/ws/server";
import { createHostBulkHandler, HostBulkTransfers } from "../transport/http/bulk";
import { WS_SUBPROTOCOL } from "../../src/shared/model/host-contracts";

const TOKEN = "A".repeat(43);
const ENVIRONMENT = "mobile-wss.fixture";
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function directory() {
  const folder = await mkdtemp(join(tmpdir(), "bycoda-mobile-wss-"));
  cleanups.push(async () => {
    const target = resolve(folder);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("bycoda-mobile-wss-"))
      throw new Error("Unsafe fixture cleanup path.");
    await rm(target, { recursive: true, force: true });
  });
  return folder;
}

async function fixture(maxSocketsPerDevice = 4, limits?: MobileWssOptions["limits"]) {
  const folder = await directory();
  const authority = new MobileTlsAuthority(join(folder, "mobile-ca.json"), ENVIRONMENT);
  const material = await authority.issue(["127.0.0.1"]);
  const revoked = { value: false };
  const transfers = new HostBulkTransfers({ environmentId: ENVIRONMENT });
  cleanups.push(async () => transfers.close());
  const requests: Array<{
    url?: string;
    host?: string;
    origin?: string;
    authorization?: string;
    cookie?: string;
  }> = [];
  const bulk = createHostBulkHandler({
    transfers,
    authenticate: async (token) => (token === TOKEN && !revoked.value ? "paired.device" : null),
  });
  const core = createHttpServer((request, response) => {
    requests.push({
      url: request.url,
      host: request.headers.host,
      origin: request.headers.origin,
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
    });
    void bulk(request, response).then((handled) => {
      if (!handled) response.writeHead(404).end();
    });
  });
  core.on("upgrade", (request) =>
    requests.push({
      url: request.url,
      host: request.headers.host,
      origin: request.headers.origin,
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
    }),
  );
  const transport = attachHostWebSocketTransport({
    server: core,
    environmentId: ENVIRONMENT,
    authenticate: async (token) =>
      token === TOKEN && !revoked.value
        ? { id: "paired.device", authorized: () => !revoked.value }
        : null,
    // projects.list results are schema-validated by the transport: an array, not an object.
    dispatch: async () => [],
    limits: { maxSocketsPerDevice },
  });
  await new Promise<void>((done) => core.listen(0, "127.0.0.1", done));
  const internalPort = (core.address() as AddressInfo).port;
  cleanups.push(async () => {
    await transport.close();
    core.closeAllConnections();
    await new Promise<void>((done) => core.close(() => done()));
  });
  const gateway = createMobileWssGateway({
    address: "127.0.0.1",
    getPort: () => internalPort,
    material,
    limits,
  });
  await new Promise<void>((done) => gateway.listen(0, "127.0.0.1", done));
  cleanups.push(async () => {
    gateway.closeAllConnections();
    await new Promise<void>((done) => gateway.close(() => done()));
  });
  const port = (gateway.address() as AddressInfo).port;
  const socket = async (extra: ClientOptions = {}, direct = false) => {
    const client = new WebSocket(
      `${direct ? "ws" : "wss"}://127.0.0.1:${direct ? internalPort : port}/ws`,
      WS_SUBPROTOCOL,
      {
        ca: material.caCertificatePem,
        rejectUnauthorized: true,
        headers: { Authorization: `Bearer ${TOKEN}` },
        ...extra,
      },
    );
    client.on("error", () => {});
    cleanups.push(async () => {
      if (client.readyState !== WebSocket.CLOSED) {
        const closed = once(client, "close");
        client.terminate();
        await closed;
      }
    });
    await once(client, "open");
    return client;
  };
  const request = (
    path: string,
    options: { method?: string; headers?: Record<string, string>; ca?: string } = {},
  ) =>
    new Promise<{ status: number; bytes: Buffer }>((done, reject) => {
      const call = httpsRequest(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: options.method ?? "GET",
          ca: options.ca ?? material.caCertificatePem,
          rejectUnauthorized: true,
          servername: "",
          agent: false,
          headers: { Authorization: `Bearer ${TOKEN}`, ...options.headers },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("error", reject);
          response.on("end", () =>
            done({ status: response.statusCode!, bytes: Buffer.concat(chunks) }),
          );
        },
      );
      call.on("error", reject);
      call.end();
    });
  return {
    authority,
    material,
    gateway,
    internalPort,
    port,
    socket,
    request,
    transfers,
    requests,
    revoked,
  };
}
async function rpc(socket: WebSocket, id: string, method: string, params: unknown) {
  const response = once(socket, "message");
  socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  const [data] = await response;
  return JSON.parse(String(data));
}
async function hello(socket: WebSocket) {
  return rpc(socket, "hello.1", "connection.hello", {
    environmentId: ENVIRONMENT,
    clientId: "mobile.fixture",
    clientKind: "mobile",
    supportedWireVersions: [2],
    supportedSchemaVersions: [1],
  });
}

it("proxies real verified TLS WS through the existing authenticated Host and rewrites only the native route", async () => {
  const input = await fixture();
  const socket = await input.socket({
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Cookie: "discard-me",
      "X-Forwarded-Host": "evil.invalid",
    },
  });
  expect((await hello(socket)).result.environmentId).toBe(ENVIRONMENT);
  expect((await rpc(socket, "projects.1", "projects.list", {})).result).toEqual([]);
  expect(input.requests).toContainEqual({
    url: "/ws",
    host: `127.0.0.1:${input.internalPort}`,
    authorization: `Bearer ${TOKEN}`,
    origin: undefined,
    cookie: undefined,
  });
});

it("uses the same core device socket quota as a direct desktop connection", async () => {
  const input = await fixture(1);
  const desktop = await input.socket({}, true);
  await hello(desktop);
  await expect(input.socket()).rejects.toThrow(/429/);
});

it("forwards bounded authenticated bulk bytes and preserves revocation checks", async () => {
  const input = await fixture();
  const lease = input.transfers.begin("paired.device", "fixture.resource");
  const result = input.transfers.encode(lease, { payload: "x".repeat(70_000) }, 100) as {
    $bulk: { transferId: string };
  };
  const path = `/ws-bulk/${result.$bulk.transferId}?offset=0`;
  const response = await input.request(path);
  expect(response.status).toBe(200);
  expect(response.bytes.length).toBe(65536);
  input.revoked.value = true;
  expect((await input.request(path)).status).toBe(401);
});

it("rejects arbitrary Host, Origin, routes, methods and credential URLs before reaching the Host", async () => {
  const input = await fixture();
  for (const [path, options] of [
    ["/rpc", {}],
    ["/ws", {}],
    ["/ws-bulk/id?offset=0&token=secret", {}],
    ["/ws-bulk/id?offset=0", { method: "POST" }],
    ["/ws-bulk/id?offset=0", { headers: { Host: "evil.invalid" } }],
    ["/ws-bulk/id?offset=0", { headers: { Origin: "https://evil.invalid" } }],
  ] as const)
    expect((await input.request(path, options)).status).toBe(403);
  await expect(
    input.socket({ headers: { Authorization: `Bearer ${TOKEN}`, Origin: "https://evil.invalid" } }),
  ).rejects.toThrow(/403/);
  expect(input.requests).toEqual([]);
});

it("rejects untrusted TLS and closes upgraded ingress without stopping Host execution", async () => {
  const input = await fixture();
  const other = new MobileTlsAuthority(join(await directory(), "other-ca.json"), "foreign.host");
  const foreign = await other.issue(["127.0.0.1"]);
  await expect(
    input.request("/ws-bulk/id?offset=0", { ca: foreign.caCertificatePem }),
  ).rejects.toThrow();
  const socket = await input.socket();
  await hello(socket);
  const closed = once(socket, "close");
  input.gateway.closeAllConnections();
  await closed;
  const desktop = await input.socket({}, true);
  expect((await hello(desktop)).result.environmentId).toBe(ENVIRONMENT);
});

it("keeps owner enablement, legacy LAN identity and persisted WSS bootstrap lifecycle together", async () => {
  const folder = await directory();
  const file = join(folder, "mobile-lan.json");
  const caFile = join(folder, "mobile-ca.json");
  const authority = new MobileTlsAuthority(caFile, ENVIRONMENT);
  const bindings: Array<[number, string]> = [];
  const fake = () => {
    const server = createHttpServer();
    vi.spyOn(server, "listen").mockImplementation((...args: unknown[]) => {
      bindings.push([Number(args[0]), String(args[1])]);
      (args.at(-1) as () => void)();
      return server;
    });
    vi.spyOn(server, "address").mockReturnValue({
      address: "192.168.1.20",
      port: 43210,
      family: "IPv4",
    });
    return server;
  };
  const makeLegacy: typeof createLanGateway = () => fake();
  const makeSecure: typeof createMobileWssGateway = (options) => {
    const server = createMobileWssGateway(options);
    vi.spyOn(server, "listen").mockImplementation((...args: unknown[]) => {
      bindings.push([Number(args[0]), String(args[1])]);
      (args.at(-1) as () => void)();
      return server;
    });
    vi.spyOn(server, "address").mockReturnValue({
      address: "192.168.1.20",
      port: 43211,
      family: "IPv4",
    });
    return server;
  };
  const access = new MobileLanAccess(
    file,
    ENVIRONMENT,
    () => 3776,
    () => ["192.168.1.20"],
    makeLegacy,
    { tlsAuthority: authority, makeWssGateway: makeSecure },
  );
  cleanups.push(async () => access.close());
  expect((await access.status()).tls).toBeUndefined();
  await expect(readFile(caFile)).rejects.toMatchObject({ code: "ENOENT" });
  const first = await access.enable();
  expect(first.state).toBe("ready");
  expect(first.tls?.endpoint).toBe("wss://192.168.1.20:43211/ws");
  expect(JSON.stringify(first)).not.toMatch(/PRIVATE KEY/);
  expect(JSON.parse(await readFile(file, "utf8")).tlsPort).toBe(43211);
  await access.close();
  const resumed = new MobileLanAccess(
    file,
    ENVIRONMENT,
    () => 3776,
    () => ["192.168.1.20"],
    makeLegacy,
    { tlsAuthority: new MobileTlsAuthority(caFile, ENVIRONMENT), makeWssGateway: makeSecure },
  );
  cleanups.push(async () => resumed.close());
  await resumed.start();
  const second = await resumed.status();
  expect(second.lanKey).toBe(first.lanKey);
  expect(second.tls?.caSpkiPin).toBe(first.tls?.caSpkiPin);
  expect(bindings).toEqual([
    [0, "192.168.1.20"],
    [0, "192.168.1.20"],
    [43210, "192.168.1.20"],
    [43211, "192.168.1.20"],
  ]);
  expect((await resumed.disable()).tls).toBeUndefined();
  expect(JSON.parse(await readFile(file, "utf8")).enabled).toBe(false);
});

it("bounds raw connections before TLS handshakes complete", async () => {
  const input = await fixture(4, { maxConnections: 2 });
  const firstAccepted = once(input.gateway, "connection");
  const first = connectTcp({ host: "127.0.0.1", port: input.port });
  first.on("error", () => {});
  cleanups.push(async () => first.destroy());
  await firstAccepted;
  const secondAccepted = once(input.gateway, "connection");
  const second = connectTcp({ host: "127.0.0.1", port: input.port });
  second.on("error", () => {});
  cleanups.push(async () => second.destroy());
  await secondAccepted;
  const third = connectTcp({ host: "127.0.0.1", port: input.port });
  third.on("error", () => {});
  cleanups.push(async () => third.destroy());
  await once(third, "close");
  expect(first.destroyed).toBe(false);
  expect(second.destroyed).toBe(false);
});

it("bounds pending upgrades and releases ingress admission after an upstream timeout", async () => {
  const authority = new MobileTlsAuthority(join(await directory(), "ca.json"), ENVIRONMENT);
  const material = await authority.issue(["127.0.0.1"]);
  const core = createHttpServer();
  const held = new Set<import("node:stream").Duplex>();
  core.on("upgrade", (_request, socket) => {
    held.add(socket);
    socket.once("close", () => held.delete(socket));
    socket.once("end", () => socket.destroy());
    socket.resume();
  });
  await new Promise<void>((done) => core.listen(0, "127.0.0.1", done));
  cleanups.push(async () => {
    for (const socket of held) socket.destroy();
    core.closeAllConnections();
    await new Promise<void>((done) => core.close(() => done()));
  });
  const gateway = createMobileWssGateway({
    address: "127.0.0.1",
    getPort: () => (core.address() as AddressInfo).port,
    material,
    limits: { maxPending: 1, handshakeTimeoutMs: 500 },
  });
  await new Promise<void>((done) => gateway.listen(0, "127.0.0.1", done));
  cleanups.push(async () => {
    gateway.closeAllConnections();
    await new Promise<void>((done) => gateway.close(() => done()));
  });
  const rejected = () =>
    new Promise<number>((done, reject) => {
      const client = new WebSocket(
        `wss://127.0.0.1:${(gateway.address() as AddressInfo).port}/ws`,
        WS_SUBPROTOCOL,
        {
          ca: material.caCertificatePem,
          rejectUnauthorized: true,
          headers: { Authorization: `Bearer ${TOKEN}` },
        },
      );
      client.on("error", reject);
      client.once("unexpected-response", (_request, response) => {
        response.resume();
        done(response.statusCode!);
        client.terminate();
      });
      client.once("open", () => {
        client.terminate();
        reject(new Error("Unexpected successful upgrade"));
      });
    });
  const accepted = once(core, "upgrade");
  const first = rejected();
  const [, socket] = await accepted;
  const closed = once(socket, "close");
  expect(await rejected()).toBe(429);
  expect(await first).toBe(503);
  await closed;
  const anotherAccepted = once(core, "upgrade");
  const another = rejected();
  await anotherAccepted;
  expect(await another).toBe(503);
});
