import { createHash } from "node:crypto";
import { DEVICE_PROOF_HEADER, DEVICE_PROOF_MAX_BYTES } from "../../src/integrations/device-proof";
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
import { TUNNEL_ERROR_HEADER, TUNNEL_SUBPROTOCOL } from "../dev-servers/dev-server-tunnel";
import type { MobileTlsMaterial } from "./mobile-tls";
import { GATEWAY_ADMISSION, OVER_CAPACITY_RETRY_AFTER_SECONDS } from "./gateway-admission";

export type MobileWssOptions = {
  address: string;
  getPort: () => number;
  material: MobileTlsMaterial;
  ingressSecret?: string;
  limits?: Partial<{
    maxConnections: number;
    rejectReserve: number;
    maxPending: number;
    handshakeTimeoutMs: number;
  }>;
};

const token = /^Bearer [A-Za-z0-9_-]{43}$/;
const bulkPath = /^\/ws-bulk\/[A-Za-z0-9_-]{1,200}\?offset=(0|[1-9][0-9]{0,15})$/;
const proofShape = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const singular = new Set([
  "host",
  DEVICE_PROOF_HEADER.toLowerCase(),
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
const tunnelPath = /^\/ws-tunnel\?[A-Za-z0-9_.~%=&+-]{1,1500}$/;
const authority = (address: string, port: number) =>
  `${isIP(address) === 6 ? `[${address}]` : address}:${port}`;

/** The client's `DPoP` header is optional here (the Host decides) but must be one JWS-shaped value. */
function validProof(request: IncomingMessage): boolean {
  const proof = request.headers[DEVICE_PROOF_HEADER.toLowerCase()];
  return (
    proof === undefined ||
    (typeof proof === "string" && proof.length <= DEVICE_PROOF_MAX_BYTES && proofShape.test(proof))
  );
}

/** Relays the client's proof; the Host verifies it. */
function proofHeader(request: IncomingMessage): Record<string, string> {
  const proof = request.headers[DEVICE_PROOF_HEADER.toLowerCase()];
  return typeof proof === "string" ? { [DEVICE_PROOF_HEADER]: proof } : {};
}

function uniqueHeaders(request: IncomingMessage): boolean {
  const found = new Set<string>();
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index].toLowerCase();
    if (singular.has(name) && found.has(name)) return false;
    found.add(name);
  }
  return true;
}

function rejectSocket(socket: Duplex, status: number, tunnelError?: string) {
  if (socket.destroyed) return;
  const retry = status === 429 ? `Retry-After: ${OVER_CAPACITY_RETRY_AFTER_SECONDS}\r\n` : "";
  const tunnel = tunnelError ? `${TUNNEL_ERROR_HEADER}: ${tunnelError}\r\n` : "";
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\n${retry}${tunnel}Connection: close\r\nContent-Length: 0\r\n\r\n`,
    () => socket.destroy(),
  );
}

/** TLS ingress only. Authentication, WS scheduling and bulk grants remain in the
 * same loopback Host instance used by desktop clients. This is never an open proxy.
 */
export function createMobileWssGateway(options: MobileWssOptions) {
  if (!isIP(options.address)) throw new Error("Mobile WSS requires an exact local IP address.");
  const limits = {
    maxConnections: GATEWAY_ADMISSION.maxAdmitted,
    rejectReserve: GATEWAY_ADMISSION.rejectReserve,
    maxPending: 16,
    handshakeTimeoutMs: WS_LIMITS.handshakeTimeoutMs,
    ...options.limits,
  };
  for (const limit of Object.values(limits))
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new Error("Invalid mobile WSS resource limit.");
  // Hard ceiling on TCP sockets. Sockets past `maxConnections` only get a TLS 429 while the reserve lasts.
  const ceiling = limits.maxConnections + limits.rejectReserve;
  const raw = new Set<Duplex>();
  const admitted = new Set<Duplex>();
  const overCapacity = new WeakSet<Duplex>();
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
  server.maxConnections = ceiling;

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
      validProof(request) &&
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
    if (status === 429)
      response.setHeader("Retry-After", String(OVER_CAPACITY_RETRY_AFTER_SECONDS));
    response.writeHead(status).end(() => request.socket.destroy());
  }

  server.on("connection", (socket) => {
    if (closing || raw.size >= ceiling) {
      socket.destroy();
      return;
    }
    raw.add(socket);
    socket.once("close", () => raw.delete(socket));
    socket.on("error", () => socket.destroy());
  });
  // Admission counts established TLS sessions, not raw TCP, so handshakes and refused
  // peers cannot use up the phones' share. Sessions past the cap keep TLS and get a 429.
  server.on("secureConnection", (socket) => {
    if (socket.servername && socket.servername !== options.address) {
      socket.destroy();
      return;
    }
    if (admitted.size < limits.maxConnections) {
      admitted.add(socket);
      socket.once("close", () => admitted.delete(socket));
    } else overCapacity.add(socket);
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
    if (overCapacity.has(request.socket) || pending >= limits.maxPending) {
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
        ...proofHeader(request),
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
    // `/ws-tunnel` is the dev-server byte tunnel; it is forwarded with its own subprotocol
    // and the Host answers its failures with an `X-Bycoda-Tunnel-Error` header.
    const tunnel = request.url !== "/ws" && tunnelPath.test(request.url ?? "");
    const route = tunnel ? request.url! : "/ws";
    const subprotocol = tunnel ? TUNNEL_SUBPROTOCOL : WS_SUBPROTOCOL;
    if (
      !valid(request) ||
      request.method !== "GET" ||
      (request.url !== "/ws" && !tunnel) ||
      request.headers.upgrade?.toLowerCase() !== "websocket" ||
      !request.headers.connection
        ?.toLowerCase()
        .split(/\s*,\s*/)
        .includes("upgrade") ||
      request.headers["sec-websocket-version"] !== "13" ||
      typeof request.headers["sec-websocket-key"] !== "string" ||
      !/^[+/0-9A-Za-z]{22}==$/.test(request.headers["sec-websocket-key"]) ||
      request.headers["sec-websocket-protocol"] !== subprotocol ||
      head.length > WS_LIMITS.maxMessageBytes
    ) {
      rejectSocket(socket, 403);
      return;
    }
    if (overCapacity.has(socket) || pending >= limits.maxPending) {
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
      path: route,
      method: "GET",
      agent: false,
      headers: {
        Host: `127.0.0.1:${internalPort}`,
        Authorization: request.headers.authorization!,
        ...proofHeader(request),
        ...(options.ingressSecret ? { "X-Bycoda-Mobile-Ingress": options.ingressSecret } : {}),
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": request.headers["sec-websocket-key"],
        "Sec-WebSocket-Protocol": subprotocol,
      },
    });
    const timeout = setTimeout(
      () => {
        rejectSocket(socket, 503);
        upstream.destroy();
        // The tunnel handshake includes the Host's own dev-server TCP connect (5 s).
      },
      limits.handshakeTimeoutMs + (tunnel ? 10_000 : 0),
    );
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
      const code = reply.headers[TUNNEL_ERROR_HEADER.toLowerCase()];
      rejectSocket(
        socket,
        reply.statusCode && reply.statusCode >= 400 && reply.statusCode <= 599
          ? reply.statusCode
          : 502,
        tunnel && typeof code === "string" && /^[a-z]{1,16}$/.test(code) ? code : undefined,
      );
    });
    upstream.once("upgrade", (reply, target, upstreamHead) => {
      settled();
      if (
        closing ||
        socket.destroyed ||
        reply.statusCode !== 101 ||
        reply.headers["sec-websocket-protocol"] !== subprotocol ||
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
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${reply.headers["sec-websocket-accept"]}\r\nSec-WebSocket-Protocol: ${subprotocol}\r\n\r\n`,
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
