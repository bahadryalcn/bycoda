import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket, WebSocketServer } from "ws";
import { hostHeaderAllowed, rejectUpgrade } from "../transport/ws/server-helpers";
import type { SharedBrowser } from "./shared-browser";

const PATH = "/ws-browser-frames";
const PROTOCOL = "bycoda.browser-frames.v1";
const MAX_PACKET_BYTES = 2 * 1024 * 1024;
type Reader = ReturnType<SharedBrowser["openFrameStream"]>;
type Frame = NonNullable<Awaited<ReturnType<Reader["next"]>>>;

export function isBrowserMediaUpgrade(url: string | undefined) {
  return url === PATH || url?.startsWith(`${PATH}?`) === true;
}

function scopeOf(url: string) {
  if (url.length > 2048) return null;
  const query = new URL(url, "http://browser.invalid").searchParams;
  const scope: Record<string, string> = {};
  for (const [key, value] of query) {
    if (
      !["projectId", "sessionId", "ownerPresentationScope"].includes(key) ||
      key in scope ||
      !value ||
      value.length > 512
    )
      return null;
    scope[key] = value;
  }
  if (
    (scope.sessionId && !scope.projectId) ||
    (scope.ownerPresentationScope && (scope.projectId || scope.sessionId))
  )
    return null;
  return scope;
}

function packet({ data, width, height, documentId, navigationId }: Frame) {
  const header = Buffer.from(JSON.stringify({ width, height, documentId, navigationId }));
  const length = Buffer.alloc(2);
  length.writeUInt16BE(header.length);
  return Buffer.concat([length, header, Buffer.from(data, "base64")]);
}

export function attachBrowserMedia(options: {
  server: Server;
  environmentId: string;
  allowedHosts: () => readonly string[];
  mobileIngressSecret?: string;
  authorized(token: string, scope?: Record<string, string>): Promise<boolean>;
  open(scope: Record<string, string>, token: string): Promise<Reader>;
}) {
  const server = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 1024,
  });
  const pending = new Set<Duplex>();
  let closing = false;

  async function send(
    socket: WebSocket,
    reader: Reader,
    token: string,
    scope: Record<string, string>,
  ) {
    let after = 0;
    let verifyAt = 0;
    let heartbeatAt = 0;
    let pendingBytes = 0;
    let acknowledgedAt = performance.now();
    const outstanding: number[] = [];
    socket.on("message", (data, binary) => {
      if (
        !binary ||
        !Buffer.isBuffer(data) ||
        data.length !== 1 ||
        data[0] !== 0 ||
        !outstanding.length
      ) {
        socket.terminate();
        return;
      }
      pendingBytes -= outstanding.shift()!;
      acknowledgedAt = performance.now();
    });
    try {
      while (socket.readyState === WebSocket.OPEN) {
        if (outstanding.length && performance.now() - acknowledgedAt > 5000) break;
        if (performance.now() >= verifyAt) {
          if (!(await options.authorized(token, scope))) break;
          verifyAt = performance.now() + 1000;
        }
        const frame = await reader.next(after);
        if (socket.readyState !== WebSocket.OPEN) break;
        if (frame) {
          after = frame.sequence;
          if (socket.bufferedAmount === 0 && outstanding.length < 8) {
            const bytes = packet(frame);
            if (
              bytes.length <= MAX_PACKET_BYTES &&
              pendingBytes + bytes.length <= 2 * MAX_PACKET_BYTES
            ) {
              if (!outstanding.length) acknowledgedAt = performance.now();
              outstanding.push(bytes.length);
              pendingBytes += bytes.length;
              socket.send(bytes, { binary: true }, (error) => {
                if (error) socket.terminate();
              });
            }
          }
        } else if (performance.now() >= heartbeatAt) {
          socket.ping();
          heartbeatAt = performance.now() + 1000;
        }
        await delay(25);
      }
    } finally {
      reader.release();
      socket.terminate();
    }
  }

  function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    if (!isBrowserMediaUpgrade(request.url)) return;
    const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    const ingress = request.headers["x-bycoda-mobile-ingress"];
    const secret = options.mobileIngressSecret;
    if (
      !token ||
      (ingress !== undefined &&
        !(
          typeof ingress === "string" &&
          secret &&
          Buffer.byteLength(ingress) === Buffer.byteLength(secret) &&
          timingSafeEqual(Buffer.from(ingress), Buffer.from(secret))
        ))
    ) {
      rejectUpgrade(socket, 401);
      return;
    }
    const scope = scopeOf(request.url!);
    if (
      closing ||
      !scope ||
      request.method !== "GET" ||
      request.headers.origin !== undefined ||
      request.headers["sec-websocket-protocol"] !== PROTOCOL ||
      request.headers["x-bycoda-environment"] !== options.environmentId ||
      !hostHeaderAllowed(request, options.server, options.allowedHosts)
    ) {
      rejectUpgrade(socket, 400);
      return;
    }
    if (pending.size + server.clients.size >= 8) {
      rejectUpgrade(socket, 429);
      return;
    }
    pending.add(socket);
    const timer = setTimeout(() => socket.destroy(), 3000);
    timer.unref();
    socket.on("error", () => socket.destroy());
    socket.once("close", () => {
      clearTimeout(timer);
      pending.delete(socket);
    });
    void (async () => {
      if (!(await options.authorized(token))) return rejectUpgrade(socket, 401);
      const reader = await options.open(scope, token);
      if (closing || socket.destroyed) {
        reader.release();
        socket.destroy();
        return;
      }
      const release = () => reader.release();
      socket.once("close", release);
      server.handleUpgrade(request, socket, head, (client) => {
        socket.off("close", release);
        clearTimeout(timer);
        pending.delete(socket);
        client.on("error", () => client.terminate());
        void send(client, reader, token, scope).catch(() => client.terminate());
      });
    })().catch(() => rejectUpgrade(socket, 400));
  }

  options.server.on("upgrade", upgrade);
  return () => {
    closing = true;
    options.server.off("upgrade", upgrade);
    for (const socket of pending) socket.destroy();
    for (const client of server.clients) client.terminate();
    server.close();
  };
}
