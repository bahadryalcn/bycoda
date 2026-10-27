import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { BulkDescriptorSchema, type JsonValue } from "../../../src/shared/model/host-contracts";
import { createHostBulkHandler, HostBulkTransfers } from "./bulk";

const pools: HostBulkTransfers[] = [];
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  for (const pool of pools.splice(0)) pool.close();
});
function fixture(options: ConstructorParameters<typeof HostBulkTransfers>[0]["limits"] = {}) {
  let now = 1000;
  const pool = new HostBulkTransfers({
    environmentId: "environment",
    now: () => now,
    limits: { chunkBytes: 16, ...options },
  });
  pools.push(pool);
  const retain = (principal: string, resource: string, value: JsonValue) => {
    const lease = pool.begin(principal, resource);
    try {
      return BulkDescriptorSchema.parse(
        (pool.encode(lease, value, 1) as Record<string, unknown>).$bulk,
      );
    } finally {
      pool.release(lease);
    }
  };
  return {
    pool,
    retain,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

it("reconstructs immutable UTF-8 JSON through exact bounded chunks and a content hash", () => {
  const { pool, retain } = fixture();
  const value = { text: "Türkçe 🙂".repeat(40) };
  const descriptor = retain("owner", "session:s", value);
  const chunks = [];
  for (let offset = 0; offset < descriptor.totalBytes; offset += descriptor.chunkBytes) {
    const chunk = pool.chunk("owner", descriptor.transferId, offset);
    expect(chunk.length).toBeLessThanOrEqual(descriptor.chunkBytes);
    chunks.push(chunk);
  }
  const result = Buffer.concat(chunks);
  expect(JSON.parse(result.toString())).toEqual(value);
  expect(createHash("sha256").update(result).digest("hex")).toBe(descriptor.sha256);
  pool.chunk("owner", descriptor.transferId, 0).fill(0);
  expect(pool.chunk("owner", descriptor.transferId, 0).toString()).toContain("text");
});

it("isolates device scope and rejects foreign/unaligned offsets without revealing content", () => {
  const { pool, retain } = fixture();
  const descriptor = retain("owner", "session:s", { text: "private".repeat(20) });
  expect(() => pool.chunk("other", descriptor.transferId, 0)).toThrow("unavailable");
  for (const offset of [-1, 1, NaN, Number.MAX_SAFE_INTEGER + 1, descriptor.totalBytes])
    expect(() => pool.chunk("owner", descriptor.transferId, offset)).toThrow();
});

it("deletion purges retained snapshots and invalidates a read lease before its late capture", () => {
  const { pool, retain } = fixture();
  const descriptor = retain("owner", "session:s", { private: "old" });
  const late = pool.begin("owner", "session:s");
  const unrelated = retain("owner", "session:t", { keep: "draft" });
  pool.invalidate("session:s");
  expect(() => pool.encode(late, { private: "late" }, 999)).toThrow("context changed");
  expect(() => pool.chunk("owner", descriptor.transferId, 0)).toThrow("unavailable");
  expect(pool.chunk("owner", unrelated.transferId, 0).length).toBeGreaterThan(0);
});

it("reuses identical scoped content, expires snapshots and bounds retained/admitted work", () => {
  const { pool, retain, advance } = fixture({ maxTransfers: 2, maxLeases: 1, ttlMs: 100 });
  const first = retain("owner", "one", { value: 1 });
  expect(retain("owner", "one", { value: 1 })).toEqual(first);
  advance(1);
  retain("owner", "two", { value: 2 });
  advance(1);
  const third = retain("owner", "three", { value: 3 });
  expect(() => pool.chunk("owner", first.transferId, 0)).toThrow("unavailable");
  const held = pool.begin("owner", "held");
  expect(() => pool.begin("owner", "overflow")).toThrow("busy");
  pool.release(held);
  advance(100);
  expect(() => pool.chunk("owner", third.transferId, 0)).toThrow("unavailable");
  expect(retain("owner", "three", { value: 3 }).transferId).not.toBe(third.transferId);
});

it("fails bounded oversized content and closed/released contexts before retaining a result", () => {
  const { pool } = fixture({ maxSnapshotBytes: 32 });
  const lease = pool.begin("owner", "session");
  expect(() => pool.encode(lease, "x".repeat(100), 1)).toThrow("budget");
  pool.release(lease);
  expect(() => pool.encode(lease, { small: true }, 100)).toThrow("context changed");
  pool.close();
  expect(() => pool.begin("owner", "session")).toThrow("unavailable");
});

it("protects real HTTP chunk reads against Origin, scope replacement, expiry and revoke races", async () => {
  const { pool, retain } = fixture();
  const descriptor = retain("owner", "session", { text: "private-data".repeat(20) });
  const token = "A".repeat(43);
  let authCalls = 0;
  let revokeAt = Infinity;
  const handler = createHostBulkHandler({
    transfers: pool,
    authenticate: async (value) => {
      authCalls++;
      return value === token && authCalls < revokeAt ? "owner" : null;
    },
  });
  const server = createServer((request, response) => {
    void handler(request, response).then((handled) => {
      if (!handled) response.writeHead(404).end();
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ws-bulk/${descriptor.transferId}?offset=0`;
  const headers = { Authorization: `Bearer ${token}` };
  expect((await fetch(url)).status).toBe(401);
  expect(
    (await fetch(url, { headers: { ...headers, Origin: "https://other.invalid" } })).status,
  ).toBe(403);
  expect((await fetch(`${url}&offset=1`, { headers })).status).toBe(400);
  const good = await fetch(url, { headers });
  expect(good.status).toBe(200);
  expect(good.headers.get("cache-control")).toBe("no-store");
  expect((await good.arrayBuffer()).byteLength).toBe(descriptor.chunkBytes);
  revokeAt = authCalls + 2;
  expect((await fetch(url, { headers })).status).toBe(401);
  revokeAt = Infinity;
  pool.invalidate("session");
  expect((await fetch(url, { headers })).status).toBe(404);
});
