import {
  composeJsonWire,
  normalizeJsonField,
  normalizeJsonWire,
  readNormalizedJsonWire,
  type NormalizedJsonWire,
} from "../normalized-wire";
import { randomUUID, timingSafeEqual } from "node:crypto";
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
  hostRpcHasEffect,
  parseRpcRequest,
  type RpcRequest,
  type RpcError,
} from "../../../src/shared/model/host-contracts";
import { HostDispatchError, type HostDispatchContext } from "../dispatch";
import { createLogger } from "../../diagnostics/logger";
import {
  heldPollWaitMs,
  runWithRequestTrace,
  slowRequestFields,
  startRequestTrace,
  type RequestOutcome,
  type RequestTrace,
} from "../../diagnostics/request-trace";
import { elapsedSince, monotonicNow, wallClockGap } from "../../../src/shared/lib/time/timestamps";
import { effectFailureDelivery } from "./effect-failure-delivery";
import { HostReadWorkBudget } from "../read-budget";
import { AdmissionSources } from "./admission-source";
import { ControlLane, ControlLaneBusy } from "./control-lane";
import { PeerMessageBudget, WS_MESSAGE_BUDGET } from "./message-budget";
import { HostBulkError, hostBulkDependencies, type HostBulkTransfers } from "../http/bulk";
import { HostStreamError, type HostSubscriptionHub } from "./subscriptions";
import {
  dispatchErrorCode,
  hostHeaderAllowed,
  principalCapabilities,
  rejectUpgrade,
  waitFor,
} from "./server-helpers";
import { isTunnelUpgradeUrl } from "../../dev-servers/dev-server-tunnel";
import { isBrowserMediaUpgrade } from "../../browser/browser-media";
import {
  authorizeWith,
  invalidRequestMessage,
  withoutPayload,
  type AuthMode,
} from "./server-helpers";

export const HOST_WS_READ_CAPABILITY = "transport.ws.read.v2";
const READ_METHODS = ["environment.describe", "projects.list"] as const;
const resultLog = createLogger("host.ws");
const SLOW_REQUEST_MS = 5_000;

export type HostWsPrincipal = {
  id: string;
  /** A device token is checked again at admission and before result delivery. */
  authorized: () => boolean | Promise<boolean>;
  exposeQueueAttachments?: HostDispatchContext["exposeQueueAttachments"];
  retargetTask?: HostDispatchContext["retargetTask"];
  devServerAccess?: HostDispatchContext["devServerAccess"];
  requesterName?: HostDispatchContext["requesterName"];
  workspaceOwner?: HostDispatchContext["workspaceOwner"];
  nativeServices?: HostDispatchContext["nativeServices"];
  nativeDevices?: HostDispatchContext["nativeDevices"];
  nativeDelivery?: HostDispatchContext["nativeDelivery"];
};

export type HostWebSocketOptions = {
  server: Server;
  environmentId: string;
  mobileIngressSecret?: string;
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
  /** Exact reverse-proxy Host values require deliberate composition. No wildcards.
   * A function is read on every upgrade so a learned proxy name (Tailscale Serve) applies live. */
  allowedHosts?: readonly string[] | (() => readonly string[]);
  /** Gives a loopback proxy a retryable refusal while its exact name is being discovered. */
  retryUnknownHost?: (host: string) => boolean;
  limits?: Partial<
    Record<
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
      | "maxControlRequestsPerSocket"
      | "maxSubscriptionControlsPerSocket"
      | "maxQueuedSubscriptionControlsPerSocket"
      | "handshakeTimeoutMs"
      | "heartbeatIntervalMs"
      | "heartbeatResponseTimeoutMs"
      | "defaultResponseTimeoutMs"
      | "maxSocketQueuedBytes",
      number
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
  /** Request id -> method and start, so a close names what it abandoned. */
  inflight: Map<string, { method: string; startedAt: number }>;
  openedAt: number;
  /** Ids of every control request, queued subscription controls included; none can be cancelled. */
  controls: Set<string>;
  /** Subscription open, ack and close queue here instead of failing against the control cap. */
  subscriptionLane: ControlLane;
  helloTimer: ReturnType<typeof setTimeout>;
  pongTimer?: ReturnType<typeof setTimeout>;
  /** `monotonicNow()` of the first shed frame in an unbroken run over the queue cap. */
  overCapSince?: number;
  /** Wall-clock time of the outstanding ping; sleep shows up as a gap against it. */
  pingSentAt: number;
  pongGraceUsed: boolean;
  /** Payload bytes handed to `socket.send`; with `bufferedAmount` it yields bytes actually flushed. */
  sentBytes: number;
  /** Flushed bytes when the pong deadline was last armed; progress past it proves a draining link. */
  pongFlushedAt: number;
  /** Deadline extensions granted to a draining link for the outstanding ping. */
  pongDrainExtensions: number;
  /** Wall-clock time of the last inbound frame or pong; a dead socket stops advancing it. */
  lastInboundAt: number;
  /** Charged for every inbound message before it is parsed. */
  messageBudget: PeerMessageBudget;
  closeTimer?: ReturnType<typeof setTimeout>;
  heartbeatCheck?: AbortController;
};

class RequestExpired extends Error {}

/** A queue that stays over its cap this long is a dead or hopeless link, not one lagging stream. */
const SLOW_CONSUMER_GRACE_MS = 30_000;

/**
 * A ping is written behind every frame already queued on the socket, so on a slow link its pong
 * cannot arrive within one response window while a large snapshot drains. A peer whose queue is
 * still flushing earns another window, at most this many per ping; a peer that stops flushing,
 * or outlasts them, is retired as before.
 */
const HEARTBEAT_DRAIN_EXTENSIONS = 5;

/** Bytes the socket has actually flushed; never moves backwards, a stalled peer freezes it. */
function flushedBytes(peer: Peer): number {
  return peer.sentBytes - peer.socket.bufferedAmount;
}

/**
 * The same-device socket a legitimate reconnect may retire once the per-device cap is reached.
 * A socket qualifies only when it has been silent for a bounded time: either its ping is still
 * unanswered past the response window, or it has missed a whole heartbeat cycle plus that window.
 * Any socket with recent inbound traffic is left alone; among qualifiers the stalest goes first.
 */
function retiredSocketFor(
  deviceSockets: readonly Peer[],
  now: number,
  unansweredMs: number,
  silentMs: number,
): Peer | undefined {
  let retired: Peer | undefined;
  for (const peer of deviceSockets) {
    const idle = elapsedSince(peer.lastInboundAt, now);
    const unanswered = peer.pongTimer !== undefined && idle >= unansweredMs;
    if (!unanswered && idle < silentMs) continue;
    if (!retired || peer.lastInboundAt < retired.lastInboundAt) retired = peer;
  }
  return retired;
}

/** A finished result that cannot fit one frame; only this request fails, never the socket. */
class ResultTooLarge extends Error {}

/** Classifies by type only, so no error text or request content can reach the log. */
function requestOutcome(error: unknown, signal: AbortSignal, closed: boolean): RequestOutcome {
  if (closed) return "disconnected";
  if (signal.reason instanceof RequestExpired) return "deadline";
  if (signal.aborted) return "cancelled";
  if (error instanceof ControlLaneBusy) return "overloaded";
  if (error instanceof ResultTooLarge) return "too-large";
  if (error instanceof HostDispatchError)
    return error.code === "unauthorized"
      ? "unauthorized"
      : error.code === "overloaded"
        ? "overloaded"
        : "rejected";
  if (error instanceof HostStreamError || error instanceof HostBulkError) return "rejected";
  return "failed";
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
  // Authorization work keeps bounded slots until physical settlement.
  const authBudget = new HostReadWorkBudget(limits);
  const heartbeatBudget = new HostReadWorkBudget({
    ...limits,
    maxControlJobs: limits.maxAuthenticatedSockets,
    maxControlJobsPerDevice: limits.maxSocketsPerDevice,
  });
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
  const admissionSources = new AdmissionSources();
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
    // Every close names its cause and abandoned work; a normal shutdown or replacement is info.
    resultLog[code === 1001 && peer.inflight.size === 0 ? "info" : "warn"]("connection closed", {
      peer: peer.id.slice(0, 8),
      code,
      reason,
      ready: peer.ready,
      ageMs: Math.round(elapsedSince(peer.openedAt)),
      bufferedBytes: peer.socket.bufferedAmount,
      pending: peer.inflight.size,
      methods: [...peer.inflight.values()]
        .slice(0, 8)
        .map(({ method, startedAt }) => `${method}@${Math.round(elapsedSince(startedAt))}ms`)
        .join(","),
    });
    peer.inflight.clear();
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

  /**
   * A stream event the socket queue refuses returns `"slow"` and leaves the socket open, so the
   * hub resyncs that one subscription. Essential stream frames (resync, close) and every
   * non-stream frame may use a small reserve above the cap. The socket closes only when
   * even the reserve is exhausted or the queue stays over the cap past the grace period.
   */
  function send(
    peer: Peer,
    value: unknown,
    normalized?: NormalizedJsonWire,
    stream?: { essential: boolean },
  ): boolean | "slow" {
    if (peer.closed || peer.socket.readyState !== WebSocket.OPEN) return false;
    let serialized: string;
    let byteLength = -1;
    try {
      const capture = normalized ? readNormalizedJsonWire(normalized) : undefined;
      serialized = capture?.serialized ?? JSON.stringify(value);
      byteLength = capture?.byteLength ?? Buffer.byteLength(serialized);
      if (byteLength > WS_LIMITS.maxMessageBytes) throw new Error("Response too large.");
      // The wire is JSON.parse output either way, so the payload is JSON by
      // construction; validate the envelope without walking a large payload.
      const wire = withoutPayload(capture ? capture.wire : JSON.parse(serialized)) as {
        method?: unknown;
      } | null;
      if (wire?.method === "subscription.event") SubscriptionEventSchema.parse(wire);
      else RpcResponseSchema.parse(wire);
    } catch (error) {
      const id = (value as { id?: unknown } | null)?.id;
      resultLog.warn("response not sendable", {
        method: typeof id === "string" ? peer.inflight.get(id)?.method : undefined,
        bytes: byteLength,
        maxBytes: WS_LIMITS.maxMessageBytes,
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      });
      closePeer(peer, 1011, "Response cannot be represented by this transport.");
      return false;
    }
    const queued = peer.socket.bufferedAmount + byteLength;
    if (queued <= limits.maxSocketQueuedBytes) peer.overCapSince = undefined;
    else {
      const shed = !!stream && !stream.essential;
      const now = monotonicNow();
      if (shed) peer.overCapSince ??= now;
      const sustained =
        peer.overCapSince !== undefined &&
        elapsedSince(peer.overCapSince, now) > SLOW_CONSUMER_GRACE_MS;
      if (shed && !sustained) {
        resultLog.info("slow stream shed", {
          bytes: byteLength,
          bufferedBytes: peer.socket.bufferedAmount,
          maxQueuedBytes: limits.maxSocketQueuedBytes,
        });
        return "slow";
      }
      // Essential and non-stream frames ride the reserve above the cap.
      if (sustained || queued > Math.floor(limits.maxSocketQueuedBytes * 1.25)) {
        resultLog.warn("slow consumer", {
          bytes: byteLength,
          bufferedBytes: peer.socket.bufferedAmount,
          maxQueuedBytes: limits.maxSocketQueuedBytes,
          sustained,
        });
        closePeer(peer, 1013, "Slow consumer; reconnect explicitly.");
        return false;
      }
    }
    peer.socket.send(serialized, (error) => {
      if (error) {
        resultLog.warn("connection write failed", { error: error.message.slice(0, 200) });
        closePeer(peer, 1011, "Connection write failed.");
      }
    });
    peer.sentBytes += byteLength;
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

  async function authorized(peer: Peer, mode: AuthMode = "own"): Promise<boolean> {
    return !peer.closed && (await executionAuthorized(peer, mode));
  }

  async function executionAuthorized(peer: Peer, mode: AuthMode = "own"): Promise<boolean> {
    try {
      const budget = mode === "heartbeat" ? heartbeatBudget : authBudget;
      return await authorizeWith(budget, mode, peer.principal);
    } catch (error) {
      if (error instanceof HostDispatchError && error.code === "overloaded") throw error;
      throw new HostDispatchError(
        "service-unavailable",
        "Device authorization could not be verified; retry later.",
        { cause: error },
        { category: "unavailable", retryable: true, delivery: "not-sent" },
      );
    }
  }

  async function handle(peer: Peer, request: RpcRequest, trace: RequestTrace): Promise<void> {
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
      let permitted: boolean;
      try {
        permitted = await authorized(peer, "shared");
      } catch (error) {
        if (
          !(error instanceof HostDispatchError) ||
          !["overloaded", "service-unavailable"].includes(error.code)
        )
          throw error;
        peer.initializing = false;
        failure(peer, request.id, dispatchErrorCode(error), error.message, error.details);
        return;
      }
      if (!permitted) {
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
    // Reserve before the first authorization await, including detached work. Subscription
    // controls reserve a place in their own lane (a slot, else the FIFO queue); the rest of the
    // controls and the reads keep their separate caps, so a stream burst starves neither.
    const subscriptionControl = subscriptionMethods.includes(request.method);
    const laneLease = subscriptionControl ? peer.subscriptionLane.reserve() : undefined;
    if (
      subscriptionControl
        ? !laneLease
        : control
          ? peer.controls.size - peer.subscriptionLane.outstanding >=
            limits.maxControlRequestsPerSocket
          : peer.pending.size - peer.controls.size >= limits.maxPendingRpc
    ) {
      failure(peer, request.id, RPC_ERROR_CODES.overloaded, "Too many pending requests.", {
        category: "overload",
        retryable: true,
        delivery: "not-sent",
      });
      return;
    }
    const controller = new AbortController();
    peer.pending.set(request.id, controller);
    const ingressAt = monotonicNow();
    peer.inflight.set(request.id, { method: request.method, startedAt: ingressAt });
    if (control) peer.controls.add(request.id);
    const definition = getHostRpcMethod(request.method)!;
    const responseTimeoutMs = Math.min(
      options.limits?.defaultResponseTimeoutMs ?? definition.responseTimeoutMs,
      definition.responseTimeoutMs,
    );
    // The deadline runs from ingress, so time spent queued in the lane counts against it.
    const deadline = setTimeout(() => controller.abort(new RequestExpired()), responseTimeoutMs);
    deadline.unref();
    let dispatchStarted = false;
    try {
      // A queued subscription control waits its admission time at most; nothing has run yet.
      if (laneLease)
        await laneLease.held(
          controller.signal,
          Math.min(definition.admissionTimeoutMs, responseTimeoutMs),
        );
      if (!(await waitFor(authorized(peer, "shared"), controller.signal))) {
        trace.outcome = "unauthorized";
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
      // Checks overlap, effects do not: open, ack and close take effect in arrival order.
      if (laneLease) await laneLease.ordered(controller.signal);
      if (request.method === "subscriptions.open" && options.subscriptions) {
        const opened = options.subscriptions.open(
          {
            connectionId: peer.id,
            principalId: peer.principal.id,
            authorized: () => authorized(peer),
            executionAuthorized: () => executionAuthorized(peer),
            send: (event, essential = false) => send(peer, event, undefined, { essential }),
            sendNormalized: (capture, essential = false) =>
              send(peer, undefined, capture, { essential }),
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
      const resultAuthorities: Array<() => Promise<boolean>> = [];
      const action = async (track: <T>(work: () => Promise<T>) => Promise<T>) => {
        const dependencies = options.bulk
          ? await (options.bulkDependencies?.(request.method, request.params) ??
              hostBulkDependencies(request.method, request.params))
          : [];
        const lease = options.bulk?.begin(peer.principal.id, resource, dependencies);
        try {
          dispatchStarted = true;
          trace.handlerStartedAt = monotonicNow();
          const result = await options.dispatch(request.method, request.params, {
            environmentId: options.environmentId,
            requestId: request.id,
            principal: { kind: "device", id: peer.principal.id },
            ingressAt,
            authorized: () => authorized(peer),
            executionAuthorized: () => executionAuthorized(peer),
            trackWork: (work) =>
              controller.signal.aborted
                ? Promise.reject(new HostDispatchError("cancelled", "Host work admission closed."))
                : track(work),
            ...principalCapabilities(peer.principal),
            retainResultAuthority: (check) => {
              resultAuthorities.push(check);
              if (lease) options.bulk!.retainAuthority(lease, check);
            },
            signal:
              definition.cancellation === "query" ||
              request.method === "native.services.assistant.background.execute"
                ? controller.signal
                : undefined,
          });
          trace.handlerEndedAt = monotonicNow();
          for (const check of resultAuthorities)
            if (!(await check())) throw new HostBulkError(409, "Result authority expired.");
          const initial = normalizeJsonWire(result);
          const checked = definition.resultSchema.safeParse(readNormalizedJsonWire(initial).wire);
          if (!checked.success) {
            // The caller only sees "Host read failed."; name the rejected fields (never values)
            // so a Host/contract drift is findable from the log.
            resultLog.warn("result rejected by contract", {
              method: request.method,
              paths: checked.error.issues
                .slice(0, 5)
                .map((issue) => [...issue.path, ...("keys" in issue ? issue.keys : [])].join("."))
                .join(","),
            });
            throw checked.error;
          }
          // Typed transforms may strip fields or construct new values; normalize
          // that output with its real enclosing result key before reusing bytes.
          const capture =
            definition.resultSchema === JsonValueSchema
              ? initial
              : normalizeJsonField(checked.data, "result");
          const delivered = lease
            ? options.bulk!.encodeNormalized(lease, capture, WS_LIMITS.maxMessageBytes - 1024)
            : readNormalizedJsonWire(capture).wire;
          return {
            value: delivered,
            capture:
              lease && delivered !== readNormalizedJsonWire(capture).wire
                ? normalizeJsonField(delivered, "result")
                : capture,
          };
        } finally {
          if (dispatchStarted) trace.handlerEndedAt ??= monotonicNow();
          if (lease) options.bulk!.release(lease);
        }
      };
      // A queued budget slot may start this from another request's async context.
      const tracedAction: typeof action = (track) =>
        runWithRequestTrace(trace, () => action(track));
      const result = await waitFor(
        workBudget.runScoped(peer.principal.id, tracedAction, control ? "control" : "read"),
        controller.signal,
      );
      if (!(await waitFor(authorized(peer, "shared"), controller.signal))) {
        trace.outcome = "unauthorized";
        failure(
          peer,
          request.id,
          RPC_ERROR_CODES.unauthorized,
          "Device authorization was revoked.",
          dispatchStarted && hostRpcHasEffect(request.method, definition.kind)
            ? { category: "authentication", retryable: false, delivery: "unknown" }
            : undefined,
        );
        closePeer(peer);
      } else if (!controller.signal.aborted) {
        for (const check of resultAuthorities)
          if (!(await waitFor(check(), controller.signal)))
            throw new HostBulkError(409, "Result authority expired.");
        if (!controller.signal.aborted) {
          const response = composeJsonWire(
            { jsonrpc: "2.0", id: request.id },
            "result",
            result.capture,
          );
          // An oversized result fails this request with a typed error; closing the
          // socket would drop every other request and subscription and invite a retry loop.
          const bytes = readNormalizedJsonWire(response).byteLength;
          if (bytes > WS_LIMITS.maxMessageBytes) {
            resultLog.warn("result too large", {
              method: request.method,
              bytes,
              maxBytes: WS_LIMITS.maxMessageBytes,
            });
            throw new ResultTooLarge("Result too large.");
          }
          // send still validates the complete actual wire envelope/schema and
          // enforces frame/backpressure limits after the final authority awaits.
          const written = send(peer, undefined, response);
          trace.responseEndedAt = monotonicNow();
          trace.outcome = written === true ? "sent" : "not-sent";
        }
      }
    } catch (error) {
      trace.outcome = requestOutcome(error, controller.signal, peer.closed);
      if (peer.closed) return;
      if (controller.signal.reason instanceof RequestExpired)
        failure(peer, request.id, RPC_ERROR_CODES.deadlineExceeded, "Request deadline exceeded.", {
          category: "deadline",
          retryable: definition.kind === "query" || !dispatchStarted,
          ...(hostRpcHasEffect(request.method, definition.kind)
            ? { delivery: dispatchStarted ? ("unknown" as const) : ("not-sent" as const) }
            : {}),
          ...(definition.kind === "command" ? { commandId: String(request.params.commandId) } : {}),
        });
      else if (controller.signal.aborted)
        failure(peer, request.id, RPC_ERROR_CODES.cancelled, "Request cancelled.", {
          category: "cancelled",
          retryable: definition.kind === "query",
          ...(hostRpcHasEffect(request.method, definition.kind)
            ? { delivery: dispatchStarted ? ("unknown" as const) : ("not-sent" as const) }
            : {}),
          ...(definition.kind === "command" ? { commandId: String(request.params.commandId) } : {}),
        });
      else if (error instanceof ControlLaneBusy)
        failure(peer, request.id, RPC_ERROR_CODES.overloaded, "Subscription controls are busy.", {
          category: "overload",
          retryable: true,
          delivery: "not-sent",
        });
      else if (error instanceof ResultTooLarge)
        failure(
          peer,
          request.id,
          RPC_ERROR_CODES.internalError,
          "Result too large to send; narrow the request.",
          {
            category: "unavailable",
            retryable: false,
            ...(hostRpcHasEffect(request.method, definition.kind)
              ? { delivery: "unknown" as const }
              : {}),
            ...(definition.kind === "command"
              ? { commandId: String(request.params.commandId) }
              : {}),
          },
        );
      else if (error instanceof HostDispatchError) {
        failure(
          peer,
          request.id,
          dispatchErrorCode(error),
          error.message,
          error.code === "overloaded" || error.code === "service-unavailable"
            ? {
                ...error.details,
                category:
                  error.code === "overloaded"
                    ? "overload"
                    : (error.details?.category ?? "unavailable"),
                retryable:
                  (error.code === "overloaded" || error.details?.retryable === true) &&
                  !(dispatchStarted && hostRpcHasEffect(request.method, definition.kind)),
                delivery: effectFailureDelivery(
                  error,
                  dispatchStarted,
                  hostRpcHasEffect(request.method, definition.kind),
                ),
                ...(definition.kind === "command"
                  ? { commandId: String(request.params.commandId) }
                  : {}),
              }
            : error.code === "unauthorized" &&
                dispatchStarted &&
                hostRpcHasEffect(request.method, definition.kind)
              ? {
                  category: "authentication",
                  ...error.details,
                  retryable: false,
                  delivery: "unknown",
                }
              : error.details,
        );
        if (error.code === "unauthorized") closePeer(peer);
      } else if (error instanceof HostStreamError)
        failure(
          peer,
          request.id,
          error.code === "limit" ? RPC_ERROR_CODES.overloaded : RPC_ERROR_CODES.invalidParams,
          error.message,
          error.code === "limit"
            ? { category: "overload", retryable: true, delivery: "not-sent" }
            : undefined,
        );
      else if (error instanceof HostBulkError)
        failure(
          peer,
          request.id,
          error.status === 429 ? RPC_ERROR_CODES.overloaded : RPC_ERROR_CODES.resyncRequired,
          error.message,
          error.status === 429
            ? {
                category: "overload",
                retryable: !(dispatchStarted && hostRpcHasEffect(request.method, definition.kind)),
                delivery:
                  dispatchStarted && hostRpcHasEffect(request.method, definition.kind)
                    ? "unknown"
                    : "not-sent",
              }
            : hostRpcHasEffect(request.method, definition.kind)
              ? { category: "unavailable", retryable: false, delivery: "unknown" }
              : undefined,
        );
      else
        failure(
          peer,
          request.id,
          RPC_ERROR_CODES.internalError,
          "Host read failed.",
          hostRpcHasEffect(request.method, definition.kind)
            ? { category: "unavailable", retryable: false, delivery: "unknown" }
            : undefined,
        );
    } finally {
      clearTimeout(deadline);
      const started = peer.inflight.get(request.id);
      // A slow request explains a later client deadline or interruption. `*.wait`
      // methods, and requests the Host holds (`waitMs`, such as the desktop command
      // take), are long polls: only time past the wait the Host really grants is slow.
      // Logging every held take buried the real stalls in the Host log.
      const heldWaitMs = heldPollWaitMs(request.method, request.params ?? {});
      const thresholdMs = SLOW_REQUEST_MS + heldWaitMs;
      trace.outcome ??= controller.signal.aborted
        ? requestOutcome(undefined, controller.signal, peer.closed)
        : "completed";
      if (
        started &&
        !request.method.endsWith(".wait") &&
        elapsedSince(trace.receivedAt) >= thresholdMs
      )
        resultLog.warn("slow request", {
          method: request.method,
          // Multiplexed methods (`assistant.request`) are only diagnosable by their operation.
          ...(typeof request.params?.op === "string" &&
          /^[a-z][a-zA-Z0-9.]{0,63}$/.test(request.params.op)
            ? { op: request.params.op }
            : {}),
          ms: Math.round(elapsedSince(started.startedAt)),
          ...slowRequestFields(trace, { thresholdMs, heldWaitMs }),
        });
      peer.inflight.delete(request.id);
      peer.pending.delete(request.id);
      // Together, so the control cap never sees a lane request without its lease.
      laneLease?.release();
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
      inflight: new Map(),
      openedAt: monotonicNow(),
      pingSentAt: 0,
      pongGraceUsed: false,
      sentBytes: 0,
      pongFlushedAt: 0,
      pongDrainExtensions: 0,
      lastInboundAt: Date.now(),
      messageBudget: new PeerMessageBudget(WS_MESSAGE_BUDGET, monotonicNow()),
      controls: new Set(),
      subscriptionLane: new ControlLane(
        limits.maxSubscriptionControlsPerSocket,
        limits.maxQueuedSubscriptionControlsPerSocket,
      ),
      helloTimer: setTimeout(
        () => closePeer(peer, 1008, "Connection negotiation timed out."),
        limits.handshakeTimeoutMs,
      ),
    };
    peer.helloTimer.unref();
    peers.add(peer);
    socket.on("pong", () => markInbound(peer));
    socket.on("close", (code, reason) => {
      // Closed by the client or the network before the Host chose to close it.
      closePeer(peer, code, `peer closed: ${reason.toString("utf8").slice(0, 120) || "no reason"}`);
      clearTimeout(peer.closeTimer);
      peers.delete(peer);
    });
    socket.on("error", (error) =>
      closePeer(peer, 1011, `Connection failed: ${error.message.slice(0, 160)}`),
    );
    socket.on("message", (data, binary) => {
      if (peer.closed) return;
      const receivedAt = monotonicNow();
      markInbound(peer);
      // Charged before parsing so refused floods cost no JSON, Zod or error-reply work.
      const size = Array.isArray(data)
        ? data.reduce((total, chunk) => total + chunk.byteLength, 0)
        : data.byteLength;
      const verdict = peer.messageBudget.admit(size, monotonicNow());
      if (verdict !== "accept") {
        if (verdict === "close") closePeer(peer, 1008, "Message rate limit exceeded.");
        return;
      }
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
          invalidRequestMessage(raw?.method, error),
        );
        return;
      }
      const trace = startRequestTrace("ws", receivedAt);
      void runWithRequestTrace(trace, () => handle(peer, request, trace)).catch(() => {
        failure(peer, request.id, RPC_ERROR_CODES.internalError, "Host request failed.");
      });
    });
  }

  function validHost(request: IncomingMessage): boolean {
    return hostHeaderAllowed(request, options.server, options.allowedHosts);
  }

  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    // `/ws-tunnel` has its own upgrade listener (dev-server-tunnel.ts).
    if (isTunnelUpgradeUrl(request.url) || isBrowserMediaUpgrade(request.url)) return;
    const remoteSource =
      socket instanceof Object && "remoteAddress" in socket
        ? String(socket.remoteAddress ?? "unknown")
        : "unknown";
    const claimedIngress = request.headers["x-bycoda-mobile-ingress"];
    const secret = options.mobileIngressSecret;
    const mobile =
      typeof claimedIngress === "string" &&
      typeof secret === "string" &&
      Buffer.byteLength(claimedIngress) === Buffer.byteLength(secret) &&
      timingSafeEqual(Buffer.from(claimedIngress), Buffer.from(secret));
    if (claimedIngress !== undefined && !mobile) {
      rejectUpgrade(socket, 401);
      return;
    }
    const protocol = request.headers["sec-websocket-protocol"]
      ?.split(",")
      .map((value) => value.trim());
    const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (
      closing ||
      request.url !== "/ws" ||
      request.headers.origin !== undefined ||
      !protocol?.includes(WS_SUBPROTOCOL) ||
      !token
    ) {
      rejectUpgrade(socket, token ? 400 : 401);
      return;
    }
    if (!validHost(request)) {
      const proxy =
        remoteSource === "127.0.0.1" ||
        remoteSource === "::1" ||
        remoteSource === "::ffff:127.0.0.1";
      const host = request.headers.host;
      const retry = proxy && typeof host === "string" && options.retryUnknownHost?.(host);
      rejectUpgrade(socket, retry ? 503 : 400);
      return;
    }
    // Behind a loopback proxy the socket address is shared by every phone. Forwarding headers are
    // never read; a device is told apart only by a token this Host already verified.
    const source = admissionSources.sourceFor(token, remoteSource, mobile);
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
        // Verified now, so this device's next handshakes count against its own bucket.
        admissionSources.remember(token, principal.id);
        const deviceSockets = [...peers].filter(
          (peer) => !peer.closed && peer.principal.id === principal.id,
        );
        if (deviceSockets.length >= limits.maxSocketsPerDevice) {
          // Half-dead sockets (sleep, wifi change) linger until the heartbeat
          // gives up. Once this connection is authenticated, the same device's
          // stalest silent socket yields to it instead of refusing it. Sockets
          // with recent traffic are never retired.
          const stale = retiredSocketFor(
            deviceSockets,
            Date.now(),
            limits.heartbeatResponseTimeoutMs,
            limits.heartbeatIntervalMs + limits.heartbeatResponseTimeoutMs,
          );
          if (stale) closePeer(stale, 1001, "Replaced by a newer connection.");
        }
        if (
          peers.size >= limits.maxAuthenticatedSockets ||
          [...peers].filter((peer) => !peer.closed && peer.principal.id === principal.id).length >=
            limits.maxSocketsPerDevice
        ) {
          rejectUpgrade(socket, 429);
          return;
        }
        sockets.handleUpgrade(request, socket, head, (ws) => connected(ws, principal));
      } catch {
        // Only a missing, revoked or unknown credential is 401 (clients treat it
        // as permanent). A failed verifier, store or admission is temporary.
        rejectUpgrade(socket, 503);
      } finally {
        releaseUpgrade();
      }
    })();
  };
  options.server.on("upgrade", upgrade);
  function ping(peer: Peer): void {
    if (peer.closed || peer.socket.readyState !== WebSocket.OPEN || peer.pongTimer) return;
    peer.pingSentAt = Date.now();
    peer.pongGraceUsed = false;
    peer.pongDrainExtensions = 0;
    armPongTimer(peer);
    peer.socket.ping();
    peer.pongFlushedAt = flushedBytes(peer);
  }
  /**
   * Any inbound frame, not only a pong, proves the peer is alive: a phone downloading a large
   * snapshot keeps acking while its pong is still queued behind that snapshot. The ping stays
   * in the send queue, so ordering is untouched and the next tick simply pings again.
   */
  function markInbound(peer: Peer): void {
    peer.lastInboundAt = Date.now();
    clearTimeout(peer.pongTimer);
    peer.pongTimer = undefined;
  }
  function armPongTimer(peer: Peer): void {
    peer.pongTimer = setTimeout(() => onPongOverdue(peer), limits.heartbeatResponseTimeoutMs);
    peer.pongTimer.unref();
  }
  /**
   * The pong timer runs before the event loop reads the socket, so after a sleep a pong the
   * kernel already buffered is not seen yet. A wait that ran more than a full extra response
   * period past its timeout is therefore granted one more period, once. A peer that stays
   * silent through it is still retired on schedule. Date.now is deliberate here: the wall
   * clock keeps running through sleep, which is the signal this check looks for.
   */
  function onPongOverdue(peer: Peer): void {
    if (peer.closed) return;
    const stall = wallClockGap(peer.pingSentAt, Date.now(), limits.heartbeatResponseTimeoutMs);
    if (!peer.pongGraceUsed && stall > limits.heartbeatResponseTimeoutMs) {
      peer.pongGraceUsed = true;
      armPongTimer(peer);
      return;
    }
    // Silence alone is not death while the queue ahead of the ping is still flushing.
    const flushed = flushedBytes(peer);
    if (peer.pongDrainExtensions < HEARTBEAT_DRAIN_EXTENSIONS && flushed > peer.pongFlushedAt) {
      peer.pongDrainExtensions += 1;
      peer.pongFlushedAt = flushed;
      armPongTimer(peer);
      return;
    }
    closePeer(peer, 1001, "Connection heartbeat timed out.");
    peer.socket.terminate();
  }
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
      void waitFor(authorized(peer, "heartbeat"), controller.signal)
        .then((permitted) => {
          if (!permitted) {
            closePeer(peer);
            return;
          }
          ping(peer);
        })
        .catch((error: unknown) => {
          if (
            controller.signal.reason instanceof RequestExpired ||
            (error instanceof HostDispatchError &&
              ["overloaded", "service-unavailable"].includes(error.code))
          ) {
            // A slow or unavailable authorization store is not evidence of
            // revocation; closing here would drop every peer in the same tick.
            // Keep transport liveness checked; work still requires authorization.
            ping(peer);
            return;
          }
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
