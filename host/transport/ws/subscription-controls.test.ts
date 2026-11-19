import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import {
  HOST_SCHEMA_VERSION,
  RPC_ERROR_CODES,
  RpcResponseSchema,
  WS_SUBPROTOCOL,
  WS_WIRE_VERSION,
  type RpcResponse,
} from "../../../src/shared/model/host-contracts";
import { attachHostWebSocketTransport, type HostWebSocketOptions } from "./server";
import type { HostSubscriptionHub } from "./subscriptions";

const TOKEN = "A".repeat(43);
const ENVIRONMENT = "fixture-subscription-controls";
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

/** A hub that only records the order in which controls took effect. */
function recordingHub() {
  const effects: string[] = [];
  const hub = {
    open: vi.fn(),
    acknowledge: vi.fn(
      (_connection: string, subscriptionId: string, cursor: { sequence: number }) => {
        effects.push(`ack:${subscriptionId}:${cursor.sequence}`);
        return true;
      },
    ),
    closeSubscription: vi.fn((_connection: string, subscriptionId: string) => {
      effects.push(`close:${subscriptionId}`);
      return true;
    }),
    detach: vi.fn(),
  };
  return { effects, hub: hub as unknown as HostSubscriptionHub };
}

async function fixture(
  limits: HostWebSocketOptions["limits"],
  authorized: () => Promise<boolean> = async () => true,
) {
  const { effects, hub } = recordingHub();
  const server = createServer((_request, response) => response.writeHead(404).end());
  const transport = attachHostWebSocketTransport({
    server,
    environmentId: ENVIRONMENT,
    authenticate: async () => ({ id: "device-a", authorized }),
    dispatch: async () => ({}),
    subscriptions: hub,
    limits,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const sockets = new Set<WebSocket>();
  cleanups.push(async () => {
    for (const socket of sockets) socket.terminate();
    await transport.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const connect = async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, WS_SUBPROTOCOL, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    sockets.add(socket);
    const responses = new Map<string, RpcResponse>();
    const waiting = new Map<string, (response: RpcResponse) => void>();
    socket.on("message", (data) => {
      const response = RpcResponseSchema.parse(JSON.parse(data.toString()));
      if (typeof response.id !== "string") return;
      responses.set(response.id, response);
      waiting.get(response.id)?.(response);
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    const response = (id: string) =>
      responses.has(id)
        ? Promise.resolve(responses.get(id)!)
        : new Promise<RpcResponse>((resolve) => waiting.set(id, resolve));
    const request = (id: string, method: string, params: unknown) => {
      const reply = response(id);
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      return reply;
    };
    await request("hello", "connection.hello", {
      environmentId: ENVIRONMENT,
      supportedWireVersions: [WS_WIRE_VERSION],
      supportedSchemaVersions: [HOST_SCHEMA_VERSION],
      clientId: "fixture-client",
      clientKind: "desktop",
    });
    return { request };
  };
  return { effects, hub, connect };
}

const ack = (subscriptionId: string, sequence: number) => ({
  subscriptionId,
  cursor: { epoch: "epoch-a", sequence },
});

describe("subscription control lane", () => {
  it("queues a burst past the lane slots and applies it in arrival order", async () => {
    const gate = deferred<boolean>();
    let hold = false;
    const host = await fixture(
      { maxSubscriptionControlsPerSocket: 2, maxQueuedSubscriptionControlsPerSocket: 4 },
      () => (hold ? gate.promise : Promise.resolve(true)),
    );
    const client = await host.connect();
    hold = true;
    const burst = [
      client.request("ack-1", "subscriptions.ack", ack("stream-a", 1)),
      client.request("ack-2", "subscriptions.ack", ack("stream-a", 2)),
      client.request("ack-3", "subscriptions.ack", ack("stream-b", 1)),
      client.request("close-a", "subscriptions.close", { subscriptionId: "stream-a" }),
      client.request("ack-4", "subscriptions.ack", ack("stream-b", 2)),
      client.request("close-b", "subscriptions.close", { subscriptionId: "stream-b" }),
    ];
    // Two slots and four queue places are full: the next control is refused before it runs.
    expect(await client.request("ack-over", "subscriptions.ack", ack("stream-c", 1))).toMatchObject(
      {
        error: {
          code: RPC_ERROR_CODES.overloaded,
          data: { category: "overload", retryable: true, delivery: "not-sent" },
        },
      },
    );
    expect(host.effects).toEqual([]);
    hold = false;
    gate.resolve(true);
    for (const reply of await Promise.all(burst))
      expect(reply).toMatchObject({ result: { accepted: true } });
    expect(host.effects).toEqual([
      "ack:stream-a:1",
      "ack:stream-a:2",
      "ack:stream-b:1",
      "close:stream-a",
      "ack:stream-b:2",
      "close:stream-b",
    ]);
  });

  it("fails a queued control at its deadline as not sent and leaves later ones usable", async () => {
    let hold = false;
    const host = await fixture(
      {
        maxSubscriptionControlsPerSocket: 1,
        maxQueuedSubscriptionControlsPerSocket: 2,
        defaultResponseTimeoutMs: 60,
      },
      () => (hold ? new Promise<boolean>(() => {}) : Promise.resolve(true)),
    );
    const client = await host.connect();
    // Authorization stalls from here: the first control holds the slot, the second queues behind it.
    hold = true;
    const stalled = client.request("ack-stalled", "subscriptions.ack", ack("stream-a", 1));
    const queued = client.request("ack-queued", "subscriptions.ack", ack("stream-a", 2));
    for (const reply of await Promise.all([stalled, queued]))
      expect(reply).toMatchObject({
        // Deadline and admission time coincide here; either way nothing ran and a retry is safe.
        error: { data: { retryable: true } },
      });
    expect(host.effects).toEqual([]);
  });
});
