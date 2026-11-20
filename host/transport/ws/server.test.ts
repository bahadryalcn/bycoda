import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, type ClientOptions } from "ws";
import { HostBulkTransfers } from "../http/bulk";
import { HostSubscriptionHub } from "./subscriptions";
import { HostDispatchError, createHostDispatcher } from "../dispatch";
import { HostDomainOutcomeError, HostDomainRefusalError } from "../../domains/context";
import {
  HOST_SCHEMA_VERSION,
  RPC_ERROR_CODES,
  RpcResponseSchema,
  WS_LIMITS,
  WS_SUBPROTOCOL,
  WS_WIRE_VERSION,
  type RpcResponse,
} from "../../../src/shared/model/host-contracts";
import {
  attachHostWebSocketTransport,
  HOST_WS_READ_CAPABILITY,
  type HostWebSocketOptions,
  type HostWsPrincipal,
} from "./server";

const TOKEN_A = "A".repeat(43);
const TOKEN_B = "B".repeat(43);
const ENVIRONMENT = "fixture-ws-host";
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class ProbeClient {
  readonly socket: WebSocket;
  readonly received: RpcResponse[] = [];
  readonly opened: Promise<void>;
  readonly closed: Promise<{ code: number; reason: string }>;
  private readonly waiting = new Map<
    string | null,
    {
      resolve: (value: RpcResponse) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(url: string, protocol: string | undefined, options: ClientOptions) {
    this.socket =
      protocol === undefined ? new WebSocket(url, options) : new WebSocket(url, protocol, options);
    this.opened = new Promise((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
      this.socket.once("close", () => reject(new Error("Closed before opening.")));
    });
    // Rejected upgrades can happen before a caller awaits this promise.
    void this.opened.catch(() => {});
    this.closed = new Promise((resolve) => {
      this.socket.once("close", (code, reason) => {
        resolve({ code, reason: reason.toString() });
        for (const pending of this.waiting.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error("Socket closed before its response."));
        }
        this.waiting.clear();
      });
    });
    this.socket.on("message", (data) => {
      const response = RpcResponseSchema.parse(JSON.parse(data.toString()));
      this.received.push(response);
      const pending = this.waiting.get(response.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.waiting.delete(response.id);
        pending.resolve(response);
      }
    });
    this.socket.on("error", () => {});
  }

  send(id: string, method: string, params: unknown = {}) {
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  }

  response(id: string | null): Promise<RpcResponse> {
    const existing = this.received.find((response) => response.id === id);
    if (existing) return Promise.resolve(existing);
    if (this.waiting.has(id)) throw new Error("Duplicate test response waiter.");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`No response for ${id}.`));
      }, 2_000);
      this.waiting.set(id, { resolve, reject, timer });
    });
  }

  request(id: string, method: string, params: unknown = {}) {
    const response = this.response(id);
    this.send(id, method, params);
    return response;
  }

  hello(id = "hello", environmentId = ENVIRONMENT) {
    return this.request(id, "connection.hello", {
      environmentId,
      supportedWireVersions: [WS_WIRE_VERSION],
      supportedSchemaVersions: [HOST_SCHEMA_VERSION],
      clientId: "fixture-client",
      clientKind: "desktop",
    });
  }
}

async function fixture(
  overrides: Partial<
    Pick<
      HostWebSocketOptions,
      | "authenticate"
      | "dispatch"
      | "limits"
      | "allowedHosts"
      | "retryUnknownHost"
      | "methods"
      | "bulk"
      | "subscriptions"
    >
  > = {},
) {
  const server = createServer((_request, response) => {
    response.writeHead(404).end();
  });
  const clients = new Set<ProbeClient>();
  let permitted = true;
  const dispatch = vi.fn<HostWebSocketOptions["dispatch"]>(async (method) =>
    method === "projects.list"
      ? [{ id: "project-a", name: "Fixture", cwd: "C:/Fixture", optional: undefined }]
      : { environmentId: ENVIRONMENT, providers: ["codex"], optional: undefined },
  );
  const authenticate = vi.fn<HostWebSocketOptions["authenticate"]>(
    overrides.authenticate ??
      (async (token) => {
        if (token !== TOKEN_A && token !== TOKEN_B) return null;
        return {
          id: token === TOKEN_A ? "device-a" : "device-b",
          authorized: async () => permitted,
        };
      }),
  );
  const transport = attachHostWebSocketTransport({
    server,
    environmentId: ENVIRONMENT,
    dispatch,
    ...overrides,
    authenticate,
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  cleanups.push(async () => {
    for (const client of clients) client.socket.terminate();
    await transport.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
  const connect = (
    input: {
      token?: string | null;
      protocol?: string | null;
      headers?: Record<string, string>;
      path?: string;
      /** false holds pongs so a test decides when the peer answers (or never does). */
      autoPong?: boolean;
    } = {},
  ) => {
    const token = input.token === undefined ? TOKEN_A : input.token;
    const protocol = input.protocol === undefined ? WS_SUBPROTOCOL : (input.protocol ?? undefined);
    const client = new ProbeClient(`ws://127.0.0.1:${port}${input.path ?? "/ws"}`, protocol, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...input.headers },
      handshakeTimeout: 2_000,
      autoPong: input.autoPong ?? true,
    });
    clients.add(client);
    return client;
  };
  const ready = async (token = TOKEN_A) => {
    const client = connect({ token });
    await client.opened;
    expect(await client.hello()).toMatchObject({
      result: { environmentId: ENVIRONMENT, capabilities: [HOST_WS_READ_CAPABILITY] },
    });
    return client;
  };
  return {
    server,
    port,
    transport,
    dispatch,
    authenticate,
    connect,
    ready,
    revoke: () => {
      permitted = false;
    },
  };
}

describe("native WebSocket upgrade and negotiation", () => {
  it("requires native bearer authentication and leaves an ordinary HTTP listener usable", async () => {
    const host = await fixture();
    const missing = host.connect({ token: null });
    const invalid = host.connect({ token: "invalid" });
    await expect(missing.opened).rejects.toThrow(/401/);
    await expect(invalid.opened).rejects.toThrow(/401/);
    expect(host.authenticate).not.toHaveBeenCalled();
    expect((await fetch(`http://127.0.0.1:${host.port}/health`)).status).toBe(404);
    const client = await host.ready();
    expect(client.socket.protocol).toBe(WS_SUBPROTOCOL);
    expect(host.authenticate).toHaveBeenCalledWith(TOKEN_A, expect.any(AbortSignal));
  });

  it.each([
    { headers: { Origin: "https://untrusted.example" } },
    { headers: { Host: "untrusted.example" } },
    { protocol: "other.rpc.v2" },
    { protocol: null },
    { path: "/ws?token=not-a-credential-route" },
  ])("rejects unsupported Origin, Host, subprotocol or route before auth: %j", async (input) => {
    const host = await fixture();
    const client = host.connect(input);
    await expect(client.opened).rejects.toThrow(/400/);
    expect(host.authenticate).not.toHaveBeenCalled();
  });

  it("answers 503, not 401, when the credential verifier fails internally", async () => {
    const host = await fixture({
      authenticate: async () => {
        throw new Error("store not ready");
      },
    });
    await expect(host.connect().opened).rejects.toThrow(/503/);
  });

  it("answers 503 when grant re-verification throws, and 401 when it reports revoked", async () => {
    const host = await fixture({
      authenticate: async () => ({
        id: "device-a",
        authorized: async () => {
          throw new Error("database busy");
        },
      }),
    });
    await expect(host.connect().opened).rejects.toThrow(/503/);
    const revoked = await fixture({
      authenticate: async () => ({ id: "device-a", authorized: async () => false }),
    });
    await expect(revoked.connect().opened).rejects.toThrow(/401/);
  });

  it("keeps invalid-params for a non-conflict dispatch refusal", async () => {
    const dispatcher = createHostDispatcher({
      environmentId: ENVIRONMENT,
      environment: { describe: async () => ({}) },
      projects: { list: async () => [] },
      operations: {
        "notes.delete": async () => {
          throw new HostDomainRefusalError(
            "COMMAND_INVALID",
            "validation",
            false,
            "Invalid queued command",
          );
        },
      },
    });
    const host = await fixture({ methods: ["notes.delete"], dispatch: dispatcher.dispatch });
    const client = await host.ready();
    expect(
      await client.request("invalid", "notes.delete", { id: "note", expectedUpdatedAt: 1 }),
    ).toMatchObject({
      error: {
        code: RPC_ERROR_CODES.invalidParams,
        data: { category: "validation", delivery: "not-sent", code: "COMMAND_INVALID" },
      },
    });
  });

  it("rejects a revoked grant at upgrade", async () => {
    const host = await fixture();
    host.revoke();
    await expect(host.connect().opened).rejects.toThrow(/401/);
  });

  it("allows literal loopback Host headers with an SSH-mapped local port", async () => {
    const host = await fixture();
    const client = host.connect({ headers: { Host: "127.0.0.1:54321" } });
    await client.opened;
    expect(await client.hello()).toMatchObject({ result: { environmentId: ENVIRONMENT } });
  });

  it("asks an unknown Serve host to retry during discovery without authenticating it (#822)", async () => {
    const name = "fixture.tailnet.ts.net";
    let pending = true;
    const host = await fixture({
      allowedHosts: () => (pending ? [] : [name]),
      retryUnknownHost: (candidate: string) => pending && candidate === name,
    });
    const connect = (Host: string) => host.connect({ headers: { Host } }).opened;
    await expect(connect(name)).rejects.toThrow(/503/);
    await expect(connect("other.example")).rejects.toThrow(/400/);
    expect(host.authenticate).not.toHaveBeenCalled();
    pending = false;
    await expect(connect(name)).resolves.toBeUndefined();
  });

  it("requires hello before data and advertises only the routed read pilot", async () => {
    const host = await fixture();
    const client = host.connect();
    await client.opened;
    expect(await client.request("early", "projects.list")).toMatchObject({
      error: { code: RPC_ERROR_CODES.notReady },
    });
    expect(host.dispatch).not.toHaveBeenCalled();
    expect(await client.hello()).toMatchObject({
      result: {
        methods: ["connection.probe", "requests.cancel", "environment.describe", "projects.list"],
      },
    });
  });

  it("rejects a replaced environment and closes instead of silently rebinding", async () => {
    const host = await fixture();
    const client = host.connect();
    await client.opened;
    expect(await client.hello("wrong-env", "replacement-host")).toMatchObject({
      error: { code: RPC_ERROR_CODES.wrongEnvironment },
    });
    expect((await client.closed).code).toBe(1008);
    expect(host.dispatch).not.toHaveBeenCalled();
  });

  it("expires an upgraded connection that never negotiates", async () => {
    const host = await fixture({ limits: { handshakeTimeoutMs: 40 } });
    const client = host.connect();
    await client.opened;
    expect((await client.closed).code).toBe(1008);
    expect(host.dispatch).not.toHaveBeenCalled();
  });
});

describe("WebSocket read admission and safe disclosure", () => {
  it("routes env/projects with opaque principal/signal and normalizes legacy undefined values", async () => {
    const host = await fixture();
    const client = await host.ready();
    expect(
      await client.request("env", "environment.describe", { supportedProviders: ["codex"] }),
    ).toMatchObject({ result: { environmentId: ENVIRONMENT, providers: ["codex"] } });
    expect(await client.request("projects", "projects.list")).toMatchObject({
      result: [{ id: "project-a", name: "Fixture", cwd: "C:/Fixture" }],
    });
    const [, , context] = host.dispatch.mock.calls[0];
    expect(context.environmentId).toBe(ENVIRONMENT);
    expect(context.principal).toEqual({ kind: "device", id: "device-a" });
    expect(context.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(client.received)).not.toContain(TOKEN_A);
  });

  it.each([false, true])(
    "preserves normalized generic result bytes with bulk=%s",
    async (withBulk) => {
      const toJSON = vi.fn((key: string) => ({
        key,
        missing: undefined,
        list: [undefined, NaN, Infinity, -0],
        text: '"\\\n\u96ea',
      }));
      const host = await fixture({
        ...(withBulk ? { bulk: new HostBulkTransfers({ environmentId: ENVIRONMENT }) } : {}),
        dispatch: async () => ({ toJSON }),
      });
      const client = await host.ready();
      const id = "normalized-response";
      const received = await client.request(id, "environment.describe");
      expect(received).toEqual({
        jsonrpc: "2.0",
        id,
        result: { key: "", list: [null, null, null, 0], text: '"\\\n\u96ea' },
      });
      expect(toJSON).toHaveBeenCalledExactlyOnceWith("");
    },
  );

  it.each(["cycle", "bigint", "undefined"])(
    "rejects unrepresentable generic %s results",
    async (kind) => {
      const cycle: Record<string, unknown> = {};
      cycle.self = cycle;
      const host = await fixture({
        dispatch: async () => (kind === "cycle" ? cycle : kind === "bigint" ? 1n : undefined),
      });
      const client = await host.ready();
      expect(await client.request("invalid-result", "environment.describe")).toMatchObject({
        error: { code: RPC_ERROR_CODES.internalError },
      });
      expect(client.socket.readyState).toBe(WebSocket.OPEN);
    },
  );

  it("logs a client close with its code and the request it abandoned", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let started!: () => void;
    const dispatched = new Promise<void>((resolve) => (started = resolve));
    const host = await fixture({
      dispatch: () => {
        started();
        return new Promise(() => {});
      },
    });
    const client = await host.ready();
    void client.request("held", "projects.list").catch(() => {});
    await dispatched;
    client.socket.close(4000, "test closed");
    await vi.waitFor(() =>
      expect(stderr.mock.calls.map(([line]) => String(line)).join("")).toMatch(
        /\[host\.ws\] connection closed .*code=4000 reason="?peer closed: test closed.*pending=1 methods="?projects\.list@\d+ms/,
      ),
    );
    stderr.mockRestore();
  });

  it("keeps typed method result validation before delivery", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const host = await fixture({
      dispatch: async () => [{ id: "project", name: "secret-name", cwd: 42 }],
    });
    const client = await host.ready();
    expect(await client.request("invalid-project", "projects.list")).toMatchObject({
      error: { code: RPC_ERROR_CODES.internalError },
    });
    // The rejection is logged by field path so contract drift is findable, never by value.
    const log = stderr.mock.calls.map(([line]) => String(line)).join("");
    stderr.mockRestore();
    expect(log).toMatch(/\[host\.ws\] result rejected by contract method=projects\.list .*0\.cwd/);
    expect(log).not.toContain("secret-name");
  });

  it("sends the bulk descriptor rather than reusing offloaded result bytes", async () => {
    const host = await fixture({
      bulk: new HostBulkTransfers({ environmentId: ENVIRONMENT }),
      dispatch: async () => "x".repeat(WS_LIMITS.maxMessageBytes),
    });
    const client = await host.ready();
    expect(await client.request("bulk-result", "environment.describe")).toMatchObject({
      result: { $bulk: { totalBytes: WS_LIMITS.maxMessageBytes + 2 } },
    });
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("answers an oversized result with a typed error and keeps the socket open", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let oversized = true;
    const host = await fixture({
      dispatch: async () => (oversized ? "x".repeat(WS_LIMITS.maxMessageBytes) : "ok"),
    });
    const client = await host.ready();
    const failed = await client.request("large-result", "environment.describe");
    expect(failed).toMatchObject({
      id: "large-result",
      error: {
        code: RPC_ERROR_CODES.internalError,
        message: expect.stringContaining("too large"),
        data: { category: "unavailable", retryable: false },
      },
    });
    expect(Buffer.byteLength(JSON.stringify(failed))).toBeLessThan(1024);
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    // The same connection keeps serving other requests.
    oversized = false;
    expect(await client.request("small-result", "environment.describe")).toMatchObject({
      result: "ok",
    });
    stderr.mockRestore();
  });

  it.each(["commands.dispatch", "sessions.page", "subscriptions.open", "constructor"])(
    "does not enable unimplemented or mutating method %s",
    async (method) => {
      const host = await fixture();
      const client = await host.ready();
      const params =
        method === "subscriptions.open"
          ? { subscriptionId: "subscription-a", target: { kind: "environment" } }
          : method === "sessions.page"
            ? { sessionId: "session-a" }
            : {};
      expect(await client.request("denied", method, params)).toMatchObject({
        error: { code: RPC_ERROR_CODES.methodNotFound },
      });
      expect(host.dispatch).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed JSON and strict params without tearing down a healthy socket", async () => {
    const host = await fixture();
    const client = await host.ready();
    client.socket.send("{");
    expect(await client.response(null)).toMatchObject({
      error: { code: RPC_ERROR_CODES.parseError },
    });
    // The refusal names the method and field so contract drift is diagnosable,
    // and never echoes the submitted value.
    expect(
      await client.request("invalid", "projects.list", { unexpected: "secret-value" }),
    ).toMatchObject({
      error: {
        code: RPC_ERROR_CODES.invalidParams,
        message: "Invalid Host RPC request: projects.list (params: unrecognized unexpected)",
      },
    });
    expect(await client.request("probe", "connection.probe")).toMatchObject({
      result: { environmentId: ENVIRONMENT },
    });
    expect(host.dispatch).not.toHaveBeenCalled();
  });

  it.each([
    new Error("private database diagnostic"),
    new HostDispatchError("service-unavailable", "Host read could not be completed.", {
      cause: new Error("private database diagnostic"),
    }),
  ])(
    "reports backend failures without blaming request params or exposing diagnostics: %s",
    async (error) => {
      const host = await fixture({
        dispatch: async () => {
          throw error;
        },
      });
      const client = await host.ready();
      const response = await client.request("failed", "projects.list");
      expect(response).toMatchObject({ error: { code: RPC_ERROR_CODES.internalError } });
      expect(JSON.stringify(response)).not.toContain("private database diagnostic");
      expect(await client.request("probe-after-failure", "connection.probe")).toHaveProperty(
        "result",
      );
    },
  );

  it("does not leak data read after its device grant was revoked", async () => {
    const started = deferred<void>();
    const finish = deferred<unknown>();
    const host = await fixture({
      dispatch: async () => {
        started.resolve();
        return finish.promise;
      },
    });
    const client = await host.ready();
    const result = client.request("protected", "projects.list");
    await started.promise;
    host.revoke();
    finish.resolve([{ id: "private-after-revocation", cwd: "/private", name: "Private" }]);
    expect(await result).toMatchObject({ error: { code: RPC_ERROR_CODES.unauthorized } });
    await client.closed;
    expect(JSON.stringify(client.received)).not.toContain("private-after-revocation");
  });

  it("limits sockets by authenticated device identity while allowing another device", async () => {
    const host = await fixture({ limits: { maxSocketsPerDevice: 1 } });
    await host.ready(TOKEN_A);
    await expect(host.connect().opened).rejects.toThrow(/429/);
    await host.ready(TOKEN_B);
  });

  it("replaces a silent same-device socket before its first pending ping (#827)", async () => {
    const host = await fixture({
      limits: {
        maxSocketsPerDevice: 1,
        heartbeatIntervalMs: 60_000,
        heartbeatResponseTimeoutMs: 5_000,
      },
    });
    const silent = await host.ready(TOKEN_A);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 65_000);
    onTestFinished(() => clock.mockRestore());
    const otherDevice = await host.ready(TOKEN_B);

    await host.ready(TOKEN_A);

    expect(await silent.closed).toEqual({ code: 1001, reason: "Replaced by a newer connection." });
    expect(otherDevice.socket.readyState).toBe(WebSocket.OPEN);
    await expect(host.connect().opened).rejects.toThrow(/429/);
  });

  it("bounds unauthenticated upgrade work before awaiting authentication", async () => {
    const started = deferred<void>();
    const release = deferred<HostWsPrincipal>();
    const authenticate = vi.fn(async () => {
      started.resolve();
      return release.promise;
    });
    const host = await fixture({ authenticate, limits: { maxUnauthenticatedSockets: 1 } });
    const first = host.connect();
    await started.promise;
    try {
      await expect(host.connect({ token: TOKEN_B }).opened).rejects.toThrow(/429/);
      expect(authenticate).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve({ id: "device-a", authorized: async () => true });
    }
    await first.opened;
  });

  it("counts verified devices against their own admission bucket and keeps unknown tokens shared", async () => {
    const gate = deferred<void>();
    const TOKEN_C = "C".repeat(43);
    const TOKEN_D = "D".repeat(43);
    let hold = false;
    const host = await fixture({
      limits: { maxUnauthenticatedSocketsPerSource: 1, maxAuthenticationJobsPerSource: 1 },
      authenticate: async (token) => {
        if (hold) await gate.promise;
        if (token === TOKEN_A) return { id: "device-a", authorized: async () => true };
        if (token === TOKEN_B) return { id: "device-b", authorized: async () => true };
        return null;
      },
    });
    // Every client here shares one loopback address; each device is verified once first.
    await host.ready(TOKEN_A);
    await host.ready(TOKEN_B);
    hold = true;
    const settled = [
      host.connect({ token: TOKEN_A }),
      host.connect({ token: TOKEN_B }),
      host.connect({ token: TOKEN_C }),
    ];
    await vi.waitFor(() => expect(host.authenticate).toHaveBeenCalledTimes(5));
    // A second concurrent handshake of the same device, or of another unknown token, is still refused.
    await expect(host.connect({ token: TOKEN_A }).opened).rejects.toThrow(/429/);
    await expect(host.connect({ token: TOKEN_D }).opened).rejects.toThrow(/429/);
    expect(host.authenticate).toHaveBeenCalledTimes(5);
    gate.resolve();
    await settled[0]!.opened;
    await settled[1]!.opened;
    await expect(settled[2]!.opened).rejects.toThrow(/401/);
  });

  it("releases timed-out upgrade admission even when its auth backend remains pending", async () => {
    const started = deferred<void>();
    const release = deferred<HostWsPrincipal>();
    const host = await fixture({
      authenticate: async (token) => {
        if (token === TOKEN_A) {
          started.resolve();
          return release.promise;
        }
        return { id: "device-b", authorized: async () => true };
      },
      limits: { maxUnauthenticatedSockets: 1, handshakeTimeoutMs: 40 },
    });
    const stalled = host.connect();
    await started.promise;
    await expect(stalled.opened).rejects.toBeDefined();
    try {
      const next = host.connect({ token: TOKEN_B });
      await next.opened;
      expect(await next.hello()).toMatchObject({ result: { environmentId: ENVIRONMENT } });
    } finally {
      release.resolve({ id: "device-a", authorized: async () => true });
    }
  });

  it("retains a separate bounded auth-job budget after socket admission times out", async () => {
    const started = deferred<void>();
    const release = deferred<HostWsPrincipal>();
    const settled = deferred<void>();
    let authenticationSignal: AbortSignal | undefined;
    const authenticate = vi.fn<HostWebSocketOptions["authenticate"]>(async (token, signal) => {
      if (token === TOKEN_A) {
        authenticationSignal = signal;
        started.resolve();
        // Deliberately ignore cancellation to exercise detached-work accounting.
        try {
          return await release.promise;
        } finally {
          settled.resolve();
        }
      }
      return { id: "device-b", authorized: async () => true };
    });
    const host = await fixture({
      authenticate,
      limits: {
        maxUnauthenticatedSockets: 1,
        maxAuthenticationJobs: 1,
        handshakeTimeoutMs: 40,
      },
    });
    const stalled = host.connect();
    await started.promise;
    await expect(stalled.opened).rejects.toBeDefined();
    expect(authenticationSignal?.aborted).toBe(true);
    try {
      await expect(host.connect({ token: TOKEN_B }).opened).rejects.toThrow(/429/);
      expect(authenticate).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve({ id: "device-a", authorized: async () => true });
    }
    await settled.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    await host.ready(TOKEN_B);
    expect(authenticate).toHaveBeenCalledTimes(2);
  });

  it("enforces the global authenticated limit across different device grants", async () => {
    const host = await fixture({ limits: { maxAuthenticatedSockets: 1 } });
    const first = await host.ready(TOKEN_A);
    await expect(host.connect({ token: TOKEN_B }).opened).rejects.toThrow(/429/);
    first.socket.close();
    await first.closed;
    await host.ready(TOKEN_B);
  });

  it("reserves pending capacity but keeps control responsive during an awaited query", async () => {
    const started = deferred<void>();
    const finish = deferred<unknown>();
    const host = await fixture({
      dispatch: async () => {
        started.resolve();
        return finish.promise;
      },
      limits: { maxPendingRpc: 1 },
    });
    const client = await host.ready();
    const held = client.request("held", "projects.list");
    await started.promise;
    expect(await client.request("excess", "projects.list")).toMatchObject({
      error: { code: RPC_ERROR_CODES.overloaded },
    });
    expect(await client.request("probe", "connection.probe")).toMatchObject({
      result: { environmentId: ENVIRONMENT },
    });
    finish.resolve([]);
    expect(await held).toMatchObject({ result: [] });
  });

  it("counts authorization waits against pending query admission", async () => {
    let holdAuthorization = false;
    const started = deferred<void>();
    const release = deferred<boolean>();
    const host = await fixture({
      authenticate: async () => ({
        id: "device-a",
        authorized: async () => {
          if (!holdAuthorization) return true;
          started.resolve();
          return release.promise;
        },
      }),
      limits: { maxPendingRpc: 1, defaultResponseTimeoutMs: 1_000 },
    });
    const client = await host.ready();
    holdAuthorization = true;
    const first = client.request("auth-wait", "projects.list");
    await started.promise;
    try {
      expect(await client.request("over-capacity", "projects.list")).toMatchObject({
        error: { code: RPC_ERROR_CODES.overloaded },
      });
    } finally {
      holdAuthorization = false;
      release.resolve(true);
    }
    expect(await first).toMatchObject({ result: expect.any(Array) });
  });

  it("expires a stuck query, aborts its work and releases a slot on a healthy socket", async () => {
    const abandoned = deferred<unknown>();
    let signal: AbortSignal | undefined;
    const dispatch = vi.fn<HostWebSocketOptions["dispatch"]>(async (_method, _params, context) => {
      signal = context.signal;
      return dispatch.mock.calls.length === 1 ? abandoned.promise : [];
    });
    const host = await fixture({
      dispatch,
      limits: { defaultResponseTimeoutMs: 40, maxPendingRpc: 1 },
    });
    const client = await host.ready();
    expect(await client.request("expired", "projects.list")).toMatchObject({
      error: { code: RPC_ERROR_CODES.deadlineExceeded },
    });
    expect(signal?.aborted).toBe(true);
    expect(await client.request("after-expiry", "projects.list")).toMatchObject({ result: [] });
    abandoned.resolve([{ id: "late-must-not-appear" }]);
    expect(JSON.stringify(client.received)).not.toContain("late-must-not-appear");
  });

  it("cancels a query through a reserved control request without stopping the connection", async () => {
    const started = deferred<void>();
    const finish = deferred<unknown>();
    let signal: AbortSignal | undefined;
    const host = await fixture({
      dispatch: async (_method, _params, context) => {
        signal = context.signal;
        started.resolve();
        return finish.promise;
      },
      limits: { maxPendingRpc: 1 },
    });
    const client = await host.ready();
    const query = client.request("cancel-target", "projects.list");
    await started.promise;
    expect(
      await client.request("cancel", "requests.cancel", { requestId: "cancel-target" }),
    ).toMatchObject({ result: { accepted: true } });
    expect(await query).toMatchObject({ error: { code: RPC_ERROR_CODES.cancelled } });
    expect(signal?.aborted).toBe(true);
    finish.resolve([]);
    expect(await client.request("probe", "connection.probe")).toMatchObject({
      result: { environmentId: ENVIRONMENT },
    });
  });

  it.each(["deadline", "cancel"] as const)(
    "keeps an accepted command running after its %s and reconciles the original ID once",
    async (reason) => {
      const started = deferred<void>();
      const finish = deferred<unknown>();
      const receipt = { commandId: "command-a", sessionId: "session-a", revision: 1 };
      let committed = false;
      let executionSignal: AbortSignal | undefined;
      const dispatch = vi.fn<HostWebSocketOptions["dispatch"]>(async (method, _params, context) => {
        if (method === "commands.status") return committed ? receipt : null;
        executionSignal = context.signal;
        started.resolve();
        await finish.promise;
        committed = true;
        return receipt;
      });
      const host = await fixture({
        dispatch,
        methods: ["commands.dispatch", "commands.status"],
        limits: { maxPendingRpc: 1, defaultResponseTimeoutMs: reason === "deadline" ? 40 : 1_000 },
      });
      const client = await host.ready();
      const response = client.request("command-wait", "commands.dispatch", {
        ...receipt,
        revision: undefined,
        type: "draft",
        text: "keep this effect",
      });
      await started.promise;
      if (reason === "cancel")
        expect(
          await client.request("cancel-wait", "requests.cancel", { requestId: "command-wait" }),
        ).toMatchObject({ result: { accepted: true } });
      expect(await response).toMatchObject({
        error: {
          code:
            reason === "deadline" ? RPC_ERROR_CODES.deadlineExceeded : RPC_ERROR_CODES.cancelled,
          data: { retryable: false, commandId: "command-a", delivery: "unknown" },
        },
      });
      expect(executionSignal).toBeUndefined();
      expect(
        await client.request("pending-status", "commands.status", { commandId: "command-a" }),
      ).toMatchObject({ result: null });
      finish.resolve(undefined);
      await vi.waitFor(() => expect(committed).toBe(true));
      expect(
        await client.request("committed-status", "commands.status", { commandId: "command-a" }),
      ).toMatchObject({ result: receipt });
      expect(dispatch.mock.calls.filter(([method]) => method === "commands.dispatch")).toHaveLength(
        1,
      );
      expect(client.received.filter((reply) => reply.id === "command-wait")).toHaveLength(1);
    },
  );

  it("closes duplicate in-flight request IDs rather than routing a second action", async () => {
    const started = deferred<void>();
    const finish = deferred<unknown>();
    const dispatch = vi.fn(async () => {
      started.resolve();
      return finish.promise;
    });
    const host = await fixture({ dispatch });
    const client = await host.ready();
    client.send("duplicate", "projects.list");
    await started.promise;
    client.send("duplicate", "projects.list");
    expect((await client.closed).code).toBe(1008);
    expect(dispatch).toHaveBeenCalledTimes(1);
    finish.resolve([]);
  });
});

describe("WS framing and orderly disposal", () => {
  it("rejects binary data rather than interpreting it as JSON", async () => {
    const host = await fixture();
    const client = await host.ready();
    client.socket.send(Buffer.from("{}"));
    expect((await client.closed).code).toBe(1003);
    expect(host.dispatch).not.toHaveBeenCalled();
  });

  it("rejects oversized application messages before dispatch", async () => {
    const host = await fixture();
    const client = await host.ready();
    client.socket.send("x".repeat(WS_LIMITS.maxMessageBytes + 1));
    expect((await client.closed).code).toBe(1009);
    expect(host.dispatch).not.toHaveBeenCalled();
  });

  it("retains detached read admission across cancellation and reconnect", async () => {
    const finish = deferred<unknown>();
    const dispatch = vi.fn<HostWebSocketOptions["dispatch"]>(async () => finish.promise);
    const host = await fixture({
      limits: { maxReadJobsPerDevice: 1, defaultResponseTimeoutMs: 40 },
      dispatch,
    });
    const first = await host.ready();
    expect(await first.request("slow", "projects.list")).toMatchObject({
      error: { code: RPC_ERROR_CODES.deadlineExceeded },
    });
    first.socket.close();
    await first.closed;
    const second = await host.ready();
    expect(await second.request("held", "projects.list")).toMatchObject({
      error: { code: RPC_ERROR_CODES.overloaded },
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(await second.request("probe", "connection.probe")).toMatchObject({
      result: { environmentId: ENVIRONMENT },
    });
    finish.resolve([]);
    await vi.waitFor(async () => {
      expect(await second.request(`released-${Date.now()}`, "projects.list")).toMatchObject({
        result: [],
      });
    });
  });

  it("keeps every peer on a transport ping when heartbeat authorization stalls", async () => {
    const finish = deferred<boolean>();
    let block = false;
    let checks = 0;
    const host = await fixture({
      authenticate: async () => ({
        id: "device-a",
        authorized: async () => {
          if (!block) return true;
          checks++;
          return finish.promise;
        },
      }),
      limits: { maxSocketsPerDevice: 2, heartbeatIntervalMs: 5, heartbeatResponseTimeoutMs: 40 },
    });
    const first = await host.ready();
    const second = await host.ready();
    let closed = false;
    for (const client of [first, second]) void client.closed.then(() => (closed = true));
    block = true;
    await vi.waitFor(() => expect(checks).toBe(2));
    // Past the 40 ms authorization deadline the store stall must not close anyone.
    await new Promise((resolve) => setTimeout(resolve, 150));
    await Promise.all(
      [first, second].map(
        (client) => new Promise<void>((resolve) => client.socket.once("ping", () => resolve())),
      ),
    );
    expect(closed).toBe(false);
    expect(checks).toBe(2); // Detached checks hold their budget slot until they settle.
    finish.resolve(true);
  });

  it("drains peer sockets, aborts active work and removes its upgrade handler", async () => {
    const started = deferred<void>();
    const finish = deferred<unknown>();
    let signal: AbortSignal | undefined;
    const host = await fixture({
      dispatch: async (_method, _params, context) => {
        signal = context.signal;
        started.resolve();
        return finish.promise;
      },
    });
    const first = await host.ready();
    const second = await host.ready(TOKEN_B);
    first.send("in-flight", "projects.list");
    await started.promise;
    const close = host.transport.close();
    expect(host.transport.close()).toBe(close);
    await close;
    await Promise.all([first.closed, second.closed]);
    expect(signal?.aborted).toBe(true);
    expect(host.server.listenerCount("upgrade")).toBe(0);
    finish.resolve([]);
  });
  it("keeps multiple sockets healthy while eight control jobs occupy backend capacity", async () => {
    const release = deferred<unknown>();
    const allStarted = deferred<void>();
    let started = 0;
    const host = await fixture({
      methods: ["environment.persistence.status"],
      limits: { heartbeatIntervalMs: 15, heartbeatResponseTimeoutMs: 500 },
      dispatch: async () => {
        if (++started === 8) allStarted.resolve();
        return release.promise;
      },
    });
    const first = await host.ready();
    const second = await host.ready();
    const third = await host.ready();
    const pings = Promise.all(
      [first, second, third].map(
        (client) => new Promise<void>((resolve) => client.socket.once("ping", () => resolve())),
      ),
    );
    const jobs = Array.from({ length: 8 }, (_, i) =>
      (i < 4 ? first : second).request(`held-${i}`, "environment.persistence.status"),
    );
    await allStarted.promise;
    try {
      expect(await third.request("excess-control", "environment.persistence.status")).toMatchObject(
        {
          error: {
            code: RPC_ERROR_CODES.overloaded,
            data: { category: "overload", retryable: true, delivery: "not-sent" },
          },
        },
      );
      expect(await third.request("health-probe", "connection.probe")).toMatchObject({
        result: { environmentId: ENVIRONMENT },
      });
      await pings;
      expect(
        [first, second, third].every((client) => client.socket.readyState === WebSocket.OPEN),
      ).toBe(true);
    } finally {
      release.resolve({ state: "ready" });
    }
    expect(await Promise.all(jobs)).toHaveLength(8);
  });

  it("reports temporary authorization failure without falsely revoking the socket", async () => {
    let mode: "ok" | "unavailable" | "revoked" = "ok";
    const host = await fixture({
      authenticate: async () => ({
        id: "device-a",
        authorized: async () => {
          if (mode === "unavailable") throw new Error("backend unavailable");
          return mode === "ok";
        },
      }),
    });
    const client = await host.ready();
    mode = "unavailable";
    expect(await client.request("auth-unavailable", "projects.list")).toMatchObject({
      error: { data: { category: "unavailable", retryable: true, delivery: "not-sent" } },
    });
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    mode = "ok";
    expect(await client.request("after-auth-recovery", "connection.probe")).toHaveProperty(
      "result",
    );
    mode = "revoked";
    expect(await client.request("revoked", "projects.list")).toMatchObject({
      error: { code: RPC_ERROR_CODES.unauthorized },
    });
    await client.closed;
  });

  it("does not claim an overloaded mutation was unsent after dispatch began", async () => {
    const dispatch = vi.fn<HostWebSocketOptions["dispatch"]>(async () => {
      throw new HostDispatchError("overloaded", "busy", undefined, {
        category: "overload",
        retryable: true,
        delivery: "not-sent",
      });
    });
    const host = await fixture({ methods: ["commands.dispatch"], dispatch });
    const client = await host.ready();
    const response = await client.request("command", "commands.dispatch", {
      commandId: "command-a",
      sessionId: "session-a",
      type: "draft",
      text: "keep",
    });
    expect(response).toMatchObject({
      error: {
        code: RPC_ERROR_CODES.overloaded,
        data: {
          category: "overload",
          retryable: false,
          delivery: "unknown",
          commandId: "command-a",
        },
      },
    });
    expect(dispatch).toHaveBeenCalledOnce();
  });
  it("keeps detached heartbeat work bounded and still closes after a later revocation", async () => {
    const finish = deferred<boolean>();
    const started = deferred<void>();
    let block = false;
    let revoked = false;
    let blockedChecks = 0;
    const host = await fixture({
      authenticate: async () => ({
        id: "device-a",
        authorized: async () => {
          if (block) {
            blockedChecks++;
            started.resolve();
            return finish.promise;
          }
          return !revoked;
        },
      }),
      limits: { maxSocketsPerDevice: 1, heartbeatIntervalMs: 5, heartbeatResponseTimeoutMs: 40 },
    });
    const first = await host.ready();
    block = true;
    await started.promise;
    block = false;
    // The timed-out check stays detached; later ticks fall back to a transport ping.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await new Promise<void>((resolve) => first.socket.once("ping", () => resolve()));
    expect(blockedChecks).toBe(1);
    expect(await first.request("still-authorized", "connection.probe")).toHaveProperty("result");
    revoked = true;
    finish.resolve(true);
    await first.closed;
  });

  it("does not close a peer whose pong was buffered across host sleep", async () => {
    const host = await fixture({
      limits: { heartbeatIntervalMs: 5, heartbeatResponseTimeoutMs: 300 },
    });
    const client = host.connect({ autoPong: false });
    await client.opened;
    expect(await client.hello("hello-sleep")).toHaveProperty("result");
    const ping = await new Promise<Buffer>((resolve) => client.socket.once("ping", resolve));
    // Sleep: the wall clock jumps while the pong is outstanding, so the timer fires first.
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60 * 60_000);
    onTestFinished(() => clock.mockRestore());
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    client.socket.pong(ping);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await client.request("after-sleep", "connection.probe")).toHaveProperty("result");
  });

  it("retires a silent peer after the sleep grace period", async () => {
    const host = await fixture({
      limits: { heartbeatIntervalMs: 5, heartbeatResponseTimeoutMs: 40 },
    });
    const client = host.connect({ autoPong: false });
    await client.opened;
    expect(await client.hello("hello-silent-sleep")).toHaveProperty("result");
    await new Promise((resolve) => client.socket.once("ping", resolve));
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60 * 60_000);
    onTestFinished(() => clock.mockRestore());
    expect(await client.closed).toMatchObject({
      code: 1001,
      reason: "Connection heartbeat timed out.",
    });
  });

  it("retires a silent peer on the first timeout when the process did not sleep", async () => {
    const host = await fixture({
      limits: { heartbeatIntervalMs: 5, heartbeatResponseTimeoutMs: 40 },
    });
    const client = host.connect({ autoPong: false });
    await client.opened;
    expect(await client.hello("hello-silent")).toHaveProperty("result");
    expect(await client.closed).toMatchObject({
      code: 1001,
      reason: "Connection heartbeat timed out.",
    });
  });

  describe("heartbeat behind buffered frames", () => {
    /**
     * Stands in for a link that flushes `rate` bytes/ms from a queue under the socket cap
     * (0 = stalled). Install it before connecting so the first ping sees the same queue.
     */
    function mockQueue(rate: number) {
      const startedAt = performance.now();
      const queued = 6_000_000;
      const spy = vi
        .spyOn(WebSocket.prototype, "bufferedAmount", "get")
        .mockImplementation(() => queued - (performance.now() - startedAt) * rate);
      onTestFinished(() => spy.mockRestore());
    }

    it("keeps a peer whose queue is still draining until its pong arrives", async () => {
      const host = await fixture({
        limits: { heartbeatIntervalMs: 5, heartbeatResponseTimeoutMs: 40 },
      });
      mockQueue(1_000);
      const client = host.connect({ autoPong: false });
      await client.opened;
      expect(await client.hello("hello-draining")).toHaveProperty("result");
      const ping = await new Promise<Buffer>((resolve) => client.socket.once("ping", resolve));
      // Three full response windows with no pong: the old deadline would have closed this socket.
      await new Promise((resolve) => setTimeout(resolve, 130));
      expect(client.socket.readyState).toBe(WebSocket.OPEN);
      client.socket.pong(ping);
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(await client.request("after-drain", "connection.probe")).toHaveProperty("result");
    });

    it("still retires a dead peer whose queue never moves", async () => {
      const host = await fixture({
        limits: { heartbeatIntervalMs: 5, heartbeatResponseTimeoutMs: 40 },
      });
      mockQueue(0);
      const client = host.connect({ autoPong: false });
      await client.opened;
      expect(await client.hello("hello-stalled")).toHaveProperty("result");
      expect(await client.closed).toMatchObject({
        code: 1001,
        reason: "Connection heartbeat timed out.",
      });
    });

    it("bounds the extra time a draining link can hold the deadline", async () => {
      const host = await fixture({
        limits: { heartbeatIntervalMs: 5, heartbeatResponseTimeoutMs: 40 },
      });
      mockQueue(1_000);
      const client = host.connect({ autoPong: false });
      await client.opened;
      expect(await client.hello("hello-bounded")).toHaveProperty("result");
      const startedAt = performance.now();
      expect(await client.closed).toMatchObject({
        code: 1001,
        reason: "Connection heartbeat timed out.",
      });
      // One response window plus the five extensions, never an open-ended wait.
      expect(performance.now() - startedAt).toBeLessThan(40 * 6 + 400);
    });

    it("treats any inbound frame, not only a pong, as liveness", async () => {
      const host = await fixture({
        limits: { heartbeatIntervalMs: 5, heartbeatResponseTimeoutMs: 40 },
      });
      const client = host.connect({ autoPong: false });
      const ping = new Promise((resolve) => client.socket.once("ping", resolve));
      await client.opened;
      expect(await client.hello("hello-acks")).toHaveProperty("result");
      await ping;
      for (let index = 0; index < 8; index += 1) {
        expect(await client.request(`ack-${index}`, "connection.probe")).toHaveProperty("result");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(client.socket.readyState).toBe(WebSocket.OPEN);
    });
  });

  it("returns transient hello overload and allows retry after detached auth settles", async () => {
    const finish = deferred<boolean>();
    const started = deferred<void>();
    let block = false;
    const host = await fixture({
      authenticate: async () => ({
        id: "device-a",
        authorized: async () => {
          if (block) {
            started.resolve();
            return finish.promise;
          }
          return true;
        },
      }),
      limits: { maxControlJobsPerDevice: 1, defaultResponseTimeoutMs: 40 },
    });
    const first = await host.ready();
    block = true;
    const pending = first.request("auth-stalled", "projects.list");
    await started.promise;
    expect(await pending).toMatchObject({ error: { code: RPC_ERROR_CODES.deadlineExceeded } });
    block = false;
    // Only a fresh in-flight check is shared; this stalled one is too old to answer for new work.
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 2_000);
    onTestFinished(() => clock.mockRestore());
    const second = host.connect();
    await second.opened;
    expect(await second.hello("hello-overload")).toMatchObject({
      error: {
        code: RPC_ERROR_CODES.overloaded,
        data: { category: "overload", retryable: true, delivery: "not-sent" },
      },
    });
    finish.resolve(true);
    await finish.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(await second.hello("hello-retry")).toHaveProperty("result");
  });
  it("classifies per-socket control saturation without dispatching a ninth job", async () => {
    const release = deferred<unknown>();
    const started = deferred<void>();
    let count = 0;
    const dispatch = vi.fn<HostWebSocketOptions["dispatch"]>(async () => {
      if (++count === 8) started.resolve();
      return release.promise;
    });
    const host = await fixture({ methods: ["environment.persistence.status"], dispatch });
    const client = await host.ready();
    const jobs = Array.from({ length: 8 }, (_, i) =>
      client.request(`socket-${i}`, "environment.persistence.status"),
    );
    await started.promise;
    try {
      expect(
        await client.request("socket-overload", "environment.persistence.status"),
      ).toMatchObject({
        error: {
          code: RPC_ERROR_CODES.overloaded,
          data: { category: "overload", retryable: true, delivery: "not-sent" },
        },
      });
      expect(dispatch).toHaveBeenCalledTimes(8);
    } finally {
      release.resolve({ state: "ready" });
    }
    await Promise.all(jobs);
  });

  it("marks a command authorization deadline as not sent", async () => {
    const finish = deferred<boolean>();
    const started = deferred<void>();
    let block = false;
    const dispatch = vi.fn<HostWebSocketOptions["dispatch"]>(async () => {
      throw new Error("must not dispatch");
    });
    const host = await fixture({
      methods: ["commands.dispatch"],
      dispatch,
      limits: { defaultResponseTimeoutMs: 40 },
      authenticate: async () => ({
        id: "device-a",
        authorized: async () => {
          if (block) {
            started.resolve();
            return finish.promise;
          }
          return true;
        },
      }),
    });
    const client = await host.ready();
    block = true;
    const pending = client.request("pre-dispatch", "commands.dispatch", {
      commandId: "command-a",
      sessionId: "session-a",
      type: "draft",
      text: "keep",
    });
    await started.promise;
    expect(await pending).toMatchObject({
      error: {
        code: RPC_ERROR_CODES.deadlineExceeded,
        data: {
          category: "deadline",
          retryable: true,
          delivery: "not-sent",
          commandId: "command-a",
        },
      },
    });
    expect(dispatch).not.toHaveBeenCalled();
    finish.resolve(true);
  });
  it("admits eight real dispatcher controls without double charging tracked work", async () => {
    const finish = deferred<unknown>();
    const allStarted = deferred<void>();
    let started = 0;
    const dispatcher = createHostDispatcher({
      environmentId: ENVIRONMENT,
      environment: { describe: async () => ({}) },
      projects: { list: async () => [] },
      operations: {
        "environment.persistence.status": async () => {
          if (++started === 8) allStarted.resolve();
          return finish.promise;
        },
      },
    });
    const host = await fixture({
      methods: ["environment.persistence.status"],
      dispatch: dispatcher.dispatch,
    });
    const first = await host.ready();
    const second = await host.ready();
    const third = await host.ready();
    const jobs = Array.from({ length: 8 }, (_, i) =>
      (i < 4 ? first : second).request(`real-${i}`, "environment.persistence.status"),
    );
    await allStarted.promise;
    try {
      expect(await third.request("real-overload", "environment.persistence.status")).toMatchObject({
        error: {
          code: RPC_ERROR_CODES.overloaded,
          data: { category: "overload", delivery: "not-sent" },
        },
      });
    } finally {
      finish.resolve({ state: "ready" });
    }
    expect((await Promise.all(jobs)).every((item) => "result" in item)).toBe(true);
  });

  it("holds the real tracked child slot after a query response deadline", async () => {
    const finish = deferred<unknown>();
    const started = deferred<void>();
    const dispatcher = createHostDispatcher({
      environmentId: ENVIRONMENT,
      environment: { describe: async () => ({}) },
      projects: {
        list: async () => {
          started.resolve();
          return finish.promise;
        },
      },
    });
    const host = await fixture({
      dispatch: dispatcher.dispatch,
      limits: { maxReadJobsPerDevice: 1, defaultResponseTimeoutMs: 40 },
    });
    const client = await host.ready();
    const first = client.request("real-timeout", "projects.list");
    await started.promise;
    expect(await first).toMatchObject({ error: { code: RPC_ERROR_CODES.deadlineExceeded } });
    expect(await client.request("real-held", "projects.list")).toMatchObject({
      error: {
        code: RPC_ERROR_CODES.overloaded,
        data: { category: "overload", delivery: "not-sent" },
      },
    });
    finish.resolve([]);
    await finish.promise;
  });
  it("answers a pre-execution refusal over WS with a conflict code, its message and not-sent delivery", async () => {
    const dispatcher = createHostDispatcher({
      environmentId: ENVIRONMENT,
      environment: { describe: async () => ({}) },
      projects: { list: async () => [] },
      operations: {
        "notes.delete": async () => {
          throw new HostDomainRefusalError(
            "QUEUE_CHANGED",
            "conflict",
            false,
            "The shared queue changed. Refresh it before sending.",
            { cause: new Error("private queue revision 7") },
          );
        },
      },
    });
    const host = await fixture({ methods: ["notes.delete"], dispatch: dispatcher.dispatch });
    const client = await host.ready();
    const response = await client.request("refused", "notes.delete", {
      id: "note",
      expectedUpdatedAt: 1,
    });
    expect(response).toMatchObject({
      error: {
        code: RPC_ERROR_CODES.conflict,
        message: "The shared queue changed. Refresh it before sending.",
        data: {
          category: "conflict",
          retryable: false,
          delivery: "not-sent",
          code: "QUEUE_CHANGED",
        },
      },
    });
    expect(JSON.stringify(response)).not.toMatch(/private/);
  });

  it("keeps an error after a mutation started as an unknown outcome over WS", async () => {
    let effects = 0;
    const dispatcher = createHostDispatcher({
      environmentId: ENVIRONMENT,
      environment: { describe: async () => ({}) },
      projects: { list: async () => [] },
      operations: {
        "notes.delete": async () => {
          effects++;
          throw new Error("committed, then the reply path failed");
        },
      },
    });
    const host = await fixture({ methods: ["notes.delete"], dispatch: dispatcher.dispatch });
    const client = await host.ready();
    expect(
      await client.request("after-effect", "notes.delete", { id: "note", expectedUpdatedAt: 1 }),
    ).toMatchObject({
      error: { data: { category: "unavailable", retryable: false, delivery: "unknown" } },
    });
    expect(effects).toBe(1);
  });

  it.each(["not-sent", "unknown"] as const)(
    "preserves trusted actual device admission outcome %s",
    async (delivery) => {
      const dispatch = vi.fn<HostWebSocketOptions["dispatch"]>(async () => {
        throw new HostDispatchError(
          "service-unavailable",
          "Device stop held",
          {
            cause: new HostDomainOutcomeError("Device stop held", delivery),
          },
          { category: "unavailable", retryable: false, delivery },
        );
      });
      const host = await fixture({ methods: ["devices.stop"], dispatch });
      const client = await host.ready();
      expect(await client.request("device-outcome", "devices.stop", {})).toMatchObject({
        error: { data: { delivery, retryable: false } },
      });
    },
  );
  it("preserves explicitly accepted effect delivery from a domain outcome", async () => {
    const dispatch = vi.fn<HostWebSocketOptions["dispatch"]>(async () => {
      throw new HostDispatchError("service-unavailable", "Committed but unconfirmed.", undefined, {
        category: "unavailable",
        retryable: false,
        delivery: "accepted",
        commandId: "command-a",
      });
    });
    const host = await fixture({ methods: ["commands.dispatch"], dispatch });
    const client = await host.ready();
    const result = await client.request("accepted", "commands.dispatch", {
      commandId: "command-a",
      sessionId: "session-a",
      type: "draft",
      text: "keep",
    });
    expect(result).toMatchObject({
      error: {
        data: {
          category: "unavailable",
          retryable: false,
          delivery: "accepted",
          commandId: "command-a",
        },
      },
    });
  });
});

it.each([false, true])(
  "normalizes typed actual result bytes once with bulk=%s",
  async (withBulk) => {
    const toJSON = vi.fn((key: string) => {
      expect(key).toBe("");
      return [{ id: "project-a", name: "Typed 雪", cwd: "C:/Fixture", optional: undefined }];
    });
    const host = await fixture({
      ...(withBulk ? { bulk: new HostBulkTransfers({ environmentId: ENVIRONMENT }) } : {}),
      dispatch: async () => ({ toJSON }),
    });
    const client = await host.ready();
    expect(await client.request("typed-normalized", "projects.list")).toMatchObject({
      result: [{ id: "project-a", name: "Typed 雪", cwd: "C:/Fixture" }],
    });
    expect(toJSON).toHaveBeenCalledExactlyOnceWith("");
  },
);

describe("slow consumer back-pressure", () => {
  async function slowStreamFixture() {
    const hub = new HostSubscriptionHub({
      environmentId: ENVIRONMENT,
      load: async () => ({ revision: 1, data: { blob: "x".repeat(600) } }),
    });
    const host = await fixture({
      subscriptions: hub,
      limits: { maxSocketQueuedBytes: 1_000 },
      methods: [],
    });
    cleanups.push(async () => hub.close());
    let buffered = 0;
    const spy = vi
      .spyOn(WebSocket.prototype, "bufferedAmount", "get")
      .mockImplementation(() => buffered);
    onTestFinished(() => spy.mockRestore());
    const socket = new WebSocket(`ws://127.0.0.1:${host.port}/ws`, WS_SUBPROTOCOL, {
      headers: { Authorization: `Bearer ${TOKEN_A}` },
    });
    const frames: Array<{ id?: string; method?: string; params?: { kind?: string } }> = [];
    socket.on("message", (data) => frames.push(JSON.parse(data.toString())));
    const closed = new Promise<number>((resolve) => socket.once("close", resolve));
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    cleanups.push(async () => socket.terminate());
    const call = (id: string, method: string, params: unknown) =>
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    call("hello", "connection.hello", {
      environmentId: ENVIRONMENT,
      supportedWireVersions: [WS_WIRE_VERSION],
      supportedSchemaVersions: [HOST_SCHEMA_VERSION],
      clientId: "fixture-client",
      clientKind: "desktop",
    });
    await vi.waitFor(() => expect(frames.some((frame) => frame.id === "hello")).toBe(true));
    const open = (id: string) =>
      call(id, "subscriptions.open", {
        subscriptionId: id,
        target: { kind: "session", sessionId: "session" },
      });
    return {
      frames,
      closed,
      socket,
      open,
      setBuffered: (bytes: number) => {
        buffered = bytes;
      },
    };
  }

  it("resyncs only the lagging subscription and keeps the socket open", async () => {
    const slow = await slowStreamFixture();
    slow.setBuffered(900);
    slow.open("sub-1");
    await vi.waitFor(() =>
      expect(slow.frames.some((frame) => frame.params?.kind === "resync-required")).toBe(true),
    );
    expect(slow.frames.some((frame) => frame.params?.kind === "snapshot")).toBe(false);
    expect(slow.socket.readyState).toBe(WebSocket.OPEN);
    // Drained: the next subscription gets its snapshot on the same connection.
    slow.setBuffered(0);
    slow.open("sub-2");
    await vi.waitFor(() =>
      expect(slow.frames.some((frame) => frame.params?.kind === "snapshot")).toBe(true),
    );
    expect(slow.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("still closes the socket with 1013 when the queue stays over the cap", async () => {
    const slow = await slowStreamFixture();
    const now = vi.spyOn(performance, "now");
    onTestFinished(() => now.mockRestore());
    slow.setBuffered(900);
    slow.open("sub-1");
    await vi.waitFor(() =>
      expect(slow.frames.some((frame) => frame.params?.kind === "resync-required")).toBe(true),
    );
    now.mockReturnValue(performance.now() + 31_000);
    slow.open("sub-2");
    expect(await slow.closed).toBe(1013);
  });

  it("closes the socket when even the control reserve is exhausted", async () => {
    const slow = await slowStreamFixture();
    slow.setBuffered(1_300);
    slow.open("sub-1");
    expect(await slow.closed).toBe(1013);
  });
});
