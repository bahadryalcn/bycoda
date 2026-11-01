import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { afterEach, expect, it, vi } from "vitest";
import { createNativeBufferUploadService } from "./buffer-upload";
import { nativeBufferUploadPlatform } from "../../ports/native-workspaces";
import { createHostDispatcher } from "../../transport/dispatch";
import { attachHostWebSocketTransport } from "../../transport/ws/server";
import {
  NATIVE_BUFFER_UPLOAD_METHODS,
  NATIVE_BUFFER_UPLOAD_LIMITS,
} from "../../../src/shared/model/host-contracts/native-buffer-upload";
import {
  HOST_SCHEMA_VERSION,
  RPC_ERROR_CODES,
  WS_SUBPROTOCOL,
  WS_WIRE_VERSION,
} from "../../../src/shared/model/host-contracts";
import type { HostDomainContext } from "../context";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(deadline?: number) {
  let clock = 1000,
    permitted = true;
  const started = deferred(),
    finish = deferred();
  const update = vi.fn(async () => {
    started.resolve();
    await finish.promise;
    return { acknowledged: true };
  });
  const uploads = createNativeBufferUploadService({
    platform: nativeBufferUploadPlatform,
    environmentId: "env-wire",
    update,
    now: () => clock,
  });
  const dispatch = createHostDispatcher({
    environmentId: "env-wire",
    environment: { describe: async () => ({}) },
    projects: { list: async () => [] },
    operations: Object.fromEntries(
      NATIVE_BUFFER_UPLOAD_METHODS.map((method) => [
        method,
        (params: Record<string, unknown>, context: HostDomainContext) =>
          uploads.call(method, params, context),
      ]),
    ),
  });
  const server = createServer();
  const workspaceOwner: NonNullable<HostDomainContext["workspaceOwner"]> = async () => {
    throw new Error("Upload fixture update is already supplied by its isolated execution port");
  };
  const transport = attachHostWebSocketTransport({
    server,
    environmentId: "env-wire",
    methods: dispatch.methods,
    capabilities: ["native.buffers.upload.v1"],
    limits: deadline === undefined ? undefined : { defaultResponseTimeoutMs: deadline },
    authenticate: async (token) => ({
      id: token === "A".repeat(43) ? "principal-a" : "principal-b",
      authorized: async () => permitted,
      workspaceOwner,
    }),
    dispatch: dispatch.dispatch,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const clients: WebSocket[] = [];
  cleanups.push(async () => {
    finish.resolve();
    for (const client of clients) client.terminate();
    await transport.close();
    await uploads.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const connect = async (token = "A".repeat(43)) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`,
      WS_SUBPROTOCOL,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    clients.push(socket);
    const pending = new Map<
      string,
      {
        resolve(value: any): void;
        reject(error: Error): void;
        timer: ReturnType<typeof setTimeout>;
      }
    >();
    socket.on("message", (data) => {
      const value = JSON.parse(data.toString()),
        waiter = pending.get(value.id);
      if (waiter) {
        pending.delete(value.id);
        clearTimeout(waiter.timer);
        waiter.resolve(value);
      }
    });
    socket.on("close", () => {
      for (const waiter of pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("Closed"));
      }
      pending.clear();
    });
    socket.on("error", () => {});
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    let next = 0;
    const request = (method: string, params: unknown = {}) =>
      new Promise<any>((resolve, reject) => {
        const id = `fixture-${++next}`,
          timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error("Fixture response missing"));
          }, 5000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      });
    expect(
      (
        await request("connection.hello", {
          environmentId: "env-wire",
          supportedWireVersions: [WS_WIRE_VERSION],
          supportedSchemaVersions: [HOST_SCHEMA_VERSION],
          clientId: "fixture",
          clientKind: "desktop",
        })
      ).error,
    ).toBeUndefined();
    return { request, socket };
  };
  const stage = async (client: Awaited<ReturnType<typeof connect>>) => {
    const bytes = Buffer.from(
      JSON.stringify({ clientId: "c", instanceId: "i", processId: 1, owners: [] }),
    );
    expect(
      (
        await client.request("native.buffers.upload.start", {
          uploadId: "upload-a",
          byteLength: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        })
      ).error,
    ).toBeUndefined();
    expect(
      (
        await client.request("native.buffers.upload.write", {
          uploadId: "upload-a",
          offset: 0,
          data: bytes.toString("base64"),
        })
      ).error,
    ).toBeUndefined();
  };
  return {
    update,
    started,
    finish,
    connect,
    stage,
    expire: () => {
      clock += NATIVE_BUFFER_UPLOAD_LIMITS.ttlMs + 1;
    },
    revoke: () => {
      permitted = false;
    },
  };
}

it("preserves the12s read default and chooses the declared30s Native deadline", async () => {
  const f = await fixture(),
    client = await f.connect(),
    spy = vi.spyOn(globalThis, "setTimeout");
  // projects.* reads now declare the 30 s slow-read deadline; environment.describe keeps the default.
  expect((await client.request("environment.describe")).error).toBeUndefined();
  expect(spy.mock.calls.map((args) => args[1])).toContain(12_000);
  spy.mockClear();
  expect(
    (await client.request("native.buffers.upload.status", { uploadId: "missing" })).result,
  ).toBeNull();
  expect(spy.mock.calls.map((args) => args[1])).toContain(30_000);
  expect(spy.mock.calls.map((args) => args[1])).not.toContain(12_000);
});

it("honors an explicit deadline ceiling while retaining the exact accepted commit and IO ownership", async () => {
  const f = await fixture(500),
    client = await f.connect();
  await f.stage(client);
  const response = client.request("native.buffers.upload.commit", { uploadId: "upload-a" });
  await f.started.promise;
  expect((await response).error).toMatchObject({
    code: RPC_ERROR_CODES.deadlineExceeded,
    data: { delivery: "unknown", retryable: false },
  });
  f.expire();
  expect(
    (await client.request("native.buffers.upload.status", { uploadId: "upload-a" })).result.state,
  ).toBe("committing");
  f.finish.resolve();
  expect(
    (await client.request("native.buffers.upload.commit", { uploadId: "upload-a" })).result,
  ).toMatchObject({ state: "completed", result: { acknowledged: true } });
  expect(f.update).toHaveBeenCalledTimes(1);
});

it("returns authoritative null for missing/expired/foreign uploads but rejects revoked authorization", async () => {
  const f = await fixture(),
    owner = await f.connect(),
    other = await f.connect("B".repeat(43));
  const key = { uploadId: "upload-a" };
  expect((await owner.request("native.buffers.upload.status", key)).result).toBeNull();
  await f.stage(owner);
  expect((await owner.request("native.buffers.upload.status", key)).result.state).toBe("receiving");
  expect((await other.request("native.buffers.upload.status", key)).result).toBeNull();
  f.expire();
  expect((await owner.request("native.buffers.upload.status", key)).result).toBeNull();
  await f.stage(owner);
  expect(f.update).not.toHaveBeenCalled();
  const commit = owner.request("native.buffers.upload.commit", key);
  await f.started.promise;
  f.expire();
  expect((await owner.request("native.buffers.upload.status", key)).result.state).toBe(
    "committing",
  );
  f.finish.resolve();
  expect((await commit).result.state).toBe("completed");
  f.expire();
  expect((await owner.request("native.buffers.upload.status", key)).result).toBeNull();
  expect(f.update).toHaveBeenCalledTimes(1);
  f.revoke();
  expect((await owner.request("native.buffers.upload.status", key)).error.code).toBe(
    RPC_ERROR_CODES.unauthorized,
  );
});

it("keeps admitted work across socket detach and lets a new socket reconcile the same uploadId", async () => {
  const f = await fixture(),
    client = await f.connect();
  await f.stage(client);
  const response = client.request("native.buffers.upload.commit", { uploadId: "upload-a" });
  const detached = expect(response).rejects.toThrow("Closed");
  await f.started.promise;
  client.socket.terminate();
  await detached;
  const resumed = await f.connect();
  expect(
    (await resumed.request("native.buffers.upload.status", { uploadId: "upload-a" })).result.state,
  ).toBe("committing");
  f.finish.resolve();
  expect(
    (await resumed.request("native.buffers.upload.commit", { uploadId: "upload-a" })).result.state,
  ).toBe("completed");
  expect(f.update).toHaveBeenCalledTimes(1);
});
