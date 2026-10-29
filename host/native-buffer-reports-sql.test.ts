import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "./store";
import { createNativeBufferReports, type NativeBufferSnapshot } from "./native-buffer-reports";
import { createNativeBufferPersistenceStore } from "./native-buffer-persistence-store";
import { createNativeBufferRetention } from "./native-buffer-retention";
import { durableWrite } from "./turn-git-history";
import type { ManagedWorkspace } from "./workspace-contracts";
import type {
  NativeBufferDeliveryBinding,
  NativeBufferDeliveryProof,
} from "./domains/native-delivery/ports";

const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const hash = (value: unknown) => sha(JSON.stringify(value));
const MAX = 64 * 1024 * 1024;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});

async function fixture(sql = true) {
  const base = resolve("temp/verification/2026-10-29-buffer-sql-integration/fixtures");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "reports-")),
    path = join(root, "workspace");
  await mkdir(path);
  const workspace: ManagedWorkspace = {
    id: "workspace",
    repositoryId: "repository",
    projectId: "project",
    environmentId: "environment",
    owner: { kind: "session", id: "session" },
    path,
    branchRef: "refs/heads/task",
    baseRef: "refs/heads/main",
    baseCommit: "base",
    targetBranchRef: "refs/heads/main",
    state: "idle",
    directoryState: "present",
    revision: 1,
    lastActivityAt: 1,
    pinned: false,
  };
  const dbPath = join(root, "host.db"),
    owner = { ownerId: "sql-fixture-owner", authorizationId: randomUUID() };
  let store = new HostStore(dbPath),
    persistence = createNativeBufferPersistenceStore(store);
  const device = await store.issueDevice("Native buffer SQL integration fixture"),
    principal = hash(owner.ownerId);
  let allowed = true,
    now = 1_000_000,
    nativeVersion = 0,
    tail: Promise<unknown> = Promise.resolve();
  let writeFault: ((path: string) => Promise<void>) | undefined;
  const storeInstance = randomUUID(),
    windowIncarnation = randomUUID(),
    physicalId = `physical:v2:${sha(`${storeInstance}:${windowIncarnation}`)}`;
  const serial = <T>(action: () => Promise<T>): Promise<T> => {
    const result = tail.then(action);
    tail = result.catch(() => {});
    return result;
  };
  const authorize = async () => {
    if (!allowed || !(await store.authenticated(device.token)) || !allowed)
      throw new Error("Fixture paired owner revoked");
  };
  const compose = (backed: boolean) =>
    createNativeBufferReports({
      root,
      serial,
      now: () => now,
      listWorkspaces: async () => [workspace],
      write: async (path, bytes) => {
        await writeFault?.(path);
        await durableWrite(path, bytes);
      },
      authenticate: async (capability) => {
        if (
          capability.ownerId !== owner.ownerId ||
          capability.authorizationId !== owner.authorizationId
        )
          throw new Error("Fixture owner changed");
        await authorize();
        return principal;
      },
      ...(backed ? { persistence } : {}),
    });
  let service = compose(sql);
  const id = hash([principal, "client", "instance"]),
    currentKey = `native-activity/buffers/${id}.json`;
  const currentPath = join(root, "native-activity", "buffers", `${id}.json`),
    history = join(root, "native-activity", "buffer-history");
  const f = {
    root,
    path,
    owner,
    id,
    currentKey,
    currentPath,
    history,
    authorize,
    get store() {
      return store;
    },
    get persistence() {
      return persistence;
    },
    get service() {
      return service;
    },
    report(dirty = false, physical = true): NativeBufferSnapshot {
      const buffers = [{ path: join(path, "source.ts"), dirty }];
      return {
        clientId: "client",
        instanceId: "instance",
        processId: process.pid,
        owners: [
          {
            ownerId: physical ? physicalId : "legacy-main",
            updatedAt: now,
            unknown: false,
            buffers,
            ...(physical
              ? {
                  source: {
                    version: 2 as const,
                    sourceStoreId: "native-store",
                    sourceProfileId: "native-profile",
                    storeInstance,
                    windowIncarnation,
                    kind: "physical" as const,
                    reportVersion: ++nativeVersion,
                    reportNonce: randomUUID(),
                    snapshotDigest: sha(JSON.stringify(buffers)),
                  },
                }
              : {}),
          },
        ],
      };
    },
    binding(input: NativeBufferSnapshot): NativeBufferDeliveryBinding {
      const raw = JSON.stringify(input);
      return {
        originalId: randomUUID(),
        sha256: sha(raw),
        byteLength: Buffer.byteLength(raw),
        principalId: principal,
        environmentId: "environment",
      };
    },
    async delivery(input = f.report()) {
      const binding = f.binding(input);
      let proof: NativeBufferDeliveryProof | undefined;
      const result = await service.updateBuffers(input, owner, {
        binding,
        prepared: async (value) => {
          proof = structuredClone(value);
        },
      });
      expect(result).toEqual({ acknowledged: true });
      expect(proof).toBeDefined();
      return { binding, proof: proof! };
    },
    async currentRaw() {
      return sql ? persistence.read(currentKey, MAX) : readFile(currentPath);
    },
    advance() {
      now += 1;
    },
    allow(value: boolean) {
      allowed = value;
    },
    setWriteFault(fault?: typeof writeFault) {
      writeFault = fault;
    },
    async startSql() {
      await service.closeRecoveryCatalog();
      sql = true;
      service = compose(true);
      await service.initializeRetention();
    },
    async eraseCacheAndReopen() {
      await service.closeRecoveryCatalog();
      await store.close();
      const cache = resolve(root, "native-activity");
      if (!cache.startsWith(resolve(root) + sep)) throw new Error("Unsafe fixture cache cleanup");
      await rm(cache, { recursive: true, force: true, maxRetries: 5 });
      store = new HostStore(dbPath);
      await authorize();
      persistence = createNativeBufferPersistenceStore(store);
      sql = true;
      service = compose(true);
      await service.initializeRetention();
    },
    async close() {
      await service.closeRecoveryCatalog();
      await store.close();
      if (!resolve(root).startsWith(base + sep)) throw new Error("Unsafe fixture cleanup");
      await rm(root, { recursive: true, force: true, maxRetries: 5 });
    },
  };
  cleanups.push(f.close);
  return f;
}
const ref = (proof: NativeBufferDeliveryProof) => ({
  reportId: proof.reportId,
  reportVersion: proof.reportVersion,
  snapshotDigest: proof.snapshotDigest,
});

it("retains exact new SQL delivery/history through all native-activity deletion and never revives freshness", async () => {
  const f = await fixture();
  await f.service.initializeRetention();
  const first = await f.delivery(),
    raw = (await f.currentRaw())!;
  const source = (await f.service.listRecovery({}, f.owner)).records.find(
    (row) => row.source.snapshotDigest === first.proof.snapshotDigest,
  )!.source;
  expect(await f.service.probe("workspace")).toEqual([]);
  expect((await f.persistence.readCertificate(ref(first.proof), MAX))?.raw).toEqual(raw);
  await f.eraseCacheAndReopen();
  const before = f.store.db.dataMutationVersion;
  expect(await f.service.verifyDelivery(first, f.owner)).toBe(true);
  expect((await f.service.readRecovery(source, f.owner)).rawReport).toBe(raw.toString("utf8"));
  expect(await f.service.probe("workspace")).toHaveLength(1);
  expect(
    await f.service.verifyDelivery(
      { ...first, binding: { ...first.binding, principalId: "f".repeat(64) } },
      f.owner,
    ),
  ).toBe(false);
  expect(f.store.db.dataMutationVersion).toBe(before);
  f.advance();
  const second = await f.delivery();
  expect(second.proof.reportVersion).toBe(first.proof.reportVersion + 1);
  expect((await f.persistence.readClock(f.id))?.highWater).toBe(second.proof.reportVersion);
  expect(await f.service.probe("workspace")).toEqual([]);
  expect(await f.service.verifyDelivery(first, f.owner)).toBe(true);
  expect((await f.service.readRecovery(source, f.owner)).rawReport).toBe(raw.toString("utf8"));
});

it.each(["rollback", "commit"] as const)(
  "publishes no current/certificate on completion %s failure and never reuses its reserved gap",
  async (mode) => {
    const f = await fixture();
    await f.service.initializeRetention();
    const actual = f.persistence.complete.bind(f.persistence),
      marker = `Injected completion ${mode}`;
    const completion = vi.spyOn(f.persistence, "complete").mockImplementation(async (batch) => {
      if (!batch.certificates.length) return actual(batch);
      if (mode === "rollback") {
        await f.store.db.exec(
          "CREATE TRIGGER reject_buffer_completion BEFORE INSERT ON native_buffer_certificates BEGIN SELECT RAISE(ABORT,'Injected completion rollback'); END",
        );
        try {
          return await actual(batch);
        } finally {
          await f.store.db.exec("DROP TRIGGER reject_buffer_completion");
        }
      }
      const exec = f.store.db.exec.bind(f.store.db);
      const fault = vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
        if (sql === "COMMIT") throw new Error(marker);
        return exec(sql);
      });
      try {
        return await actual(batch);
      } finally {
        fault.mockRestore();
      }
    });
    const input = f.report(),
      binding = f.binding(input);
    let proof: NativeBufferDeliveryProof | undefined;
    await expect(
      f.service.updateBuffers(input, f.owner, {
        binding,
        prepared: async (value) => {
          proof = value;
        },
      }),
    ).rejects.toThrow(marker);
    completion.mockRestore();
    expect(proof).toBeDefined();
    expect(await f.persistence.read(f.currentKey, MAX)).toBeNull();
    expect(await f.persistence.readCertificate(ref(proof!), MAX)).toBeNull();
    expect(await f.service.verifyDelivery({ binding, proof: proof! }, f.owner)).toBe(false);
    expect((await f.persistence.readClock(f.id))?.highWater).toBe(proof!.reportVersion);
    const following = await f.delivery();
    expect(following.proof.reportVersion).toBe(proof!.reportVersion + 1);
    expect(await f.service.verifyDelivery(following, f.owner)).toBe(true);
  },
);

it("rejects owner loss during actual completion without SQL publication or false ACK", async () => {
  const f = await fixture();
  await f.service.initializeRetention();
  const actual = f.persistence.complete.bind(f.persistence);
  let checks = 0;
  const completion = vi.spyOn(f.persistence, "complete").mockImplementation(async (batch) => {
    if (!batch.certificates.length) return actual(batch);
    return actual({
      ...batch,
      authorize: async () => {
        await batch.authorize();
        if (++checks === 4) f.allow(false);
      },
    });
  });
  const input = f.report(),
    binding = f.binding(input);
  let proof: NativeBufferDeliveryProof | undefined;
  await expect(
    f.service.updateBuffers(input, f.owner, {
      binding,
      prepared: async (value) => {
        proof = value;
      },
    }),
  ).rejects.toThrow(/revoked/);
  completion.mockRestore();
  f.allow(true);
  expect(checks).toBeGreaterThanOrEqual(4);
  expect(proof).toBeDefined();
  expect(await f.persistence.read(f.currentKey, MAX)).toBeNull();
  expect(await f.persistence.readCertificate(ref(proof!), MAX)).toBeNull();
  expect(await f.service.verifyDelivery({ binding, proof: proof! }, f.owner)).toBe(false);
  expect((await f.delivery()).proof.reportVersion).toBe(proof!.reportVersion + 1);
});

it("keeps a committed exact proof after lost completion ACK while retaining unknown freshness", async () => {
  const f = await fixture();
  await f.service.initializeRetention();
  const actual = f.persistence.complete.bind(f.persistence);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const completion = vi.spyOn(f.persistence, "complete").mockImplementation(async (batch) => {
    if (!batch.certificates.length) return actual(batch);
    const exec = f.store.db.exec.bind(f.store.db);
    const fault = vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
      await exec(sql);
      if (sql === "COMMIT") throw new Error("Committed completion ACK lost");
    });
    try {
      return await actual(batch);
    } finally {
      fault.mockRestore();
    }
  });
  const input = f.report(),
    binding = f.binding(input);
  let proof: NativeBufferDeliveryProof | undefined;
  await expect(
    f.service.updateBuffers(input, f.owner, {
      binding,
      prepared: async (value) => {
        proof = value;
      },
    }),
  ).rejects.toThrow("ACK lost");
  completion.mockRestore();
  expect((await f.persistence.readCertificate(ref(proof!), MAX))?.snapshotDigest).toBe(
    proof!.snapshotDigest,
  );
  expect(await f.service.verifyDelivery({ binding, proof: proof! }, f.owner)).toBe(true);
  expect(await f.service.probe("workspace")).toHaveLength(1);
  await f.eraseCacheAndReopen();
  expect(await f.service.verifyDelivery({ binding, proof: proof! }, f.owner)).toBe(true);
  expect(await f.service.probe("workspace")).toHaveLength(1);
});

it("imports legacy clocks, two complete history bodies and holds before adopting the SQL floor", async () => {
  const f = await fixture(false),
    originals: Array<{
      binding: NativeBufferDeliveryBinding;
      proof: NativeBufferDeliveryProof;
      raw: Buffer;
    }> = [];
  for (const dirty of [true, false, true]) {
    const delivery = await f.delivery(f.report(dirty, false));
    originals.push({ ...delivery, raw: await readFile(f.currentPath) });
    f.advance();
  }
  const sources = (await f.service.listRecovery({}, f.owner)).records
    .filter((row) =>
      originals.some((original) => original.proof.snapshotDigest === row.source.snapshotDigest),
    )
    .map((row) => row.source);
  expect(sources).toHaveLength(3);
  const legacyDirectory = join(f.root, "native-activity", "buffers");
  const activeAndHolds = await Promise.all(
    (await readdir(legacyDirectory))
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => ({
        key: `native-activity/buffers/${name}`,
        raw: await readFile(join(legacyDirectory, name)),
      })),
  );
  expect(activeAndHolds.length).toBeGreaterThan(1);
  const actualComplete = f.persistence.complete.bind(f.persistence);
  let floorPublished = false;
  const migration = vi.spyOn(f.persistence, "complete").mockImplementation(async (batch) => {
    if (batch.initializeClocks?.some((state) => state.reportId === f.id)) {
      expect(await f.persistence.readClock(f.id)).toBeNull();
      for (const retained of activeAndHolds) {
        expect(await f.persistence.read(retained.key, MAX)).toEqual(retained.raw);
      }
      for (const old of originals.slice(0, -1)) {
        const key = `native-activity/buffer-history/reports/${f.id}/${old.proof.reportVersion.toString().padStart(16, "0")}-${old.proof.snapshotDigest}.json`;
        expect(await f.persistence.read(key, MAX)).not.toBeNull();
      }
      floorPublished = true;
    }
    return actualComplete(batch);
  });
  await f.startSql();
  migration.mockRestore();
  expect(floorPublished).toBe(true);
  const adopted = await f.persistence.readClock(f.id);
  expect(adopted?.highWater).toBe(originals.at(-1)!.proof.reportVersion);
  expect(
    (await f.service.listRecovery({}, f.owner)).records.some((row) => row.retention === "held"),
  ).toBe(true);
  await f.eraseCacheAndReopen();
  expect(await f.persistence.readClock(f.id)).toEqual(adopted);
  const before = f.store.db.dataMutationVersion;
  for (const original of originals) {
    expect(await f.service.verifyDelivery(original, f.owner)).toBe(true);
    const source = sources.find((value) => value.snapshotDigest === original.proof.snapshotDigest)!;
    expect((await f.service.readRecovery(source, f.owner)).rawReport).toBe(
      original.raw.toString("utf8"),
    );
  }
  expect(await f.service.probe("workspace")).toHaveLength(1);
  expect(f.store.db.dataMutationVersion).toBe(before);
  const next = await f.delivery(f.report(false, false));
  expect(next.proof.reportVersion).toBe(adopted!.highWater + 1);
});

it("adopts exact legacy BOM/whitespace bytes without reserving another report version", async () => {
  const f = await fixture(false),
    first = await f.delivery();
  const raw = Buffer.from(`\ufeff \r\n${await readFile(f.currentPath, "utf8")}\t`);
  await writeFile(f.currentPath, raw);
  const source = (await f.service.listRecovery({}, f.owner)).records.find(
    (row) => row.source.snapshotDigest === sha(raw),
  )!.source;
  await f.startSql();
  expect((await f.persistence.readClock(f.id))?.highWater).toBe(first.proof.reportVersion);
  expect(
    (await f.persistence.readCertificate({ ...ref(first.proof), snapshotDigest: sha(raw) }, MAX))
      ?.raw,
  ).toEqual(raw);
  await f.eraseCacheAndReopen();
  expect((await f.service.readRecovery(source, f.owner)).rawReport).toBe(raw.toString("utf8"));
  expect((await f.delivery()).proof.reportVersion).toBe(first.proof.reportVersion + 1);
});

it("keeps missing legacy body metadata discoverable but uncertified after SQL import and cache deletion", async () => {
  const f = await fixture(false),
    first = await f.delivery(f.report(true, false));
  const source = (await f.service.listRecovery({}, f.owner)).records.find(
    (row) => row.source.snapshotDigest === first.proof.snapshotDigest,
  )!.source;
  await f.delivery(f.report(false, false));
  const manifestPath = join(
    f.history,
    "reports",
    f.id,
    `${source.reportVersion.toString().padStart(16, "0")}-${source.snapshotDigest}.json`,
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const descriptor =
    manifest.version === 2
      ? JSON.parse(
          await readFile(
            join(f.history, "templates", `${manifest.body.templateDigest}.json`),
            "utf8",
          ),
        )
      : manifest;
  await rm(join(f.history, "chunks", `${descriptor.chunks[0].digest}.bin`));
  expect(
    (await f.service.listRecovery({}, f.owner)).records.find(
      (row) => row.source.snapshotDigest === first.proof.snapshotDigest,
    ),
  ).toMatchObject({
    verification: "metadata-only",
    qualified: false,
    retention: "held",
  });
  await f.startSql();
  expect(await f.persistence.readCertificate(ref(first.proof), MAX)).toBeNull();
  await f.eraseCacheAndReopen();
  expect(
    (await f.service.listRecovery({}, f.owner)).records.find(
      (row) => row.source.snapshotDigest === first.proof.snapshotDigest,
    ),
  ).toMatchObject({
    verification: "metadata-only",
    qualified: false,
    retention: "held",
  });
  await expect(f.service.readRecovery(source, f.owner)).rejects.toThrow(/chunk|template|retained/i);
  const outcome = await f.service.verifyDelivery(first, f.owner).catch((error: unknown) => {
    expect(String(error)).toMatch(/chunk|template|retained/i);
    return false;
  });
  expect(outcome).toBe(false);
  expect(await f.service.probe("workspace")).toHaveLength(1);
});

it.each([false, true])(
  "retains valid legacy current bytes despite broken matching archive, with corruptHeader=%s remaining held",
  async (corruptHeader) => {
    const f = await fixture(false),
      first = await f.delivery(),
      raw = await readFile(f.currentPath);
    const source = (await f.service.listRecovery({}, f.owner)).records.find(
      (row) => row.source.snapshotDigest === first.proof.snapshotDigest,
    )!.source;
    f.setWriteFault(async (path) => {
      if (path === f.currentPath)
        throw new Error("Current replacement failed after previous archive");
    });
    await expect(f.service.updateBuffers(f.report(), f.owner)).rejects.toThrow(
      "Current replacement failed",
    );
    f.setWriteFault();
    expect(await readFile(f.currentPath)).toEqual(raw);
    const manifestPath = join(
      f.history,
      "reports",
      f.id,
      `${source.reportVersion.toString().padStart(16, "0")}-${source.snapshotDigest}.json`,
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const descriptor =
      manifest.version === 2
        ? JSON.parse(
            await readFile(
              join(f.history, "templates", `${manifest.body.templateDigest}.json`),
              "utf8",
            ),
          )
        : manifest;
    await rm(join(f.history, "chunks", `${descriptor.chunks[0].digest}.bin`));
    if (corruptHeader) {
      manifest.snapshotDigest = "e".repeat(64);
      await writeFile(manifestPath, JSON.stringify(manifest));
      await expect(f.startSql()).rejects.toThrow(/metadata|identity|changed|corrupt|held/i);
      expect(await f.persistence.readClock(f.id)).toBeNull();
      expect(await f.persistence.readCertificate(ref(first.proof), MAX)).toBeNull();
      expect(await f.service.verifyDelivery(first, f.owner)).toBe(false);
      return;
    }
    await f.startSql();
    expect((await f.persistence.readClock(f.id))?.highWater).toBe(first.proof.reportVersion + 1);
    expect(await f.persistence.read(f.currentKey, MAX)).toEqual(raw);
    expect((await f.persistence.readCertificate(ref(first.proof), MAX))?.raw).toEqual(raw);
    await f.eraseCacheAndReopen();
    expect(await f.service.verifyDelivery(first, f.owner)).toBe(true);
    expect((await f.service.readRecovery(source, f.owner)).rawReport).toBe(raw.toString("utf8"));
    expect(await f.service.probe("workspace")).toHaveLength(1);
    expect((await f.delivery()).proof.reportVersion).toBe(first.proof.reportVersion + 2);
  },
);

it("never records a matching filesystem-only planned proof or mutates SQL during status reads", async () => {
  const f = await fixture(false),
    first = await f.delivery();
  await f.service.closeRecoveryCatalog();
  const sqlService = createNativeBufferReports({
    root: f.root,
    serial: async (action) => action(),
    listWorkspaces: async () => [],
    persistence: f.persistence,
    authenticate: async () => {
      await f.authorize();
      return hash(f.owner.ownerId);
    },
  });
  const before = f.store.db.dataMutationVersion;
  expect(await sqlService.verifyDelivery(first, f.owner)).toBe(false);
  expect(await f.persistence.readClock(f.id)).toBeNull();
  expect(await f.persistence.readCertificate(ref(first.proof), MAX)).toBeNull();
  expect(f.store.db.dataMutationVersion).toBe(before);
  expect(
    await f.store.db
      .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'native_buffer_%'")
      .all(),
  ).toEqual([]);
  await sqlService.closeRecoveryCatalog();
});

it("never reads an adopted history manifest from the old filesystem when its SQL artifact is missing", async () => {
  const f = await fixture(false),
    first = await f.delivery(f.report(true));
  const source = (await f.service.listRecovery({}, f.owner)).records.find(
    (row) => row.source.snapshotDigest === first.proof.snapshotDigest,
  )!.source;
  await f.delivery();
  const manifest = `native-activity/buffer-history/reports/${f.id}/${source.reportVersion.toString().padStart(16, "0")}-${source.snapshotDigest}.json`;
  const fsCopy = await readFile(join(f.root, manifest));
  await f.startSql();
  expect(await f.service.verifyDelivery(first, f.owner)).toBe(true);
  await f.store.db.prepare("DELETE FROM native_buffer_artifacts WHERE key=?").run(manifest);
  await f.startSql();
  expect(await readFile(join(f.root, manifest))).toEqual(fsCopy);
  const before = f.store.db.dataMutationVersion;
  const page = await f.service.listRecovery({}, f.owner).catch((error: unknown) => {
    expect(String(error)).toMatch(/retained|corrupt|missing|changed|held/i);
    return null;
  });
  expect(
    page?.records.find((row) => row.source.snapshotDigest === first.proof.snapshotDigest)
      ?.verification,
  ).not.toBe("raw-checked");
  await expect(f.service.readRecovery(source, f.owner)).rejects.toThrow(
    /retained|corrupt|missing|changed|held|source/i,
  );
  const proof = await f.service.verifyDelivery(first, f.owner).catch((error: unknown) => {
    expect(String(error)).toMatch(/retained|corrupt|missing|changed|held/i);
    return false;
  });
  expect(proof).toBe(false);
  expect(f.store.db.dataMutationVersion).toBe(before);
});

it("keeps staging async contexts separate and never imports ordinary read bytes into SQL", async () => {
  const f = await fixture();
  await f.service.initializeRetention();
  const retention = createNativeBufferRetention({
    root: f.root,
    persistence: f.persistence,
  });
  const a = `native-activity/buffers/${"a".repeat(64)}.json`,
    b = `native-activity/buffers/${"b".repeat(64)}.json`;
  await mkdir(join(f.root, "native-activity", "buffers"), { recursive: true });
  const raw = Buffer.from("read-only legacy bytes");
  await writeFile(join(f.root, a), raw);
  const before = f.store.db.dataMutationVersion;
  expect(await retention.read(join(f.root, a), 1024, () => readFile(join(f.root, a)))).toEqual(raw);
  expect(await f.persistence.read(a, 1024)).toBeNull();
  expect(f.store.db.dataMutationVersion).toBe(before);
  let release!: () => void, staged!: () => void;
  const waiting = new Promise<void>((resolve) => {
      release = resolve;
    }),
    ready = new Promise<void>((resolve) => {
      staged = resolve;
    });
  const batches: string[][] = [],
    actual = f.persistence.complete.bind(f.persistence);
  vi.spyOn(f.persistence, "complete").mockImplementation(async (batch) => {
    batches.push(batch.writes.map((write) => write.key));
    return actual(batch);
  });
  const first = retention.mutate(f.authorize, async () => {
    await retention.write(join(f.root, a), "stage A");
    staged();
    await waiting;
  });
  await ready;
  await retention.mutate(f.authorize, async () => {
    await retention.write(join(f.root, b), "stage B");
  });
  expect(await f.persistence.read(a, 1024)).toBeNull();
  expect((await f.persistence.read(b, 1024))?.toString()).toBe("stage B");
  release();
  await first;
  expect(batches).toEqual([[b], [a]]);
  expect((await f.persistence.read(a, 1024))?.toString()).toBe("stage A");
  expect(() => retention.write(join(f.root, a), "escaped stage")).toThrow(/held/);
});
