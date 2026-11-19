import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { connect, isIP, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import { hostHeaderAllowed } from "../transport/ws/server-helpers";

export const TUNNEL_PATH = "/ws-tunnel";
export const TUNNEL_SUBPROTOCOL = "bycoda.tunnel.v1";
export const TUNNEL_CAPABILITY = "dev.servers.tunnel.v1";
export const TUNNEL_ERROR_HEADER = "X-Bycoda-Tunnel-Error";

const MAX_HEAD_BYTES = 64 * 1024;
const MAX_LINE_BYTES = 8 * 1024;
const ALIAS = /^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/;

export type TunnelTarget = {
  projectId: string;
  id: string;
  pid: number;
  startedAt: string;
  port: number;
  address: string;
  alias: string;
};

export function isTunnelUpgradeUrl(url: string | undefined): boolean {
  return url === TUNNEL_PATH || url?.startsWith(`${TUNNEL_PATH}?`) === true;
}

export function validTunnelAlias(alias: string): boolean {
  return (
    alias.length <= 80 &&
    ALIAS.test(alias) &&
    (alias.endsWith(".test") || alias.endsWith(".localhost"))
  );
}

const QUERY_KEYS = ["projectId", "id", "pid", "startedAt", "port", "address", "alias"];

/** Strict parse of the upgrade query: exactly the contract keys, each once. */
export function parseTunnelQuery(url: string | undefined): TunnelTarget | null {
  if (!isTunnelUpgradeUrl(url)) return null;
  let params: URLSearchParams;
  try {
    params = new URL(url!, "http://tunnel.invalid").searchParams;
  } catch {
    return null;
  }
  const keys = [...params.keys()];
  if (keys.length !== QUERY_KEYS.length || new Set(keys).size !== keys.length) return null;
  const read = (key: string, max: number) => {
    const value = params.get(key);
    return value && value.length <= max ? value : null;
  };
  const projectId = read("projectId", 200);
  const id = read("id", 200);
  const startedAt = read("startedAt", 128);
  const address = read("address", 64);
  const alias = read("alias", 80);
  const pidText = read("pid", 10);
  const portText = read("port", 5);
  if (!projectId || !id || !startedAt || !address || !alias || !pidText || !portText) return null;
  if (!/^[0-9]+$/.test(pidText) || !/^[0-9]+$/.test(portText)) return null;
  const pid = Number(pidText);
  const port = Number(portText);
  if (!Number.isSafeInteger(pid) || pid < 1 || port < 1 || port > 65535) return null;
  if (!validTunnelAlias(alias)) return null;
  return { projectId, id, pid, startedAt, port, address, alias };
}

// ---------------------------------------------------------------------------
// HTTP head rewriting (pure functions plus a small framing state machine)
// ---------------------------------------------------------------------------

export type RequestHeadResult =
  | { ok: true; head: Buffer; upgrade: boolean; contentLength: number; chunked: boolean }
  | { ok: false; reason: string };

type HeadLine = { name: string; lower: string; value: string };

function parseLines(text: string): { first: string; headers: HeadLine[] } | null {
  const lines = text.split("\r\n");
  const first = lines.shift() ?? "";
  const headers: HeadLine[] = [];
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 1 || line[0] === " " || line[0] === "\t") return null;
    const name = line.slice(0, colon);
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) return null;
    headers.push({ name, lower: name.toLowerCase(), value: line.slice(colon + 1).trim() });
  }
  return { first, headers };
}

function replaceOrigin(value: string, from: string, to: string): string {
  if (!value.startsWith(from)) return value;
  const rest = value.slice(from.length);
  return rest === "" || /^[/?#]/.test(rest) ? to + rest : value;
}

/**
 * Rewrites one HTTP request head (bytes up to and excluding the blank line) for the
 * dev server: `Host: alias:port` -> `localhost:port`, same for Origin/Referer, and a
 * forced `Connection: close` unless the request upgrades to a WebSocket.
 */
export function rewriteRequestHead(
  headBytes: Buffer,
  alias: string,
  port: number,
): RequestHeadResult {
  const parsed = parseLines(headBytes.toString("latin1"));
  if (!parsed) return { ok: false, reason: "malformed" };
  const first = /^([A-Z]+) (\S+) HTTP\/1\.[01]$/.exec(parsed.first);
  if (!first || first[1] === "CONNECT") return { ok: false, reason: "malformed" };
  const count = (name: string) => parsed.headers.filter((header) => header.lower === name);
  const hosts = count("host");
  const authority = `${alias}:${port}`;
  if (hosts.length !== 1 || hosts[0].value.toLowerCase() !== authority)
    return { ok: false, reason: "host" };
  const lengths = count("content-length");
  const encodings = count("transfer-encoding");
  if (lengths.length > 1 || encodings.length > 1) return { ok: false, reason: "framing" };
  if (lengths.length && encodings.length) return { ok: false, reason: "framing" };
  let contentLength = 0;
  if (lengths.length) {
    if (!/^[0-9]{1,15}$/.test(lengths[0].value)) return { ok: false, reason: "framing" };
    contentLength = Number(lengths[0].value);
  }
  const chunked = encodings.length > 0;
  if (chunked && encodings[0].value.toLowerCase() !== "chunked")
    return { ok: false, reason: "framing" };
  const upgradeValue = count("upgrade")
    .map((header) => header.value.toLowerCase())
    .join(",");
  const connection = count("connection")
    .map((header) => header.value.toLowerCase())
    .join(",");
  const upgrade =
    upgradeValue.split(/\s*,\s*/).includes("websocket") &&
    connection.split(/\s*,\s*/).includes("upgrade");
  const from = `http://${authority}`;
  const to = `http://localhost:${port}`;
  const lines = [parsed.first];
  for (const header of parsed.headers) {
    if (header.lower === "host") lines.push(`${header.name}: localhost:${port}`);
    else if (header.lower === "origin" || header.lower === "referer")
      lines.push(`${header.name}: ${replaceOrigin(header.value, from, to)}`);
    else if (!upgrade && (header.lower === "connection" || header.lower === "upgrade")) continue;
    else lines.push(`${header.name}: ${header.value}`);
  }
  if (!upgrade) lines.push("Connection: close");
  return {
    ok: true,
    head: Buffer.from(`${lines.join("\r\n")}\r\n\r\n`, "latin1"),
    upgrade,
    contentLength,
    chunked,
  };
}

/** Rewrites `Location` of a response head so redirects stay on the tunnel alias. */
export function rewriteResponseHead(head: string, alias: string, port: number): string {
  const lines = head.split("\r\n");
  const local = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
  return lines
    .map((line, index) => {
      if (index === 0) return line;
      const colon = line.indexOf(":");
      if (colon < 1 || line.slice(0, colon).toLowerCase() !== "location") return line;
      const value = line.slice(colon + 1).trim();
      for (const prefix of local) {
        const next = replaceOrigin(value, prefix, `http://${alias}:${port}`);
        if (next !== value) return `${line.slice(0, colon)}: ${next}`;
      }
      return line;
    })
    .join("\r\n");
}

type FrameState = "head" | "body" | "chunk-size" | "chunk-data" | "chunk-crlf" | "trailer" | "raw";

/** Splits the phone->server byte stream into request heads and bodies, rewriting every head. */
export class RequestHeadRewriter {
  private state: FrameState = "head";
  private remaining = 0;
  private pending: Buffer = Buffer.alloc(0);
  private failed = false;

  constructor(
    private alias: string,
    private port: number,
  ) {}

  push(chunk: Buffer): { out: Buffer[]; error?: string } {
    const out: Buffer[] = [];
    if (this.failed) return { out, error: "failed" };
    let data = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    this.pending = Buffer.alloc(0);
    const fail = (error: string) => {
      this.failed = true;
      return { out: [], error };
    };
    while (data.length) {
      if (this.state === "raw") {
        out.push(data);
        break;
      }
      if (this.state === "body" || this.state === "chunk-data") {
        const size = Math.min(this.remaining, data.length);
        out.push(data.subarray(0, size));
        data = data.subarray(size);
        this.remaining -= size;
        if (this.remaining === 0) this.state = this.state === "body" ? "head" : "chunk-crlf";
        continue;
      }
      if (this.state === "head") {
        const end = data.indexOf("\r\n\r\n");
        if (end < 0) {
          if (data.length > MAX_HEAD_BYTES) return fail("head-too-large");
          this.pending = data;
          break;
        }
        if (end + 4 > MAX_HEAD_BYTES) return fail("head-too-large");
        const result = rewriteRequestHead(data.subarray(0, end), this.alias, this.port);
        if (!result.ok) return fail(result.reason);
        out.push(result.head);
        data = data.subarray(end + 4);
        if (result.upgrade) this.state = "raw";
        else if (result.chunked) this.state = "chunk-size";
        else if (result.contentLength > 0) {
          this.state = "body";
          this.remaining = result.contentLength;
        }
        continue;
      }
      const end = data.indexOf("\r\n");
      if (end < 0) {
        if (data.length > MAX_LINE_BYTES) return fail("line-too-large");
        this.pending = data;
        break;
      }
      const line = data.subarray(0, end).toString("latin1");
      out.push(data.subarray(0, end + 2));
      data = data.subarray(end + 2);
      if (this.state === "chunk-crlf") {
        if (line !== "") return fail("chunk");
        this.state = "chunk-size";
      } else if (this.state === "chunk-size") {
        const hex = line.split(";", 1)[0].trim();
        if (!/^[0-9a-fA-F]{1,12}$/.test(hex)) return fail("chunk");
        this.remaining = parseInt(hex, 16);
        this.state = this.remaining === 0 ? "trailer" : "chunk-data";
      } else if (line === "") this.state = "head";
    }
    return { out };
  }
}

/** Rewrites `Location` in the first final response head, then passes bytes through. */
export class ResponseHeadRewriter {
  private done = false;
  private pending: Buffer = Buffer.alloc(0);

  constructor(
    private alias: string,
    private port: number,
  ) {}

  push(chunk: Buffer): Buffer[] {
    if (this.done) return [chunk];
    const out: Buffer[] = [];
    let data = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    this.pending = Buffer.alloc(0);
    while (!this.done && data.length) {
      const end = data.indexOf("\r\n\r\n");
      if (end < 0) {
        if (data.length > MAX_HEAD_BYTES) {
          // Oversize head: stop rewriting, never block the stream.
          this.done = true;
          out.push(data);
          return out;
        }
        this.pending = data;
        return out;
      }
      const text = data.subarray(0, end).toString("latin1");
      out.push(
        Buffer.from(`${rewriteResponseHead(text, this.alias, this.port)}\r\n\r\n`, "latin1"),
      );
      data = data.subarray(end + 4);
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(text)?.[1]);
      // 1xx heads (except 101) precede the final head, which is the one that matters.
      if (!(status >= 100 && status < 200 && status !== 101)) this.done = true;
    }
    if (data.length) out.push(data);
    return out;
  }
}

// ---------------------------------------------------------------------------
// Tunnel endpoint
// ---------------------------------------------------------------------------

export type TunnelErrorCode = "unauthorized" | "forbidden" | "identity" | "limit" | "connect";
const ERROR_STATUS: Record<TunnelErrorCode, [number, string]> = {
  unauthorized: [401, "Unauthorized"],
  forbidden: [403, "Forbidden"],
  identity: [403, "Forbidden"],
  limit: [429, "Too Many Requests"],
  connect: [502, "Bad Gateway"],
};

function rejectTunnel(socket: Duplex, code: TunnelErrorCode) {
  if (socket.destroyed) return;
  const [status, phrase] = ERROR_STATUS[code];
  socket.on("error", () => socket.destroy());
  socket.end(
    `HTTP/1.1 ${status} ${phrase}\r\n${TUNNEL_ERROR_HEADER}: ${code}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    () => socket.destroy(),
  );
}

export type DevServerTunnelOptions = {
  server: Server;
  mobileIngressSecret?: string;
  allowedHosts?: readonly string[] | (() => readonly string[]);
  /** Resolves the verified principal for a bearer token, or null when it is not paired. */
  authenticate: (
    token: string,
  ) => Promise<{ id: string; authorized: () => Promise<boolean> } | null>;
  /** `DevServerAccess.endpoint`: project ownership, live process identity, HTTP-only, never the Host port. */
  endpoint: (params: Record<string, unknown>) => Promise<{ connectAddress: string; port: number }>;
  limits?: Partial<{
    perDevice: number;
    total: number;
    pending: number;
    idleMs: number;
    reauthMs: number;
    connectTimeoutMs: number;
    handshakeTimeoutMs: number;
    backpressureBytes: number;
  }>;
};

type Tunnel = { principalId: string; finish: (code: number, reason: string) => void };

export function attachDevServerTunnel(options: DevServerTunnelOptions) {
  const limits = {
    perDevice: 32,
    total: 128,
    pending: 32,
    idleMs: 10 * 60_000,
    reauthMs: 25_000,
    connectTimeoutMs: 5_000,
    handshakeTimeoutMs: 15_000,
    backpressureBytes: 1024 * 1024,
    ...options.limits,
  };
  const tunnels = new Set<Tunnel>();
  const attempts = new Set<{ socket: Duplex; tcp?: Socket }>();
  let reserved = 0;
  const reservedByDevice = new Map<string, number>();
  let closing = false;
  const sockets = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload: 4 * 1024 * 1024,
    perMessageDeflate: false,
    handleProtocols: (protocols) =>
      protocols.has(TUNNEL_SUBPROTOCOL) ? TUNNEL_SUBPROTOCOL : false,
  });

  function release(principalId: string) {
    reserved--;
    const count = (reservedByDevice.get(principalId) ?? 1) - 1;
    if (count > 0) reservedByDevice.set(principalId, count);
    else reservedByDevice.delete(principalId);
  }

  function connectTcp(host: string, port: number, attempt: { tcp?: Socket }): Promise<Socket> {
    return new Promise<Socket>((resolve, reject) => {
      const tcp = connect({ host, port });
      attempt.tcp = tcp;
      const timer = setTimeout(() => {
        tcp.destroy();
        reject(new Error("timeout"));
      }, limits.connectTimeoutMs);
      timer.unref();
      tcp.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      tcp.once("connect", () => {
        clearTimeout(timer);
        tcp.removeAllListeners("error");
        resolve(tcp);
      });
    });
  }

  function pipe(
    ws: WebSocket,
    tcp: Socket,
    principal: { id: string; authorized: () => Promise<boolean> },
    target: TunnelTarget,
    entry: Tunnel,
  ) {
    const requests = new RequestHeadRewriter(target.alias, target.port);
    const responses = new ResponseHeadRewriter(target.alias, target.port);
    let lastActive = monotonicNow();
    let finished = false;
    const timers: Array<ReturnType<typeof setInterval>> = [];
    const finish = (code: number, reason: string) => {
      if (finished) return;
      finished = true;
      for (const timer of timers) clearInterval(timer);
      tunnels.delete(entry);
      release(principal.id);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
        ws.close(code, reason);
      else ws.terminate();
      tcp.destroy();
    };
    entry.finish = finish;
    const touch = () => {
      lastActive = monotonicNow();
    };
    tcp.setNoDelay(true);
    ws.binaryType = "nodebuffer";
    ws.on("error", () => finish(1011, "Tunnel failed."));
    ws.on("close", () => {
      if (finished) return;
      finished = true;
      for (const timer of timers) clearInterval(timer);
      tunnels.delete(entry);
      release(principal.id);
      // WS closed first: half-close towards the dev server, then make sure it goes away.
      tcp.end();
      const kill = setTimeout(() => tcp.destroy(), 2_000);
      kill.unref();
      tcp.once("close", () => clearTimeout(kill));
    });
    ws.on("message", (data: RawData, isBinary: boolean) => {
      if (!isBinary) {
        finish(1003, "Binary frames only.");
        return;
      }
      touch();
      const buffer = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data);
      const result = requests.push(buffer);
      if (result.error) {
        finish(1008, "Unsupported request.");
        return;
      }
      for (const piece of result.out) {
        if (!tcp.write(piece) && !ws.isPaused) {
          ws.pause();
          tcp.once("drain", () => ws.resume());
        }
      }
    });
    tcp.on("data", (chunk: Buffer) => {
      touch();
      for (const piece of responses.push(chunk)) {
        ws.send(piece, { binary: true }, (error) => {
          if (error) {
            finish(1011, "Tunnel failed.");
            return;
          }
          if (tcp.isPaused() && ws.bufferedAmount <= limits.backpressureBytes) tcp.resume();
        });
      }
      if (ws.bufferedAmount > limits.backpressureBytes) tcp.pause();
    });
    tcp.on("end", () => finish(1000, "Closed."));
    tcp.on("error", () => finish(1011, "Development server connection failed."));
    tcp.on("close", () => finish(1000, "Closed."));
    timers.push(
      setInterval(
        () => {
          if (elapsedSince(lastActive) > limits.idleMs) finish(1000, "Idle.");
        },
        Math.max(10, Math.min(5_000, limits.idleMs / 2)),
      ),
      setInterval(() => {
        // A temporary store failure is not a revocation; only a definite `false` closes.
        principal.authorized().then(
          (ok) => {
            if (!ok) finish(1008, "Connection no longer authorized.");
          },
          () => {},
        );
      }, limits.reauthMs),
    );
    for (const timer of timers) timer.unref();
  }

  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!isTunnelUpgradeUrl(request.url)) return;
    const claimed = request.headers["x-bycoda-mobile-ingress"];
    const secret = options.mobileIngressSecret;
    const mobile =
      typeof claimed === "string" &&
      typeof secret === "string" &&
      Buffer.byteLength(claimed) === Buffer.byteLength(secret) &&
      timingSafeEqual(Buffer.from(claimed), Buffer.from(secret));
    if (claimed !== undefined && !mobile) {
      rejectTunnel(socket, "unauthorized");
      return;
    }
    const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) {
      rejectTunnel(socket, "unauthorized");
      return;
    }
    const key = request.headers["sec-websocket-key"];
    const protocols = request.headers["sec-websocket-protocol"]
      ?.split(",")
      .map((value) => value.trim());
    const target = parseTunnelQuery(request.url);
    if (
      closing ||
      !target ||
      request.method !== "GET" ||
      request.headers.origin !== undefined ||
      !hostHeaderAllowed(request, options.server, options.allowedHosts) ||
      request.headers.upgrade?.toLowerCase() !== "websocket" ||
      request.headers["sec-websocket-version"] !== "13" ||
      typeof key !== "string" ||
      !/^[+/0-9A-Za-z]{22}==$/.test(key) ||
      !protocols?.includes(TUNNEL_SUBPROTOCOL)
    ) {
      rejectTunnel(socket, "forbidden");
      return;
    }
    if (reserved >= limits.total || attempts.size >= limits.pending) {
      rejectTunnel(socket, "limit");
      return;
    }
    const attempt: { socket: Duplex; tcp?: Socket } = { socket };
    attempts.add(attempt);
    socket.on("error", () => socket.destroy());
    const deadline = setTimeout(() => {
      socket.destroy();
      attempt.tcp?.destroy();
    }, limits.handshakeTimeoutMs);
    deadline.unref();
    let principalId: string | undefined;
    const settle = () => {
      clearTimeout(deadline);
      attempts.delete(attempt);
    };
    let accepted = false;
    let piped = false;
    socket.once("close", () => {
      attempt.tcp?.destroy();
      // The client vanished between accepting and the 101: `pipe` never runs.
      if (accepted && !piped && principalId) {
        release(principalId);
        principalId = undefined;
        settle();
      }
    });
    void (async () => {
      try {
        const principal = await options.authenticate(token);
        if (closing || socket.destroyed) return;
        if (!principal || !(await principal.authorized())) {
          rejectTunnel(socket, "unauthorized");
          return;
        }
        if (
          reserved >= limits.total ||
          (reservedByDevice.get(principal.id) ?? 0) >= limits.perDevice
        ) {
          rejectTunnel(socket, "limit");
          return;
        }
        reserved++;
        reservedByDevice.set(principal.id, (reservedByDevice.get(principal.id) ?? 0) + 1);
        principalId = principal.id;
        let endpoint: { connectAddress: string; port: number };
        try {
          endpoint = await options.endpoint({
            projectId: target.projectId,
            id: target.id,
            identity: { pid: target.pid, startedAt: target.startedAt },
            port: target.port,
            address: target.address,
          });
        } catch {
          rejectTunnel(socket, "identity");
          return;
        }
        if (closing || socket.destroyed) return;
        if (
          endpoint.port !== target.port ||
          !isIP(endpoint.connectAddress.replace(/^\[|\]$/g, ""))
        ) {
          rejectTunnel(socket, "forbidden");
          return;
        }
        let tcp: Socket;
        try {
          tcp = await connectTcp(endpoint.connectAddress, endpoint.port, attempt);
        } catch {
          rejectTunnel(socket, "connect");
          return;
        }
        if (closing || socket.destroyed || !(await principal.authorized())) {
          tcp.destroy();
          rejectTunnel(socket, closing || socket.destroyed ? "connect" : "unauthorized");
          return;
        }
        const entry: Tunnel = { principalId: principal.id, finish: () => {} };
        accepted = true;
        // The 101 reply is produced by ws, which validates key/version again.
        sockets.handleUpgrade(request, socket, head, (ws) => {
          piped = true;
          settle();
          tunnels.add(entry);
          pipe(ws, tcp, principal, target, entry);
        });
      } catch {
        rejectTunnel(socket, "connect");
      } finally {
        if (!accepted && principalId) release(principalId);
        if (!accepted) settle();
      }
    })();
  };
  options.server.on("upgrade", upgrade);

  let closePromise: Promise<void> | undefined;
  return {
    close(): Promise<void> {
      return (closePromise ??= new Promise<void>((resolve) => {
        closing = true;
        options.server.off("upgrade", upgrade);
        for (const attempt of attempts) {
          attempt.socket.destroy();
          attempt.tcp?.destroy();
        }
        for (const tunnel of [...tunnels]) tunnel.finish(1001, "Host is stopping.");
        sockets.close(() => resolve());
      }));
    },
  };
}
