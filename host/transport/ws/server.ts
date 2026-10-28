import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { ZodError } from "zod";
import {
  ConnectionHelloParamsSchema,
  ConnectionHelloResultSchema,
  HOST_SCHEMA_VERSION,
  IdentifierSchema,
  JsonValueSchema,
  RPC_ERROR_CODES,
  RpcResponseSchema,
  SubscriptionEventSchema,
  SubscriptionOpenParamsSchema,
  WS_LIMITS,
  WS_SUBPROTOCOL,
  WS_WIRE_VERSION,
  getHostRpcMethod,
  hostRpcCost,
  parseRpcRequest,
  type RpcRequest,
  type RpcError,
} from "../../../src/shared/model/host-contracts";
import { HostDispatchError, type HostDispatchContext } from "../dispatch";
import { HostReadWorkBudget } from "../read-budget";
import { HostBulkError, hostBulkDependencies, type HostBulkTransfers } from "../http/bulk";
import { HostStreamError, type HostSubscriptionHub } from "./subscriptions";

export const HOST_WS_READ_CAPABILITY = "transport.ws.read.v2";
const READ_METHODS = ["environment.describe", "projects.list"] as const;
const DISPATCH_ERROR_CODES: Record<HostDispatchError["code"], number> = {
  unauthorized: RPC_ERROR_CODES.unauthorized,
  "wrong-environment": RPC_ERROR_CODES.wrongEnvironment,
  "method-not-found": RPC_ERROR_CODES.methodNotFound,
  "invalid-params": RPC_ERROR_CODES.invalidParams,
  overloaded: RPC_ERROR_CODES.overloaded,
  cancelled: RPC_ERROR_CODES.cancelled,
  "service-unavailable": RPC_ERROR_CODES.internalError,
};

export type HostWsPrincipal = {
  id: string;
  /** A device token is checked again at admission and before result delivery. */
  authorized: () => boolean | Promise<boolean>;
  exposeQueueAttachments?: HostDispatchContext["exposeQueueAttachments"];
  retargetTask?: HostDispatchContext["retargetTask"];
  devServerAccess?: HostDispatchContext["devServerAccess"];
  nativeBufferRecovery?: HostDispatchContext["nativeBufferRecovery"];
};

export type HostWebSocketOptions = {
  server: Server;
  environmentId: string;
  authenticate: (token: string, signal: AbortSignal) => Promise<HostWsPrincipal | null>;
  dispatch: (method: string, params: unknown, context: HostDispatchContext) => Promise<unknown>;
  /** An explicit routed service allowlist, never the whole schema registry. */
  methods?: readonly string[];
  capabilities?: readonly string[];
  subscriptions?: HostSubscriptionHub;
  bulk?: HostBulkTransfers;
  bulkDependencies?: (
    method: string,
    params: Record<string, unknown>,
  ) => readonly string[] | Promise<readonly string[]>;
  /** Exact reverse-proxy Host values require deliberate composition. No wildcards. */
  allowedHosts?: readonly string[];
  limits?: Partial<
    Pick<
      typeof WS_LIMITS,
      | "maxPendingRpc"
      | "maxAuthenticatedSockets"
      | "maxSocketsPerDevice"
      | "maxUnauthenticatedSockets"
      | "maxUnauthenticatedSocketsPerSource"
      | "maxAuthenticationJobs"
      | "maxAuthenticationJobsPerSource"
      | "maxReadJobs"
      | "maxReadJobsPerDevice"
      | "maxControlJobs"
      | "maxControlJobsPerDevice"
      | "handshakeTimeoutMs"
      | "heartbeatIntervalMs"
      | "heartbeatResponseTimeoutMs"
      | "defaultResponseTimeoutMs"
      | "maxSocketQueuedBytes"
    >
  >;
};

type Peer = {
  socket: WebSocket;
  principal: HostWsPrincipal;
  id: string;
  ready: boolean;
  initializing: boolean;
  closed: boolean;
  pending: Map<string, AbortController>;
  controls: Set<string>;
  helloTimer: ReturnType<typeof setTimeout>;
  pongTimer?: ReturnType<typeof setTimeout>;
  closeTimer?: ReturnType<typeof setTimeout>;
  heartbeatCheck?: AbortController;
};

class RequestExpired extends Error {}

function rejectUpgrade(socket: Duplex, status: number): void {
  if (socket.destroyed) return;
  const phrase =
    status === 401 ? "Unauthorized" : status === 429 ? "Too Many Requests" : "Bad Request";
  socket.end(`HTTP/1.1 ${status} ${phrase}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () =>
    socket.destroy(),
  );
}

function waitFor<T>(action: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    void action.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

/**
 * Authenticated native read pilot. This is not the full WS session transport:
 * mutations, live subscriptions, browser tickets and LAN TLS are not advertised.
 */
export function attachHostWebSocketTransport(options: HostWebSocketOptions) {
  const limits = { ...WS_LIMITS, ...options.limits };
  for (const value of Object.values(limits))
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error("Invalid Host WS resource limit.");
  const workBudget = new HostReadWorkBudget(limits);
  const methods = options.methods ?? READ_METHODS;
  for (const method of methods)
    if (
      !getHostRpcMethod(method) ||
      method.startsWith("connection.") ||
      method.startsWith("subscriptions.") ||
      method === "requests.cancel"
    )
      throw new Error("Invalid routed Host method.");
  const subscriptionMethods = options.subscriptions
    ? ["subscriptions.open", "subscriptions.ack", "subscriptions.close"]
    : [];
  const capabilities = [
    ...new Set([
      HOST_WS_READ_CAPABILITY,
      ...(options.capabilities ?? []),
      ...(options.subscriptions ? ["transport.ws.streams.v2"] : []),
    ]),
  ];
  const peers = new Set<Peer>();
  const upgrading = new Set<Duplex>();
  const sources = new Map<string, number>();
  const authenticationJobs = new Map<object, { source: string; controller: AbortController }>();
  const authenticationSources = new Map<string, number>();
  let closing = false;
  const sockets = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload: WS_LIMITS.maxMessageBytes,
    perMessageDeflate: false,
    handleProtocols: (protocols) => (protocols.has(WS_SUBPROTOCOL) ? WS_SUBPROTOCOL : false),
  });

  function closePeer(peer: Peer, code = 1008, reason = "Connection no longer authorized."): void {
    if (peer.closed) return;
    peer.closed = true;
    options.subscriptions?.detach(peer.id);
    clearTimeout(peer.helloTimer);
    clearTimeout(peer.pongTimer);
    peer.heartbeatCheck?.abort(new Error("Connection closed."));
    for (const controller of peer.pending.values())
      controller.abort(new Error("Connection closed."));
    peer.pending.clear();
    peer.controls.clear();
    if (peer.socket.readyState === WebSocket.OPEN) peer.socket.close(code, reason);
    // ws may already be sending a protocol close (1007/1009). Preserve it.
    if (peer.socket.readyState === WebSocket.CLOSING) {
      peer.closeTimer = setTimeout(() => peer.socket.terminate(), 1_000);
      peer.closeTimer.unref();
    } else if (peer.socket.readyState !== WebSocket.CLOSED) peer.socket.terminate();
  }

  function send(peer: Peer, value: unknown): boolean {
    if (peer.closed || peer.socket.readyState !== WebSocket.OPEN) return false;
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
      if (Buffer.byteLength(serialized) > WS_LIMITS.maxMessageBytes)
        throw new Error("Response too large.");
      const wire = JSON.parse(serialized);
      if (wire?.method === "subscription.event") SubscriptionEventSchema.parse(wire);
      else RpcResponseSchema.parse(wire);
    } catch {
      closePeer(peer, 1011, "Response cannot be represented by this transport.");
      return false;
    }
    if (peer.socket.bufferedAmount + Buffer.byteLength(serialized) > limits.maxSocketQueuedBytes) {
      closePeer(peer, 1013, "Slow consumer; reconnect explicitly.");
      return false;
    }
    peer.socket.send(serialized, (error) => {
      if (error) closePeer(peer, 1011, "Connection write failed.");
    });
    return true;
  }

  function failure(
    peer: Peer,
    id: string | null,
    code: number,
    message: string,
    data?: RpcError["data"],
  ): void {
    send(peer, { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } });
  }

  async function authorized(peer: Peer): Promise<boolean> {
    return !peer.closed && (await executionAuthorized(peer));
  }

  async function executionAuthorized(peer: Peer): Promise<boolean> {
    try {
      return await workBudget.run(
        peer.principal.id,
        async () => await peer.principal.authorized(),
        "control",
      );
    } catch (error) {
      if (error instanceof HostDispatchError && error.code === "overloaded") throw error;
      return false;
    }
  }

  async function handle(peer: Peer, request: RpcRequest): Promise<void> {
    if (!peer.ready) {
      if (request.method !== "connection.hello" || peer.initializing) {
        failure(
          peer,
          request.id,
          RPC_ERROR_CODES.notReady,
          "Negotiate the connection before requesting data.",
        );
        return;
      }
      peer.initializing = true;
      const hello = ConnectionHelloParamsSchema.parse(request.params);
      if (hello.environmentId !== options.environmentId) {
        failure(
          peer,
          request.id,
          RPC_ERROR_CODES.wrongEnvironment,
          "Host identity changed; reconnect explicitly.",
        );
        closePeer(peer);
        return;
      }
      if (!(await authorized(peer))) {
        failure(
          peer,
          request.id,
          RPC_ERROR_CODES.unauthorized,
          "Device authorization was revoked.",
        );
        closePeer(peer);
        return;
      }
      if (peer.closed) return;
      peer.ready = true;
      clearTimeout(peer.helloTimer);
      const result = ConnectionHelloResultSchema.parse({
        environmentId: options.environmentId,
        wireVersion: WS_WIRE_VERSION,
        schemaVersion: HOST_SCHEMA_VERSION,
        connectionId: peer.id,
        capabilities,
        methods: ["connection.probe", "requests.cancel", ...subscriptionMethods, ...methods],
      });
      send(peer, { jsonrpc: "2.0", id: request.id, result });
      return;
    }
    const localControl =
      request.method === "connection.probe" ||
      request.method === "requests.cancel" ||
      subscriptionMethods.includes(request.method);
    const control = hostRpcCost(request.method, request.params) === "control";
    if (!localControl && !methods.includes(request.method)) {
      failure(
        peer,
        request.id,
        RPC_ERROR_CODES.methodNotFound,
        "Method is not enabled on this connection.",
      );
      return;
    }
    if (peer.pending.has(request.id)) {
      closePeer(peer, 1008, "Duplicate in-flight request identity.");
      return;
    }
    // Reserve before the first authorization await, including detached work.
    if (
      control
        ? peer.controls.size >= 8
        : peer.pending.size - peer.controls.size >= limits.maxPendingRpc
    ) {
      failure(peer, request.id, RPC_ERROR_CODES.overloaded, "Too many pending requests.");
      return;
    }
    const controller = new AbortController();
    peer.pending.set(request.id, controller);
    if (control) peer.controls.add(request.id);
    const definition = getHostRpcMethod(request.method)!;
    const deadline = setTimeout(
      () => controller.abort(new RequestExpired()),
      Math.min(limits.defaultResponseTimeoutMs, definition.responseTimeoutMs),
    );
    deadline.unref();
    try {
      if (!(await waitFor(authorized(peer), controller.signal))) {
        failure(
          peer,
          request.id,
          RPC_ERROR_CODES.unauthorized,
          "Device authorization was revoked.",
        );
        closePeer(peer);
        return;
      }
      if (request.method === "connection.probe") {
        send(peer, {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            environmentId: options.environmentId,
            connectionId: peer.id,
          },
        });
        return;
      }
      if (request.method === "requests.cancel") {
        const target = peer.pending.get(String(request.params.requestId));
        const accepted = !!target && !peer.controls.has(String(request.params.requestId));
        if (accepted) target.abort(new Error("Request cancelled."));
        send(peer, { jsonrpc: "2.0", id: request.id, result: { accepted } });
        return;
      }
      if (request.method === "subscriptions.open" && options.subscriptions) {
        const opened = options.subscriptions.open(
          {
            connectionId: peer.id,
            principalId: peer.principal.id,
            authorized: () => authorized(peer),
            executionAuthorized: () => executionAuthorized(peer),
            send: (event) => send(peer, event),
          },
          SubscriptionOpenParamsSchema.parse(request.params),
        );
        if (send(peer, { jsonrpc: "2.0", id: request.id, result: opened.result }))
          opened.activate();
        return;
      }
      if (request.method === "subscriptions.ack" && options.subscriptions) {
        const accepted = options.subscriptions.acknowledge(
          peer.id,
          String(request.params.subscriptionId),
          request.params.cursor as { epoch: string; sequence: number },
        );
        send(peer, { jsonrpc: "2.0", id: request.id, result: { accepted } });
        return;
      }
      if (request.method === "subscriptions.close" && options.subscriptions) {
        const accepted = options.subscriptions.closeSubscription(
          peer.id,
          String(request.params.subscriptionId),
        );
        send(peer, { jsonrpc: "2.0", id: request.id, result: { accepted } });
        return;
      }
      const resource =
        typeof request.params.sessionId === "string"
          ? `session:${request.params.sessionId}`
          : typeof request.params.projectId === "string"
            ? `project:${request.params.projectId}`
            : "environment";
      const action = async () => {
        const dependencies = options.bulk
          ? await (options.bulkDependencies?.(request.method, request.params) ??
              hostBulkDependencies(request.method, request.params))
          : [];
        const lease = options.bulk?.begin(peer.principal.id, resource, dependencies);
        try {
          const result = await options.dispatch(request.method, request.params, {
            environmentId: options.environmentId,
            principal: { kind: "device", id: peer.principal.id },
            authorized: () => authorized(peer),
            executionAuthorized: () => executionAuthorized(peer),
            trackWork: (work) =>
              workBudget.run(peer.principal.id, work, control ? "control" : "read"),
            exposeQueueAttachments: peer.principal.exposeQueueAttachments,
            retargetTask: peer.principal.retargetTask,
            devServerAccess: peer.principal.devServerAccess,
            nativeBufferRecovery: peer.principal.nativeBufferRecovery,
            signal: definition.cancellation === "query" ? controller.signal : undefined,
          });
          const validated = definition.resultSchema.parse(JSON.parse(JSON.stringify(result)));
          return lease
            ? options.bulk!.encode(
                lease,
                JsonValueSchema.parse(validated),
                WS_LIMITS.maxMessageBytes - 1024,
              )
            : validated;
        } finally {
          if (lease) options.bulk!.release(lease);
        }
      };
      const result = await waitFor(
        workBudget.run(peer.principal.id, action, control ? "control" : "read"),
        controller.signal,
      );
      if (!(await waitFor(authorized(peer), controller.signal))) {
        failure(
          peer,
          request.id,
          RPC_ERROR_CODES.unauthorized,
          "Device authorization was revoked.",
        );
        closePeer(peer);
      } else if (!controller.signal.aborted) send(peer, { jsonrpc: "2.0", id: request.id, result });
    } catch (error) {
      if (peer.closed) return;
      if (controller.signal.reason instanceof RequestExpired)
        failure(peer, request.id, RPC_ERROR_CODES.deadlineExceeded, "Request deadline exceeded.", {
          category: "deadline",
          retryable: definition.kind === "query",
          ...(definition.kind === "command"
            ? { commandId: String(request.params.commandId), delivery: "unknown" as const }
            : {}),
        });
      else if (controller.signal.aborted)
        failure(peer, request.id, RPC_ERROR_CODES.cancelled, "Request cancelled.", {
          category: "cancelled",
          retryable: definition.kind === "query",
          ...(definition.kind === "command"
            ? { commandId: String(request.params.commandId), delivery: "unknown" as const }
            : {}),
        });
      else if (error instanceof HostDispatchError) {
        failure(peer, request.id, DISPATCH_ERROR_CODES[error.code], error.message, error.details);
        if (error.code === "unauthorized") closePeer(peer);
      } else if (error instanceof HostStreamError)
        failure(
          peer,
          request.id,
          error.code === "limit" ? RPC_ERROR_CODES.overloaded : RPC_ERROR_CODES.invalidParams,
          error.message,
        );
      else if (error instanceof HostBulkError)
        failure(
          peer,
          request.id,
          error.status === 429 ? RPC_ERROR_CODES.overloaded : RPC_ERROR_CODES.resyncRequired,
          error.message,
        );
      else failure(peer, request.id, RPC_ERROR_CODES.internalError, "Host read failed.");
    } finally {
      clearTimeout(deadline);
      peer.pending.delete(request.id);
      peer.controls.delete(request.id);
    }
  }

  function connected(socket: WebSocket, principal: HostWsPrincipal): void {
    const peer: Peer = {
      socket,
      principal,
      id: randomUUID(),
      ready: false,
      initializing: false,
      closed: false,
      pending: new Map(),
      controls: new Set(),
      helloTimer: setTimeout(
        () => closePeer(peer, 1008, "Connection negotiation timed out."),
        limits.handshakeTimeoutMs,
      ),
    };
    peer.helloTimer.unref();
    peers.add(peer);
    socket.on("pong", () => {
      clearTimeout(peer.pongTimer);
      peer.pongTimer = undefined;
    });
    socket.on("close", () => {
      closePeer(peer);
      clearTimeout(peer.closeTimer);
      peers.delete(peer);
    });
    socket.on("error", () => closePeer(peer, 1011, "Connection failed."));
    socket.on("message", (data, binary) => {
      if (peer.closed) return;
      if (binary) {
        closePeer(peer, 1003, "Only JSON text messages are supported.");
        return;
      }
      let value: unknown;
      try {
        value = JSON.parse(data.toString());
      } catch {
        failure(peer, null, RPC_ERROR_CODES.parseError, "Invalid JSON message.");
        return;
      }
      const raw =
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : undefined;
      const id = IdentifierSchema.safeParse(raw?.id);
      if (
        typeof raw?.method === "string" &&
        (!getHostRpcMethod(raw.method) ||
          ![
            "connection.hello",
            "connection.probe",
            "requests.cancel",
            ...subscriptionMethods,
            ...methods,
          ].includes(raw.method))
      ) {
        failure(
          peer,
          id.success ? id.data : null,
          RPC_ERROR_CODES.methodNotFound,
          "Unsupported Host RPC method.",
        );
        return;
      }
      let request: RpcRequest;
      try {
        request = parseRpcRequest(value);
      } catch (error) {
        const invalidParams =
          error instanceof ZodError &&
          error.issues.length > 0 &&
          error.issues.every((issue) => issue.path[0] === "params");
        failure(
          peer,
          id.success ? id.data : null,
          invalidParams ? RPC_ERROR_CODES.invalidParams : RPC_ERROR_CODES.invalidRequest,
          "Invalid Host RPC request.",
        );
        return;
      }
      void handle(peer, request).catch(() => {
        failure(peer, request.id, RPC_ERROR_CODES.internalError, "Host request failed.");
      });
    });
  }

  function validHost(request: IncomingMessage): boolean {
    const address = options.server.address();
    if (!address || typeof address === "string") return false;
    const allowed = [
      `127.0.0.1:${address.port}`,
      `localhost:${address.port}`,
      `[::1]:${address.port}`,
      ...(options.allowedHosts ?? []),
    ];
    const host = request.headers.host;
    if (typeof host !== "string") return false;
    if (allowed.includes(host)) return true;
    // SSH may map a different local port onto this listener. The hostname must
    // still be literal loopback; credentials and hello bind the actual Host.
    try {
      const endpoint = new URL(`http://${host}`);
      const port = Number(endpoint.port || 80);
      return (
        endpoint.host === host.toLowerCase() &&
        !endpoint.username &&
        !endpoint.password &&
        ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) &&
        Number.isInteger(port) &&
        port >= 1 &&
        port <= 65_535
      );
    } catch {
      return false;
    }
  }

  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const source =
      socket instanceof Object && "remoteAddress" in socket
        ? String(socket.remoteAddress ?? "unknown")
        : "unknown";
    const protocol = request.headers["sec-websocket-protocol"]
      ?.split(",")
      .map((value) => value.trim());
    const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (
      closing ||
      request.url !== "/ws" ||
      request.headers.origin !== undefined ||
      !validHost(request) ||
      !protocol?.includes(WS_SUBPROTOCOL) ||
      !token
    ) {
      rejectUpgrade(socket, token ? 400 : 401);
      return;
    }
    if (
      upgrading.size >= limits.maxUnauthenticatedSockets ||
      (sources.get(source) ?? 0) >= limits.maxUnauthenticatedSocketsPerSource ||
      authenticationJobs.size >= limits.maxAuthenticationJobs ||
      (authenticationSources.get(source) ?? 0) >= limits.maxAuthenticationJobsPerSource
    ) {
      rejectUpgrade(socket, 429);
      return;
    }
    upgrading.add(socket);
    sources.set(source, (sources.get(source) ?? 0) + 1);
    const controller = new AbortController();
    const job = {};
    authenticationJobs.set(job, { source, controller });
    authenticationSources.set(source, (authenticationSources.get(source) ?? 0) + 1);
    let released = false;
    const releaseUpgrade = () => {
      if (released) return;
      released = true;
      clearTimeout(timeout);
      upgrading.delete(socket);
      const count = (sources.get(source) ?? 1) - 1;
      if (count > 0) sources.set(source, count);
      else sources.delete(source);
    };
    const timeout = setTimeout(() => {
      controller.abort(new RequestExpired());
      socket.destroy();
      releaseUpgrade();
    }, limits.handshakeTimeoutMs);
    timeout.unref();
    socket.on("error", () => socket.destroy());
    socket.once("close", () => {
      controller.abort(new Error("Upgrade closed."));
      releaseUpgrade();
    });
    // Socket admission expires independently, but a non-cooperative auth job
    // keeps its separate bounded budget until the backend actually settles.
    const authentication = (async () => {
      const principal = await options.authenticate(token, controller.signal);
      if (controller.signal.aborted || !principal) return null;
      return (await principal.authorized()) ? principal : null;
    })();
    const releaseJob = () => {
      authenticationJobs.delete(job);
      const count = (authenticationSources.get(source) ?? 1) - 1;
      if (count > 0) authenticationSources.set(source, count);
      else authenticationSources.delete(source);
    };
    void authentication.then(releaseJob, releaseJob);
    void (async () => {
      try {
        const principal = await waitFor(authentication, controller.signal);
        if (closing || socket.destroyed) return;
        if (!principal) {
          rejectUpgrade(socket, 401);
          return;
        }
        if (closing || socket.destroyed) return;
        if (
          peers.size >= limits.maxAuthenticatedSockets ||
          [...peers].filter((peer) => peer.principal.id === principal.id).length >=
            limits.maxSocketsPerDevice
        ) {
          rejectUpgrade(socket, 429);
          return;
        }
        sockets.handleUpgrade(request, socket, head, (ws) => connected(ws, principal));
      } catch {
        rejectUpgrade(socket, 401);
      } finally {
        releaseUpgrade();
      }
    })();
  };
  options.server.on("upgrade", upgrade);
  const heartbeat = setInterval(() => {
    for (const peer of peers) {
      if (peer.closed || peer.pongTimer || peer.heartbeatCheck) continue;
      const controller = new AbortController();
      peer.heartbeatCheck = controller;
      const authDeadline = setTimeout(
        () => controller.abort(new RequestExpired()),
        limits.heartbeatResponseTimeoutMs,
      );
      authDeadline.unref();
      void waitFor(authorized(peer), controller.signal)
        .then((permitted) => {
          if (!permitted) {
            closePeer(peer);
            return;
          }
          if (peer.closed || peer.socket.readyState !== WebSocket.OPEN || peer.pongTimer) return;
          peer.pongTimer = setTimeout(() => {
            closePeer(peer, 1001, "Connection heartbeat timed out.");
            peer.socket.terminate();
          }, limits.heartbeatResponseTimeoutMs);
          peer.pongTimer.unref();
          peer.socket.ping();
        })
        .catch(() => {
          closePeer(peer, 1001, "Connection authorization timed out.");
          peer.socket.terminate();
        })
        .finally(() => {
          clearTimeout(authDeadline);
          if (peer.heartbeatCheck === controller) peer.heartbeatCheck = undefined;
        });
    }
  }, limits.heartbeatIntervalMs);
  heartbeat.unref();
  let closePromise: Promise<void> | undefined;
  return {
    capability: HOST_WS_READ_CAPABILITY,
    close(): Promise<void> {
      return (closePromise ??= new Promise<void>((resolve) => {
        closing = true;
        clearInterval(heartbeat);
        options.server.off("upgrade", upgrade);
        for (const job of authenticationJobs.values())
          job.controller.abort(new Error("Host is stopping."));
        for (const socket of upgrading) socket.destroy();
        for (const peer of peers) {
          closePeer(peer, 1001, "Host is stopping.");
          peer.socket.terminate();
        }
        sockets.close(() => resolve());
      }));
    },
  };
}
