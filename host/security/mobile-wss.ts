import { createHash } from "node:crypto";
import {
  request as httpRequest,
  STATUS_CODES,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer } from "node:https";
import { isIP } from "node:net";
import type { Duplex } from "node:stream";
import { WS_LIMITS, WS_SUBPROTOCOL } from "../../src/shared/model/host-contracts";
import type { MobileTlsMaterial } from "./mobile-tls";

export type MobileWssOptions = {
  address: string;
  getPort: () => number;
  material: MobileTlsMaterial;
  limits?: Partial<{ maxConnections: number; maxPending: number; handshakeTimeoutMs: number }>;
};

const token = /^Bearer [A-Za-z0-9_-]{43}$/;
const bulkPath = /^\/ws-bulk\/[A-Za-z0-9_-]{1,200}\?offset=(0|[1-9][0-9]{0,15})$/;
const singular = new Set([
  "host",
  "authorization",
  "origin",
  "content-length",
  "transfer-encoding",
  "connection",
  "upgrade",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-protocol",
]);
const authority = (address: string, port: number) =>
  `${isIP(address) === 6 ? `[${address}]` : address}:${port}`;

function uniqueHeaders(request: IncomingMessage): boolean {
  const found = new Set<string>();
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index].toLowerCase();
    if (singular.has(name) && found.has(name)) return false;
    found.add(name);
  }
  return true;
}

function rejectSocket(socket: Duplex, status: number) {
  if (socket.destroyed) return;
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    () => socket.destroy(),
  );
}

/** TLS ingress only. Authentication, WS scheduling and bulk grants remain in the
 * same loopback Host instance used by desktop clients. This is never an open proxy.
 */
export function createMobileWssGateway(options: MobileWssOptions) {
  if (!isIP(options.address)) throw new Error("Mobile WSS requires an exact local IP address.");
  const limits = {
    maxConnections: 32,
    maxPending: 16,
    handshakeTimeoutMs: WS_LIMITS.handshakeTimeoutMs,
    ...options.limits,
  };
  for (const limit of Object.values(limits))
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new Error("Invalid mobile WSS resource limit.");
  const raw = new Set<Duplex>();
  const upstreams = new Set<Duplex>();
  let pending = 0;
  let closing = false;
  const server = createServer({
    key: options.material.privateKeyPem,
    cert: options.material.certificatePem + options.material.caCertificatePem,
    minVersion: "TLSv1.2",
    handshakeTimeout: limits.handshakeTimeoutMs,
    requestTimeout: 180_000,
    headersTimeout: 10_000,
    maxHeaderSize: 8192,
    keepAliveTimeout: 1000,
  });
  server.maxConnections = limits.maxConnections;

  function valid(request: IncomingMessage): boolean {
    const active = server.address();
    return (
      !closing &&
      !!active &&
      typeof active !== "string" &&
      request.socket.localAddress === options.address &&
      request.headers.host === authority(options.address, active.port) &&
      request.headers.origin === undefined &&
      uniqueHeaders(request) &&
      token.test(request.headers.authorization ?? "") &&
      request.headers["transfer-encoding"] === undefined &&
      (request.headers["content-length"] === undefined || request.headers["content-length"] === "0")
    );
  }
  function port(): number {
    const value = options.getPort();
    if (!Number.isInteger(value) || value < 1 || value > 65535)
      throw new Error("Host is not listening.");
    return value;
  }
  function release() {
    let released = false;
    return () => {
      if (!released) {
        released = true;
        pending--;
      }
    };
  }
  function track(socket: Duplex) {
    upstreams.add(socket);
    socket.once("close", () => upstreams.delete(socket));
    socket.on("error", () => socket.destroy());
  }
  function deny(request: IncomingMessage, response: ServerResponse, status: number) {
    request.resume();
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Connection", "close");
    response.writeHead(status).end(() => request.socket.destroy());
  }

  server.on("connection", (socket) => {
    if (closing || raw.size >= limits.maxConnections) {
      socket.destroy();
      return;
    }
    raw.add(socket);
    socket.once("close", () => raw.delete(socket));
    socket.on("error", () => socket.destroy());
  });
  server.on("secureConnection", (socket) => {
    if (socket.servername && socket.servername !== options.address) socket.destroy();
  });
  server.on("checkContinue", (request, response) => deny(request, response, 400));
  server.on("checkExpectation", (request, response) => deny(request, response, 417));
  server.on("connect", (_request, socket) => rejectSocket(socket, 403));

  server.on("request", (request, response) => {
    const match = bulkPath.exec(request.url ?? "");
    if (
      !valid(request) ||
      request.method !== "GET" ||
      !match ||
      !Number.isSafeInteger(Number(match[1]))
    ) {
      deny(request, response, 403);
      return;
    }
    if (pending >= limits.maxPending) {
      deny(request, response, 429);
      return;
    }
    let internalPort: number;
    try {
      internalPort = port();
    } catch {
      deny(request, response, 503);
      return;
    }
    pending++;
    const done = release();
    const upstream = httpRequest({
      hostname: "127.0.0.1",
      port: internalPort,
      path: request.url,
      method: "GET",
      agent: false,
      headers: {
        Host: `127.0.0.1:${internalPort}`,
        Authorization: request.headers.authorization!,
        "Accept-Encoding": "identity",
      },
    });
    upstream.on("socket", track);
    upstream.once("close", done);
    upstream.setTimeout(limits.handshakeTimeoutMs, () => upstream.destroy());
    response.once("close", () => upstream.destroy());
    upstream.on("error", () => {
      if (!response.destroyed) {
        if (response.headersSent) response.destroy();
        else response.writeHead(503).end();
      }
    });
    upstream.once("response", (reply) => {
      const length = Number(reply.headers["content-length"]);
      if (reply.statusCode !== 200) {
        reply.resume();
        response.setHeader("Cache-Control", "no-store");
        response
          .writeHead(
            reply.statusCode && reply.statusCode >= 400 && reply.statusCode <= 599
              ? reply.statusCode
              : 502,
          )
          .end();
        return;
      }
      if (
        reply.headers["content-type"] !== "application/octet-stream" ||
        !Number.isSafeInteger(length) ||
        length < 1 ||
        length > WS_LIMITS.streamChunkBytes
      ) {
        reply.destroy();
        response.writeHead(502).end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": length,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      let bytes = 0;
      reply.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > length) {
          reply.destroy();
          response.destroy();
        }
      });
      reply.once("end", () => {
        if (bytes !== length) response.destroy();
      });
      reply.on("error", () => response.destroy());
      reply.pipe(response);
    });
    upstream.end();
  });

  server.on("upgrade", (request, socket, head) => {
    if (
      !valid(request) ||
      request.method !== "GET" ||
      request.url !== "/ws" ||
      request.headers.upgrade?.toLowerCase() !== "websocket" ||
      !request.headers.connection
        ?.toLowerCase()
        .split(/\s*,\s*/)
        .includes("upgrade") ||
      request.headers["sec-websocket-version"] !== "13" ||
      typeof request.headers["sec-websocket-key"] !== "string" ||
      !/^[+/0-9A-Za-z]{22}==$/.test(request.headers["sec-websocket-key"]) ||
      request.headers["sec-websocket-protocol"] !== WS_SUBPROTOCOL ||
      head.length > WS_LIMITS.maxMessageBytes
    ) {
      rejectSocket(socket, 403);
      return;
    }
    if (pending >= limits.maxPending) {
      rejectSocket(socket, 429);
      return;
    }
    let internalPort: number;
    try {
      internalPort = port();
    } catch {
      rejectSocket(socket, 503);
      return;
    }
    pending++;
    const done = release();
    const upstream = httpRequest({
      hostname: "127.0.0.1",
      port: internalPort,
      path: "/ws",
      method: "GET",
      agent: false,
      headers: {
        Host: `127.0.0.1:${internalPort}`,
        Authorization: request.headers.authorization!,
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": request.headers["sec-websocket-key"],
        "Sec-WebSocket-Protocol": WS_SUBPROTOCOL,
      },
    });
    const timeout = setTimeout(() => {
      rejectSocket(socket, 503);
      upstream.destroy();
    }, limits.handshakeTimeoutMs);
    timeout.unref();
    const settled = () => {
      clearTimeout(timeout);
      done();
    };
    upstream.on("socket", track);
    upstream.once("close", settled);
    socket.on("error", () => {
      socket.destroy();
      upstream.destroy();
    });
    socket.once("close", () => upstream.destroy());
    upstream.on("error", () => rejectSocket(socket, 503));
    upstream.once("response", (reply) => {
      settled();
      reply.resume();
      rejectSocket(
        socket,
        reply.statusCode && reply.statusCode >= 400 && reply.statusCode <= 599
          ? reply.statusCode
          : 502,
      );
    });
    upstream.once("upgrade", (reply, target, upstreamHead) => {
      settled();
      if (
        closing ||
        socket.destroyed ||
        reply.statusCode !== 101 ||
        reply.headers["sec-websocket-protocol"] !== WS_SUBPROTOCOL ||
        reply.headers["sec-websocket-accept"] !==
          createHash("sha1")
            .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
            .digest("base64")
      ) {
        target.destroy();
        rejectSocket(socket, 502);
        return;
      }
      track(target);
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${reply.headers["sec-websocket-accept"]}\r\nSec-WebSocket-Protocol: ${WS_SUBPROTOCOL}\r\n\r\n`,
      );
      target.once("close", () => socket.destroy());
      socket.once("close", () => target.destroy());
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) target.write(head);
      socket.pipe(target).pipe(socket);
    });
    upstream.end();
  });

  const closeAll = server.closeAllConnections.bind(server);
  server.closeAllConnections = () => {
    closing = true;
    for (const socket of raw) socket.destroy();
    for (const socket of upstreams) socket.destroy();
    closeAll();
  };
  return server;
}
