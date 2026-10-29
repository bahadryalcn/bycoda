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

it("keeps guarded copies distinct across original authorities and blocks expiry during an awaited authorization", async () => {
  const { pool } = fixture();
  let live = true;
  const original = async () => live;
  const retain = (check: () => Promise<boolean>) => {
    const lease = pool.begin("owner", "preview");
    pool.retainAuthority(lease, check);
    try {
      return BulkDescriptorSchema.parse(
        (pool.encode(lease, { frame: "private".repeat(100) }, 1) as any).$bulk,
      );
    } finally {
      pool.release(lease);
    }
  };
  const first = retain(original);
  expect(retain(original)).toEqual(first);
  const second = retain(async () => true);
  expect(second.transferId).not.toBe(first.transferId);
  expect(() => pool.chunk("owner", first.transferId, 0)).toThrow("retained authority");
  const writes: Buffer[] = [];
  await pool.writeAuthorizedChunk(
    "owner",
    first.transferId,
    0,
    async () => true,
    (chunk) => writes.push(chunk),
  );
  expect(writes).toHaveLength(1);
  await expect(
    pool.writeAuthorizedChunk(
      "owner",
      first.transferId,
      0,
      async () => {
        await Promise.resolve();
        live = false;
        return true;
      },
      (chunk) => writes.push(chunk),
    ),
  ).rejects.toThrow("unavailable");
  expect(writes).toHaveLength(1);
  await pool.writeAuthorizedChunk(
    "owner",
    second.transferId,
    0,
    async () => true,
    (chunk) => writes.push(chunk),
  );
  expect(writes).toHaveLength(2);
});
it("checks deletion again after an original result guard awaits and before writing retained bytes", async () => {
  const { pool } = fixture(),
    lease = pool.begin("owner", "preview");
  pool.retainAuthority(lease, async () => {
    await Promise.resolve();
    pool.invalidate("preview");
    return true;
  });
  const descriptor = BulkDescriptorSchema.parse(
    (pool.encode(lease, { frame: "private".repeat(100) }, 1) as any).$bulk,
  );
  pool.release(lease);
  let written = false;
  await expect(
    pool.writeAuthorizedChunk(
      "owner",
      descriptor.transferId,
      0,
      async () => true,
      () => {
        written = true;
      },
    ),
  ).rejects.toThrow("unavailable");
  expect(written).toBe(false);
});

it("rechecks the actual fetch principal after original authority awaits and the original deadline after fetch authorization awaits", async () => {
  const { pool } = fixture(),
    lease = pool.begin("owner", "preview");
  let principal = true,
    original = true,
    phase = "principal";
  pool.retainAuthority(lease, async () => {
    await Promise.resolve();
    if (phase === "principal") principal = false;
    return original;
  });
  const descriptor = BulkDescriptorSchema.parse(
    (pool.encode(lease, { frame: "private".repeat(100) }, 1) as any).$bulk,
  );
  pool.release(lease);
  let writes = 0;
  await expect(
    pool.writeAuthorizedChunk(
      "owner",
      descriptor.transferId,
      0,
      async () => principal,
      () => {
        writes++;
      },
    ),
  ).rejects.toThrow("unavailable");
  phase = "expiry";
  principal = true;
  let calls = 0;
  await expect(
    pool.writeAuthorizedChunk(
      "owner",
      descriptor.transferId,
      0,
      async () => {
        calls++;
        await Promise.resolve();
        if (calls === 2) original = false;
        return principal;
      },
      () => {
        writes++;
      },
    ),
  ).rejects.toThrow("unavailable");
  expect(writes).toBe(0);
});

it.each(["guard", "body"])(
  "retains evicted snapshot byte and job charges through awaited %s settlement",
  async (phase) => {
    const { pool, retain } = fixture({
      maxBytes: 80,
      maxSnapshotBytes: 80,
      maxTransfers: 1,
      maxLeases: 1,
    });
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>((done) => {
        release = done;
      }),
      started = new Promise<void>((done) => {
        entered = done;
      });
    const lease = pool.begin("owner", "first");
    pool.retainAuthority(lease, async () => {
      if (phase === "guard") {
        entered();
        await held;
      }
      return true;
    });
    const descriptor = BulkDescriptorSchema.parse(
      (pool.encode(lease, { text: "x".repeat(50) }, 1) as any).$bulk,
    );
    pool.release(lease);
    const pending = pool.writeAuthorizedChunk(
      "owner",
      descriptor.transferId,
      0,
      async () => true,
      async () => {
        if (phase === "body") {
          entered();
          await held;
        }
      },
    );
    await started;
    await expect(
      pool.writeAuthorizedChunk(
        "owner",
        descriptor.transferId,
        0,
        async () => true,
        () => {},
      ),
    ).rejects.toThrow("admission is busy");
    pool.invalidate("first");
    expect(() => retain("owner", "next", { text: "y".repeat(50) })).toThrow("capacity is busy");
    release();
    if (phase === "guard") await expect(pending).rejects.toThrow("unavailable");
    else await pending; // Already admitted body settles; revocation cannot unsend it.
    expect(retain("owner", "next", { text: "y".repeat(50) }).totalBytes).toBeGreaterThan(50);
  },
);
