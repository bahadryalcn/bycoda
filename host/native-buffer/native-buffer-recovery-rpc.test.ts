import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { once } from "node:events";
import { WebSocket } from "ws";
import { WS_SUBPROTOCOL } from "../../src/shared/model/host-contracts";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { HostEngine } from "../engine";
import { HostStore } from "../store";
import { createNativeBufferPersistenceStore } from "./native-buffer-persistence-store";
import { createHostServer } from "../server";
import type {
  NativeBufferRecoveryMetadata,
  NativeBufferRecoverySource,
} from "./native-buffer-reports";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});
async function fixture() {
  const temporary = await realpath(tmpdir());
  const root = await mkdtemp(join(temporary, "bycoda-buffer-recovery-rpc-"));
  const path = join(root, "workspace");
  await mkdir(path);
  const store = new HostStore(join(root, "host.db"));
  const engine = new HostEngine(store, {});
  const server = await createHostServer(engine, []);
  const clients: WebSocket[] = [];
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  cleanups.push(async () => {
    for (const client of clients) client.terminate();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.closeResources();
    await engine.close();
    await store.close();
    if (
      dirname(root) !== temporary ||
      !root.startsWith(join(temporary, "bycoda-buffer-recovery-rpc-"))
    )
      throw new Error("Unsafe fixture path");
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const first = await store.issueDevice("Native profile fixture"),
    second = await store.issueDevice("Other owner");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
  const call = async <T = Record<string, unknown>>(
    method: string,
    params: unknown = {},
    token = first.token,
  ) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
    });
    return {
      status: response.status,
      ...((await response.json()) as { result?: T; error?: string }),
    };
  };
  const stores = [randomUUID(), randomUUID()],
    windows = [randomUUID(), randomUUID()];
  let version = 0;
  const update = async (count = 1) => {
    const buffers = [{ path: join(path, "draft.txt"), dirty: true }];
    const owners = Array.from({ length: count }, (_, i) => ({
      ownerId: `physical:v2:${sha(`${stores[i]}:${windows[i]}`)}`,
      updatedAt: Date.now(),
      unknown: false,
      buffers,
      source: {
        version: 2,
        sourceStoreId: "actual-native-store",
        sourceProfileId: "actual-native-profile",
        storeInstance: stores[i],
        windowIncarnation: windows[i],
        kind: "physical",
        reportVersion: ++version,
        reportNonce: randomUUID(),
        snapshotDigest: sha(JSON.stringify(buffers)),
      },
    }));
    const result = await call("native.buffers.update", {
      clientId: "native-profile-client",
      instanceId: "native-instance",
      processId: process.pid,
      owners,
    });
    expect(result.error).toBeUndefined();
  };
  const list = (params: unknown = {}, token = first.token) =>
    call<{ version: 1; qualified: false; records: NativeBufferRecoveryMetadata[]; next: unknown }>(
      "native.buffers.recovery.list",
      params,
      token,
    );
  let sequence = 0;
  const wsRpc = async <T = Record<string, unknown>>(
    socket: WebSocket,
    method: string,
    params: unknown = {},
  ) => {
    const id = `recovery-${++sequence}`;
    const pending = new Promise<{ result?: T; error?: { code: number; message: string } }>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          socket.off("message", receive);
          reject(new Error("Recovery WS fixture timeout"));
        }, 10_000);
        const receive = (data: Buffer) => {
          const value = JSON.parse(String(data));
          if (value.id === id) {
            clearTimeout(timer);
            socket.off("message", receive);
            resolve(value);
          }
        };
        socket.on("message", receive);
      },
    );
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return pending;
  };
  const ready = async (token = first.token) => {
    const socket = new WebSocket(
      url.replace("http:", "ws:").replace("/rpc", "/ws"),
      WS_SUBPROTOCOL,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    clients.push(socket);
    await once(socket, "open");
    const hello = await wsRpc<{ methods: string[]; capabilities: string[] }>(
      socket,
      "connection.hello",
      {
        environmentId: store.environmentId,
        clientId: "native-fixture",
        clientKind: "desktop",
        supportedWireVersions: [2],
        supportedSchemaVersions: [1],
      },
    );
    expect(hello.error).toBeUndefined();
    expect(hello.result?.methods).toContain("native.buffers.recovery.read");
    expect(hello.result?.capabilities).toContain("native.buffers.recovery.v1");
    return socket;
  };
  return {
    store,
    first,
    second,
    call,
    update,
    list,
    ready,
    wsRpc,
    path,
    port: (server.address() as AddressInfo).port,
  };
}

it("routes current and archived exact reports through the real opaque runtime owner", async () => {
  const f = await fixture();
  expect(
    (await f.call<{ capabilities: string[] }>("environment.describe")).result?.capabilities,
  ).toContain("native.buffers.recovery.v1");
  await f.update();
  const page = await f.list({ limit: 25 });
  expect(page.error).toBeUndefined();
  expect(page.result).toMatchObject({ version: 1, qualified: false });
  const source = page.result!.records[0].source;
  const first = await f.call<{
    rawReport: string;
    qualified: false;
    resolution: string;
    owner: { source: { sourceStoreId: string } };
  }>("native.buffers.recovery.read", source);
  expect(first.error).toBeUndefined();
  expect(sha(first.result!.rawReport)).toBe(source.snapshotDigest);
  expect(first.result).toMatchObject({
    qualified: false,
    resolution: "unsupported",
    owner: { source: { sourceStoreId: "actual-native-store" } },
  });
  await f.update();
  expect((await f.call("native.buffers.recovery.read", source)).result).toEqual(first.result);
  expect((await f.call("native.buffers.recovery.status", source)).result).toMatchObject({
    found: true,
    qualified: false,
    resolution: "unsupported",
  });
  const stale: NativeBufferRecoverySource = { ...source, ownerVersion: source.ownerVersion + 1 };
  expect((await f.call("native.buffers.recovery.status", stale)).result).toMatchObject({
    found: false,
  });
  expect((await f.call("native.buffers.recovery.read", stale)).error).toContain(
    "unavailable or changed",
  );
});

it("does not disclose another paired owner's reports and binds cursors to their owner device", async () => {
  const f = await fixture();
  await f.update(2);
  const page = await f.list({ limit: 1 });
  expect(page.result!.next).not.toBeNull();
  const source = page.result!.records[0].source;
  expect((await f.list({}, f.second.token)).result?.records).toEqual([]);
  expect((await f.call("native.buffers.recovery.read", source, f.second.token)).error).toContain(
    "unavailable or changed",
  );
  expect(
    (await f.call("native.buffers.recovery.status", source, f.second.token)).result,
  ).toMatchObject({ found: false });
  expect((await f.list({ after: page.result!.next, limit: 1 }, f.second.token)).error).toContain(
    "cursor",
  );
});

it("rejects forged source fields, unsafe cursors and caller-supplied routing arguments", async () => {
  const f = await fixture();
  await f.update();
  const source = (await f.list()).result!.records[0].source;
  for (const params of [
    { clientId: "renderer-selected" },
    { endpoint: "http://elsewhere" },
    { limit: 101 },
    { after: { version: 1, cursorId: randomUUID(), page: 0 } },
  ])
    expect((await f.list(params)).error).toBeTruthy();
  expect(
    (await f.call("native.buffers.recovery.read", { ...source, path: "C:\\arbitrary" })).error,
  ).toBeTruthy();
  expect(
    (await f.call("native.buffers.recovery.read", { ...source, snapshotDigest: "0".repeat(64) }))
      .error,
  ).toContain("unavailable or changed");
});

it("serves authenticated WS recovery queries through the same opaque owner and rejects other devices", async () => {
  const f = await fixture();
  await f.update();
  const socket = await f.ready();
  const listed = await f.wsRpc<{ records: NativeBufferRecoveryMetadata[] }>(
    socket,
    "native.buffers.recovery.list",
    { limit: 25 },
  );
  expect(listed.error).toBeUndefined();
  const source = listed.result!.records[0].source;
  const read = await f.wsRpc<{ rawReport: string; qualified: false }>(
    socket,
    "native.buffers.recovery.read",
    source,
  );
  expect(read.error).toBeUndefined();
  expect(read.result?.qualified).toBe(false);
  expect(sha(read.result!.rawReport)).toBe(source.snapshotDigest);
  expect((await f.wsRpc(socket, "native.buffers.recovery.status", source)).result).toMatchObject({
    found: true,
    qualified: false,
    resolution: "unsupported",
  });
  const other = await f.ready(f.second.token);
  expect(
    (await f.wsRpc<{ records: unknown[] }>(other, "native.buffers.recovery.list", {})).result
      ?.records,
  ).toEqual([]);
  const foreign = await f.wsRpc(other, "native.buffers.recovery.read", source);
  expect(foreign.result).toBeUndefined();
  expect(foreign.error).toBeTruthy();
  expect(
    (await f.wsRpc(socket, "native.buffers.recovery.list", { endpoint: "http://other" })).error,
  ).toBeTruthy();
});

it("moves a large exact report to authenticated WS bulk without changing retained bytes or granting another device access", async () => {
  const f = await fixture();
  await f.update();
  const first = (await f.list()).result!.records[0].source;
  const persistence = createNativeBufferPersistenceStore(f.store),
    snapshot = `native-activity/buffers/${first.reportId}.json`;
  const fixtureBody = JSON.parse(
    (await persistence.read(snapshot, 64 * 1024 * 1024))!.toString("utf8"),
  );
  fixtureBody.owners[0].buffers = Array.from({ length: 3000 }, (_, i) => ({
    path: join(f.path, `large-${i}-${"path".repeat(29)}.txt`),
    dirty: true,
  }));
  fixtureBody.owners[0].source.snapshotDigest = sha(JSON.stringify(fixtureBody.owners[0].buffers));
  const raw = JSON.stringify(fixtureBody);
  expect(Buffer.byteLength(raw)).toBeLessThan(1024 * 1024);
  await persistence.complete({
    writes: [{ key: snapshot, bytes: Buffer.from(raw), immutable: false }],
    certificates: [],
    authorize: async () => {
      if (!(await f.store.authenticated(f.first.token)))
        throw new Error("Fixture paired owner revoked");
    },
  });
  const source = (await f.list()).result!.records[0].source;
  const socket = await f.ready();
  const response = await f.wsRpc<{
    $bulk: { transferId: string; totalBytes: number; chunkBytes: number; sha256: string };
  }>(socket, "native.buffers.recovery.read", source);
  expect(response.error).toBeUndefined();
  const descriptor = response.result!.$bulk;
  expect(descriptor.totalBytes).toBeGreaterThan(1_048_576);
  const endpoint = `http://127.0.0.1:${f.port}/ws-bulk/${descriptor.transferId}`;
  expect(
    (
      await fetch(`${endpoint}?offset=0`, {
        headers: { Authorization: `Bearer ${f.second.token}` },
      })
    ).status,
  ).not.toBe(200);
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < descriptor.totalBytes; offset += descriptor.chunkBytes) {
    const chunk = await fetch(`${endpoint}?offset=${offset}`, {
      headers: { Authorization: `Bearer ${f.first.token}` },
    });
    expect(chunk.status).toBe(200);
    chunks.push(Buffer.from(await chunk.arrayBuffer()));
  }
  const bytes = Buffer.concat(chunks);
  expect(sha(bytes.toString())).toBe(descriptor.sha256);
  const value = JSON.parse(bytes.toString());
  expect(value.rawReport).toBe(raw);
  expect(value.qualified).toBe(false);
  expect(value.resolution).toBe("unsupported");
  expect((await persistence.read(snapshot, 64 * 1024 * 1024))!.toString("utf8")).toBe(raw);
  await f.store.revokeDevice(f.first.id);
  expect(
    (await fetch(`${endpoint}?offset=0`, { headers: { Authorization: `Bearer ${f.first.token}` } }))
      .status,
  ).not.toBe(200);
});

it("revalidates paired authorization after delayed owner work before publishing recovery metadata", async () => {
  const f = await fixture();
  await f.update();
  const original = f.store.pairedDevices.bind(f.store);
  let calls = 0;
  vi.spyOn(f.store, "pairedDevices").mockImplementation(async (token) => {
    if (token === f.first.token && ++calls === 2) await f.store.revokeDevice(f.first.id);
    return original(token);
  });
  const result = await f.list();
  expect(result.result).toBeUndefined();
  expect(result.error).toContain("revoked");
});
