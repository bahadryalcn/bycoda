import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createNativeBufferReports, type NativeBufferSnapshot } from "./native-buffer-reports";
import { durableWrite } from "../git/turn-git-history";
import type { ManagedWorkspace } from "../workspaces/workspace-contracts";
import { createManagedWorkspaceRuntime } from "../managed/managed-workspace-runtime";
import { HostEngine } from "../engine";
import { HostStore } from "../store";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const owner = { ownerId: "device-one", authorizationId: "trusted" };
const other = { ownerId: "device-two", authorizationId: "trusted" };
const roots: string[] = [];
const catalogClosers: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of catalogClosers.splice(0)) await close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "native-buffer-history-")));
  roots.push(root);
  const path = join(root, "workspace"),
    sibling = join(root, "workspace-other");
  await mkdir(path);
  await mkdir(sibling);
  const workspaces = [path, sibling].map((path, index): ManagedWorkspace => ({
    id: index ? "other" : "workspace",
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
  }));
  const storeInstance = randomUUID(),
    windowIncarnation = randomUUID();
  const physicalId = `physical:v2:${sha(`${storeInstance}:${windowIncarnation}`)}`;
  let clock = 1_000_000,
    version = 0,
    tail: Promise<unknown> = Promise.resolve(),
    allowed = true;
  let onWrite: ((path: string, bytes: string | Buffer) => Promise<void>) | undefined;
  const serial = <T>(action: () => Promise<T>): Promise<T> => {
    const result = tail.then(action);
    tail = result.catch(() => {});
    return result;
  };
  const compose = () => {
    const service = createNativeBufferReports({
      root,
      listWorkspaces: async () => workspaces,
      serial,
      now: () => clock,
      authenticate: async (value) => {
        if (!allowed || value.authorizationId !== "trusted")
          throw new Error("Owner authorization revoked");
        return hash(value.ownerId);
      },
      write: async (path, bytes) => {
        await onWrite?.(path, bytes);
        await durableWrite(path, bytes);
      },
    });
    catalogClosers.push(() => service.closeRecoveryCatalog());
    return service;
  };
  let service = compose();
  const report = (
    dirty = true,
    physical = false,
    file = join(path, "source.txt"),
  ): NativeBufferSnapshot => ({
    clientId: "client",
    instanceId: "instance",
    processId: process.pid,
    owners: [
      {
        ownerId: physical ? physicalId : "main",
        updatedAt: clock,
        unknown: false,
        buffers: [{ path: file, dirty }],
        ...(physical
          ? {
              source: {
                version: 2 as const,
                sourceStoreId: "source-store",
                sourceProfileId: "source-profile",
                storeInstance,
                windowIncarnation,
                kind: "physical" as const,
                reportVersion: ++version,
                reportNonce: randomUUID(),
                snapshotDigest: sha(JSON.stringify([{ path: file, dirty }])),
              },
            }
          : {}),
      },
    ],
  });
  const directory = join(root, "native-activity", "buffers"),
    history = join(root, "native-activity", "buffer-history");
  const id = hash([hash(owner.ownerId), "client", "instance"]),
    currentPath = join(directory, `${id}.json`);
  return {
    root,
    path,
    sibling,
    directory,
    history,
    id,
    currentPath,
    report,
    serial,
    get service() {
      return service;
    },
    restart() {
      service = compose();
    },
    advance(ms = 1) {
      clock += ms;
    },
    setWrite(callback?: typeof onWrite) {
      onWrite = callback;
    },
    revoke() {
      allowed = false;
    },
    allow() {
      allowed = true;
    },
    async current() {
      return JSON.parse(await readFile(currentPath, "utf8"));
    },
    async files() {
      return (await readdir(directory)).filter((name) => name.endsWith(".json"));
    },
  };
}

it("retains a replaced legacy dirty owner in exact history and old-readable held projections", async () => {
  const f = await fixture();
  await f.service.updateBuffers(f.report(), owner);
  const original = await readFile(f.currentPath, "utf8"),
    source = (await f.service.listRecovery({}, owner)).records[0].source;
  f.advance();
  await f.service.updateBuffers(f.report(false), owner);
  expect(await f.service.probe("workspace")).toHaveLength(1);
  expect(await f.service.probe("other")).toHaveLength(0);
  expect(await f.files()).toHaveLength(2);
  const held = (await f.service.listRecovery({}, owner)).records.find(
    (row) => row.source.snapshotDigest === source.snapshotDigest,
  )!;
  expect(held).toMatchObject({
    retention: "held",
    dirtyCount: 1,
    resolution: "unsupported",
    qualified: false,
  });
  expect((await f.service.readRecovery(source, owner)).rawReport).toBe(original);
  expect((await f.current()).owners).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        unknown: true,
        buffers: [{ path: join(f.path, "source.txt"), dirty: true }],
      }),
    ]),
  );
  await expect(
    f.service.retireBuffers(
      { clientId: "client", instanceId: "instance", processId: process.pid },
      owner,
    ),
  ).rejects.toThrow("explicit owner recovery");
});

it("keeps independent held files visible after an old Host writer replaces the current format", async () => {
  const f = await fixture();
  await f.service.updateBuffers(f.report(), owner);
  await f.service.updateBuffers(f.report(false), owner);
  const legacyReplacement = {
    ...f.report(false),
    device: hash(owner.ownerId),
    receivedAt: 1_000_000,
  };
  await durableWrite(f.currentPath, JSON.stringify(legacyReplacement));
  f.restart();
  const oldReadable = await Promise.all(
    (await f.files()).map(async (name) =>
      JSON.parse(await readFile(join(f.directory, name), "utf8")),
    ),
  );
  expect(
    oldReadable.some((report) =>
      report.owners.some((entry: { unknown: boolean }) => entry.unknown),
    ),
  ).toBe(true);
  await f.service.updateBuffers(f.report(false), owner);
  expect(await f.service.probe("workspace")).toHaveLength(1);
});

it("deduplicates semantic legacy holds across heartbeat versions without losing exact snapshots", async () => {
  const f = await fixture();
  for (let index = 0; index < 5; index++) {
    await f.service.updateBuffers(f.report(), owner);
    f.advance();
  }
  expect(await f.files()).toHaveLength(2);
  const listed = await f.service.listRecovery({}, owner);
  expect(listed.records).toHaveLength(5);
  expect(new Set(listed.records.map((row) => row.source.reportVersion)).size).toBe(5);
  for (const row of listed.records)
    expect((await f.service.readRecovery(row.source, owner)).source).toEqual(row.source);
});

it("allows exact same physical lineage to advance its ordinary projection, keeping immutable old bytes", async () => {
  const f = await fixture();
  await f.service.updateBuffers(f.report(true, true), owner);
  const before = (await f.service.listRecovery({}, owner)).records[0].source;
  f.advance();
  await f.service.updateBuffers(f.report(false, true), owner);
  expect(await f.service.probe("workspace")).toHaveLength(0);
  expect(await f.files()).toHaveLength(1);
  expect((await f.service.readRecovery(before, owner)).owner.buffers[0].dirty).toBe(true);
  expect(
    (await f.service.listRecovery({}, owner)).records.find(
      (row) => row.source.snapshotDigest === before.snapshotDigest,
    )?.retention,
  ).toBe("historical");
});

it("does not upgrade pre-existing legacy64hex IDs or legacy physical-looking IDs using new metadata", async () => {
  for (const ownerId of ["a".repeat(64), `physical:v2:${sha(`${randomUUID()}:${randomUUID()}`)}`]) {
    const f = await fixture(),
      legacy = f.report();
    legacy.owners[0].ownerId = ownerId;
    await f.service.updateBuffers(legacy, owner);
    const upgrade = f.report(false, true);
    upgrade.owners[0].ownerId = ownerId;
    await f.service.updateBuffers(upgrade, owner);
    expect(await f.service.probe("workspace")).toHaveLength(1);
    expect(
      (await f.service.listRecovery({}, owner)).records.some((row) => row.retention === "held"),
    ).toBe(true);
  }
});

it("retains a physical-looking legacy row even when its later metadata exactly matches that key", async () => {
  const f = await fixture(),
    next = f.report(false, true),
    legacy = f.report();
  legacy.owners[0].ownerId = next.owners[0].ownerId;
  await f.service.updateBuffers(legacy, owner);
  await f.service.updateBuffers(next, owner);
  expect(await f.service.probe("workspace")).toHaveLength(1);
  expect(await f.files()).toHaveLength(2);
});

it("does not retroactively upgrade source metadata persisted by an older Host", async () => {
  const f = await fixture(),
    legacy = f.report(true, true);
  await mkdir(f.directory, { recursive: true });
  await writeFile(
    f.currentPath,
    JSON.stringify({ ...legacy, device: hash(owner.ownerId), receivedAt: 1_000_000 }),
  );
  await f.service.updateBuffers(f.report(false, true), owner);
  expect(await f.service.probe("workspace")).toHaveLength(1);
  expect((await f.current()).recovery.ownerLineages[legacy.owners[0].ownerId]).toBe("legacy");
});

it("retains missing-owner and stale legacy uncertainty without inventing a recovered window", async () => {
  const f = await fixture();
  await f.service.updateBuffers({ ...f.report(), owners: [] }, owner);
  const missing = (await f.service.listRecovery({}, owner)).records[0];
  expect(missing).toMatchObject({
    ownerMissing: true,
    unknown: true,
    bufferCount: 0,
    lineage: "legacy",
  });
  expect(
    JSON.parse((await f.service.readRecovery(missing.source, owner)).rawReport).owners,
  ).toEqual([]);
  await f.service.updateBuffers(f.report(false, true), owner);
  expect(await f.service.probe("workspace")).toHaveLength(1);
  expect(await f.service.probe("other")).toHaveLength(1);

  const stale = await fixture();
  await stale.service.updateBuffers(stale.report(false), owner);
  stale.restart();
  await stale.service.updateBuffers(stale.report(false), owner);
  expect(await stale.service.probe("workspace")).toHaveLength(1);
});

it("verifies the Native path/dirty codec before canonicalization and preserves both distinct digests", async () => {
  const f = await fixture(),
    alias = join(f.root, "native-alias");
  await symlink(f.path, alias, process.platform === "win32" ? "junction" : "dir");
  const request = f.report(true, true, join(alias, "new-file.txt"));
  const nativeDigest = request.owners[0].source!.snapshotDigest;
  request.owners[0].buffers = request.owners[0].buffers.map(({ path, dirty }) => ({ dirty, path }));
  await f.service.updateBuffers(request, owner);
  const current = await f.current(),
    row = (await f.service.listRecovery({}, owner)).records[0];
  expect(current.owners[0].buffers[0].path).toBe(join(f.path, "new-file.txt"));
  expect(current.owners[0].source.snapshotDigest).toBe(nativeDigest);
  expect(row.source.snapshotDigest).toBe(sha(await readFile(f.currentPath)));
  expect(row.source.snapshotDigest).not.toBe(nativeDigest);
  const forged = f.report(false, true);
  forged.owners[0].source!.snapshotDigest = "0".repeat(64);
  await expect(f.service.updateBuffers(forged, owner)).rejects.toThrow("source digest");
  await rm(alias);
});

it("retains unattributed and retained Native sources rather than treating caller provenance as enrollment", async () => {
  for (const kind of ["unattributed", "retained", "legacy"] as const) {
    const f = await fixture(),
      first = f.report(true, true),
      next = f.report(false, true);
    first.owners[0].source!.kind = kind;
    await f.service.updateBuffers(first, owner);
    await f.service.updateBuffers(next, owner);
    expect(await f.service.probe("workspace")).toHaveLength(1);
    expect((await f.service.listRecovery({}, owner)).qualified).toBe(false);
  }
});

it("rejects stale and same-version changed physical bodies without erasing accepted dirty data", async () => {
  const f = await fixture(),
    first = f.report(true, true);
  await f.service.updateBuffers(first, owner);
  const original = await readFile(f.currentPath, "utf8");
  const reused = structuredClone(first);
  reused.owners[0].buffers[0].dirty = false;
  reused.owners[0].source!.snapshotDigest = sha(JSON.stringify(reused.owners[0].buffers));
  await expect(f.service.updateBuffers(reused, owner)).rejects.toThrow("stale or reused");
  const stale = structuredClone(first);
  stale.owners[0].source!.reportVersion = 0;
  await expect(f.service.updateBuffers(stale, owner)).rejects.toThrow("source");
  expect(await readFile(f.currentPath, "utf8")).toBe(original);
  expect(await f.service.probe("workspace")).toHaveLength(1);
});

it("handles same-version uncertainty changes without claiming a new Native body", async () => {
  const f = await fixture(),
    first = f.report(false, true);
  await f.service.updateBuffers(first, owner);
  const unknown = structuredClone(first);
  unknown.owners[0].unknown = true;
  await f.service.updateBuffers(unknown, owner);
  expect(await f.service.probe("workspace")).toHaveLength(1);
  await f.service.updateBuffers(first, owner);
  expect(await f.service.probe("workspace")).toHaveLength(0);
});

it("omission retains unknown owners and returning legacy clean state cannot erase that uncertainty", async () => {
  const f = await fixture();
  await f.service.updateBuffers(f.report(false), owner);
  await f.service.updateBuffers({ ...f.report(false), owners: [] }, owner);
  expect(await f.service.probe("workspace")).toHaveLength(1);
  await f.service.updateBuffers(f.report(false), owner);
  expect(await f.service.probe("workspace")).toHaveLength(1);
});

it("preserves client, instance and authenticated-device isolation in probes and recovery reads", async () => {
  const f = await fixture();
  await f.service.updateBuffers(f.report(), owner);
  const source = (await f.service.listRecovery({}, owner)).records[0].source;
  await f.service.updateBuffers({ ...f.report(false), clientId: "another-client" }, owner);
  await f.service.updateBuffers(f.report(false), other);
  expect((await f.service.listRecovery({}, other)).records).toHaveLength(1);
  await expect(f.service.readRecovery(source, other)).rejects.toThrow("unavailable or changed");
  expect((await f.service.recoveryStatus(source, other)).found).toBe(false);
  expect(await f.service.probe("workspace")).toHaveLength(1);
});

it("captures queued caller data before admission and rechecks revoked authentication after filesystem waits", async () => {
  const f = await fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = f.serial(() => gate),
    request = f.report(false);
  const authorization = { ...owner },
    pending = f.service.updateBuffers(request, authorization);
  request.owners[0].buffers[0].path = f.sibling;
  release();
  await held;
  await pending;
  expect((await f.current()).owners[0].buffers[0].path).toBe(join(f.path, "source.txt"));
  let unlock!: () => void;
  const beforeMutation = f.serial(
    () =>
      new Promise<void>((resolve) => {
        unlock = resolve;
      }),
  );
  await Promise.resolve();
  const mutated = { ...owner },
    rejected = f.service.updateBuffers(f.report(false), mutated);
  mutated.authorizationId = "mutated";
  unlock();
  await beforeMutation;
  await expect(rejected).rejects.toThrow("authorization changed");
  let revoked = false;
  f.setWrite(async (path) => {
    if (!revoked && path.startsWith(f.history)) {
      revoked = true;
      f.revoke();
    }
  });
  await expect(f.service.updateBuffers(f.report(true), owner)).rejects.toThrow("revoked");
  f.allow();
  expect((await f.current()).owners[0].buffers[0].dirty).toBe(false);
});

it("does not erase the original when archive, held projection or current commit fails", async () => {
  for (const stage of ["archive", "hold", "current"] as const) {
    const f = await fixture();
    await f.service.updateBuffers(f.report(), owner);
    const original = await readFile(f.currentPath, "utf8");
    f.setWrite(async (path, bytes) => {
      if (
        (stage === "archive" &&
          (path.startsWith(join(f.history, "chunks")) ||
            path.startsWith(join(f.history, "reports")))) ||
        (stage === "hold" && !path.startsWith(f.history) && path !== f.currentPath) ||
        (stage === "current" &&
          path === f.currentPath &&
          JSON.parse(bytes.toString()).recovery?.kind === "projection")
      )
        throw Object.assign(new Error(`injected ${stage} failure`), { code: "ENOSPC" });
    });
    await expect(f.service.updateBuffers(f.report(false), owner)).rejects.toThrow(
      `injected ${stage}`,
    );
    expect(await readFile(f.currentPath, "utf8")).toBe(original);
    expect(await f.service.probe("workspace")).toHaveLength(1);
    f.setWrite();
    await f.service.updateBuffers(f.report(false), owner);
    expect(await f.service.probe("workspace")).toHaveLength(1);
  }
});

it("keeps an uncertain committed update and retries exact physical source without manufacturing a new operation", async () => {
  const f = await fixture();
  const request = f.report(false, true);
  f.setWrite(async (path) => {
    if (path === f.currentPath) queueMicrotask(() => f.revoke());
  });
  await expect(f.service.updateBuffers(request, owner)).rejects.toThrow("revoked");
  expect((await f.current()).owners[0].source.reportVersion).toBe(
    request.owners[0].source!.reportVersion,
  );
  f.allow();
  f.setWrite();
  await expect(f.service.updateBuffers(request, owner)).resolves.toEqual({ acknowledged: true });
  expect(await f.service.probe("workspace")).toHaveLength(0);
});

it("uses exact source version/hash/owner matching and rejects stale source and cursor shapes", async () => {
  const f = await fixture();
  await f.service.updateBuffers(f.report(false, true), owner);
  const source = (await f.service.listRecovery({}, owner)).records[0].source;
  for (const changed of [
    { ...source, ownerVersion: source.ownerVersion + 1 },
    { ...source, snapshotDigest: "f".repeat(64) },
    { ...source, ownerId: "other" },
  ]) {
    expect((await f.service.recoveryStatus(changed, owner)).found).toBe(false);
    await expect(f.service.readRecovery(changed, owner)).rejects.toThrow("unavailable or changed");
  }
  await expect(f.service.listRecovery({ limit: 101 }, owner)).rejects.toThrow("page");
  expect(() => f.service.readRecovery({ ...source, reportId: "../escape" }, owner)).toThrow(
    "source",
  );
});

it("paginates immutable ABA versions while retaining older exact bytes after restart", async () => {
  const f = await fixture();
  await f.service.updateBuffers(f.report(true, true), owner);
  const first = (await f.service.listRecovery({}, owner)).records[0].source;
  await f.service.updateBuffers(f.report(false, true), owner);
  await f.service.updateBuffers(f.report(true, true), owner);
  f.restart();
  const records = [];
  let after = null;
  do {
    const page = await f.service.listRecovery({ limit: 1, after }, owner);
    records.push(...page.records);
    after = page.next;
  } while (after);
  expect(records).toHaveLength(3);
  expect(new Set(records.map((row) => row.source.snapshotDigest)).size).toBe(3);
  expect((await f.service.readRecovery(first, owner)).owner.buffers[0].dirty).toBe(true);
  expect(await f.service.probe("workspace")).toHaveLength(1);
});

it("deduplicates unchanged large heartbeat body chunks while retaining every exact version", async () => {
  const f = await fixture();
  const many = () => {
    const value = f.report(false, true);
    value.owners[0].buffers = Array.from({ length: 1200 }, (_, i) => ({
      path: join(f.path, `file-${i.toString().padStart(5, "0")}-${"x".repeat(60)}.txt`),
      dirty: false,
    }));
    value.owners[0].source!.snapshotDigest = sha(JSON.stringify(value.owners[0].buffers));
    return value;
  };
  await f.service.updateBuffers(many(), owner);
  f.advance();
  await f.service.updateBuffers(many(), owner);
  const initial = (await readdir(join(f.history, "chunks"))).length;
  f.advance();
  await f.service.updateBuffers(many(), owner);
  expect((await readdir(join(f.history, "chunks"))).length).toBeLessThan(initial * 1.3);
  expect((await f.service.listRecovery({}, owner)).records).toHaveLength(3);
});

it("preserves oversized source visibility with bounded disclosure and fails closed on corrupt guard files", async () => {
  const f = await fixture(),
    value = f.report();
  value.owners[0].buffers = Array.from({ length: 6000 }, () => ({
    path: join(f.path, `${"x".repeat(200)}.txt`),
    dirty: true,
  }));
  await mkdir(f.directory, { recursive: true });
  await writeFile(
    f.currentPath,
    JSON.stringify({ ...value, device: hash(owner.ownerId), receivedAt: 1_000_000 }),
  );
  const row = (await f.service.listRecovery({}, owner)).records[0];
  expect(row.inspectable).toBe(false);
  await expect(f.service.readRecovery(row.source, owner)).rejects.toThrow("disclosure limit");
  expect((await f.service.recoveryStatus(row.source, owner)).found).toBe(true);
  expect(await f.service.probe("workspace")).toHaveLength(1);
  await writeFile(f.currentPath, "{corrupt");
  await expect(f.service.probe("workspace")).rejects.toThrow("corrupt");
  await expect(f.service.updateBuffers(f.report(false), owner)).rejects.toThrow("corrupt");
  expect(await readFile(f.currentPath, "utf8")).toBe("{corrupt");
});

it("retains canonical alias paths and avoids similarly prefixed sibling workspace holds", async () => {
  const f = await fixture(),
    alias = join(f.root, "alias");
  await symlink(f.path, alias, process.platform === "win32" ? "junction" : "dir");
  const input = f.report(true, false, join(alias, "not-created.txt"));
  await f.service.updateBuffers(input, owner);
  expect(input.owners[0].buffers[0].path).toBe(join(alias, "not-created.txt"));
  expect((await f.current()).owners[0].buffers[0].path).toBe(join(f.path, "not-created.txt"));
  expect(await f.service.probe("workspace")).toHaveLength(1);
  expect(await f.service.probe("other")).toHaveLength(0);
  await rm(alias);
});

it("retains clean known retirement compatibility and requires actual ESRCH for predecessor reconciliation", async () => {
  const f = await fixture();
  const old = { ...f.report(false, true), instanceId: "prior", processId: 99999 };
  await f.service.updateBuffers(old, owner);
  await f.service.updateBuffers(f.report(false, true), owner);
  vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("uncertain"), { code: "EPERM" });
  });
  await expect(
    f.service.reconcileBuffers(
      { clientId: "client", instanceId: "instance", predecessors: [] },
      owner,
    ),
  ).rejects.toThrow("not proven dead");
  vi.mocked(process.kill).mockImplementation(() => {
    throw Object.assign(new Error("gone"), { code: "ESRCH" });
  });
  await expect(
    f.service.reconcileBuffers(
      { clientId: "client", instanceId: "instance", predecessors: [] },
      owner,
    ),
  ).resolves.toEqual({ acknowledged: true });
  await expect(
    f.service.retireBuffers(
      { clientId: "client", instanceId: "instance", processId: process.pid },
      owner,
    ),
  ).resolves.toEqual({ acknowledged: true });
  f.restart();
  expect(await f.service.probe("workspace")).toHaveLength(0);
  await expect(f.service.updateBuffers(f.report(false, true), owner)).rejects.toThrow("retired");
});

it("rejects reserved identities and keeps prototype-shaped owner IDs as ordinary safe map keys", async () => {
  const f = await fixture(),
    invalid = f.report();
  invalid.instanceId = "host-held:v1:forged";
  await expect(f.service.updateBuffers(invalid, owner)).rejects.toThrow("Reserved");
  const valid = f.report(false);
  valid.owners[0].ownerId = "__proto__";
  await f.service.updateBuffers(valid, owner);
  expect((await f.service.listRecovery({}, owner)).records[0].source.ownerId).toBe("__proto__");
  expect(({} as Record<string, unknown>).reportVersion).toBeUndefined();
});

it("rejects valid-JSON held-file corruption even after an older writer drops main inline holds", async () => {
  for (const mutate of [
    (held: any, sibling: string) => {
      held.owners[0].buffers[0].path = join(sibling, "source.txt");
    },
    (held: any) => {
      held.retiredAt = 0;
    },
    (held: any) => {
      delete held.recovery;
    },
    (held: any) => {
      held.owners[0].unknown = false;
    },
  ]) {
    const f = await fixture();
    await f.service.updateBuffers(f.report(), owner);
    await f.service.updateBuffers(f.report(false), owner);
    const heldName = (await f.files()).find((name) => name !== `${f.id}.json`)!;
    const path = join(f.directory, heldName),
      retained = JSON.parse(await readFile(path, "utf8"));
    await durableWrite(
      f.currentPath,
      JSON.stringify({ ...f.report(false), device: hash(owner.ownerId), receivedAt: 1_000_000 }),
    );
    mutate(retained, f.sibling);
    await writeFile(path, JSON.stringify(retained));
    await expect(f.service.probe("workspace")).rejects.toThrow(/hold|corrupt/);
  }
});

it("binds exact archived reportVersion to the parsed original bytes", async () => {
  const f = await fixture();
  await f.service.updateBuffers(f.report(false, true), owner);
  const source = (await f.service.listRecovery({}, owner)).records[0].source;
  await f.service.updateBuffers(f.report(false, true), owner);
  const originalPath = join(
    f.history,
    "reports",
    f.id,
    `${source.reportVersion.toString().padStart(16, "0")}-${source.snapshotDigest}.json`,
  );
  const manifest = JSON.parse(await readFile(originalPath, "utf8"));
  const wrong = { ...source, reportVersion: source.reportVersion + 100 };
  manifest.reportVersion = wrong.reportVersion;
  await writeFile(
    join(
      f.history,
      "reports",
      f.id,
      `${wrong.reportVersion.toString().padStart(16, "0")}-${wrong.snapshotDigest}.json`,
    ),
    JSON.stringify(manifest),
  );
  await expect(f.service.readRecovery(wrong, owner)).rejects.toThrow("report version");
});

it("reserves monotonic versions across restart and never scans initialized history for each heartbeat", async () => {
  const f = await fixture();
  await f.service.updateBuffers(f.report(false, true), owner);
  const clockId = (await f.current()).recovery.clockId;
  expect(clockId).toMatch(/^[a-f0-9-]{36}$/);
  await mkdir(join(f.history, "reports", f.id), { recursive: true });
  await writeFile(
    join(f.history, "reports", f.id, `${Number.MAX_SAFE_INTEGER}-${"f".repeat(64)}.json`),
    "not a manifest",
  );
  f.restart();
  await f.service.updateBuffers(f.report(false, true), owner);
  expect((await f.current()).recovery).toMatchObject({ clockId, reportVersion: 2 });
});

it("consumes a durable clock gap after a lost head ACK and retries without reusing the reserved version", async () => {
  const f = await fixture();
  await f.service.updateBuffers(f.report(false, true), owner);
  const before = await readFile(f.currentPath, "utf8");
  f.setWrite(async (path) => {
    if (path.endsWith(".head.json")) throw new Error("lost clock ACK");
  });
  await expect(f.service.updateBuffers(f.report(false, true), owner)).rejects.toThrow(
    "lost clock ACK",
  );
  expect(await readFile(f.currentPath, "utf8")).toBe(before);
  f.setWrite();
  f.restart();
  await f.service.updateBuffers(f.report(false, true), owner);
  expect((await f.current()).recovery.reportVersion).toBe(3);
});

it("fails closed for missing, partial, malformed or rolled-back initialized clock state", async () => {
  for (const mode of ["missing", "partial", "malformed", "rollback"] as const) {
    const f = await fixture();
    await f.service.updateBuffers(f.report(true, true), owner);
    await f.service.updateBuffers(f.report(true, true), owner);
    const journal = join(f.history, "clocks", `${f.id}.journal`),
      bytes = await readFile(journal);
    const original = await readFile(f.currentPath, "utf8");
    if (mode === "missing") await rm(journal);
    if (mode === "partial") await writeFile(journal, bytes.subarray(0, bytes.length - 1));
    if (mode === "malformed")
      await writeFile(join(f.history, "clocks", `${f.id}.head.json`), "{bad");
    if (mode === "rollback") await writeFile(journal, bytes.subarray(0, 184));
    f.restart();
    await expect(f.service.updateBuffers(f.report(false, true), owner)).rejects.toThrow("clock");
    expect(await readFile(f.currentPath, "utf8")).toBe(original);
    expect(await f.service.probe("workspace")).toHaveLength(1);
  }
});

it("bootstraps a legacy clock once and refuses reservation counter exhaustion", async () => {
  const f = await fixture(),
    legacy = f.report(false);
  await mkdir(f.directory, { recursive: true });
  await writeFile(
    f.currentPath,
    JSON.stringify({
      ...legacy,
      device: hash(owner.ownerId),
      receivedAt: 1_000_000,
      recovery: {
        version: 1,
        kind: "projection",
        reportVersion: Number.MAX_SAFE_INTEGER,
        ownerVersions: { main: 1 },
        ownerLineages: { main: "legacy" },
        heldOwnerIds: [],
      },
    }),
  );
  const original = await readFile(f.currentPath, "utf8");
  await expect(f.service.updateBuffers(f.report(false), owner)).rejects.toThrow("exhausted");
  expect(await readFile(f.currentPath, "utf8")).toBe(original);
});

it("preserves the existing16MiB request allowance and8..16MiB valid legacy guards", async () => {
  const f = await fixture();
  const accepted = { ...f.report(false), ignoredLegacyExtension: "x".repeat(9 * 1024 * 1024) };
  await f.service.updateBuffers(accepted, owner);
  const large = f.report();
  large.owners[0].buffers = Array.from({ length: 10_000 }, () => ({
    path: join(f.path, `${"segment/".repeat(110)}file.txt`),
    dirty: true,
  }));
  const raw = JSON.stringify({ ...large, device: hash(owner.ownerId), receivedAt: 1_000_000 });
  expect(Buffer.byteLength(raw)).toBeGreaterThan(8 * 1024 * 1024);
  expect(Buffer.byteLength(raw)).toBeLessThan(16 * 1024 * 1024);
  await writeFile(f.currentPath, raw);
  f.restart();
  expect(await f.service.probe("workspace")).toHaveLength(1);
});

it("preserves the real runtime's opaque withOwner capability identity through buffer delegation", async () => {
  const f = await fixture(),
    store = new HostStore(join(f.root, "runtime.db"));
  const engine = new HostEngine(store, {
    codex: {
      send: async () => {},
      bind: () => {},
      stop: async () => {},
      cancel: async () => {},
      approve: () => {},
      answer: () => {},
    },
  });
  const runtime = createManagedWorkspaceRuntime(store, engine);
  let expired: Parameters<typeof runtime.nativeActivity.updateBuffers>[1] | undefined;
  try {
    await runtime.withOwner("native-device", async (authorization) => {
      expired = authorization;
      await expect(
        runtime.nativeActivity.updateBuffers(f.report(false, true), authorization),
      ).resolves.toEqual({ acknowledged: true });
      const page = await runtime.nativeActivity.listBufferRecovery({}, authorization);
      expect(page.records).toHaveLength(1);
      expect(
        (await runtime.nativeActivity.readBufferRecovery(page.records[0].source, authorization))
          .qualified,
      ).toBe(false);
      await expect(
        runtime.nativeActivity.updateBuffers(f.report(false, true), { ...authorization }),
      ).rejects.toThrow("authenticated");
    });
    await expect(
      runtime.nativeActivity.updateBuffers(f.report(false, true), expired!),
    ).rejects.toThrow("authenticated");
  } finally {
    await runtime.nativeActivity.closeBufferRecoveryCatalog();
    runtime.retention.stop();
    await engine.close();
    await store.close();
  }
});

it("keeps valid immutable history discoverable and readable when current main is missing or corrupt", async () => {
  for (const corrupt of [false, true]) {
    const f = await fixture();
    await f.service.updateBuffers(f.report(), owner);
    const source = (await f.service.listRecovery({}, owner)).records[0].source;
    await f.service.updateBuffers(f.report(false), owner);
    if (corrupt) await writeFile(f.currentPath, "{bad");
    else await rm(f.currentPath);
    expect((await f.service.readRecovery(source, owner)).owner.buffers[0].dirty).toBe(true);
    expect((await f.service.recoveryStatus(source, owner)).found).toBe(true);
    let page = await f.service.listRecovery({}, owner),
      found = page.records.some((row) => row.source.snapshotDigest === source.snapshotDigest);
    let incomplete = page.incomplete;
    while (page.next) {
      page = await f.service.listRecovery({ after: page.next }, owner);
      found ||= page.records.some((row) => row.source.snapshotDigest === source.snapshotDigest);
      incomplete ||= page.incomplete;
    }
    expect(found).toBe(true);
    expect(incomplete).toBe(corrupt);
    if (corrupt) await expect(f.service.probe("workspace")).rejects.toThrow("corrupt");
    else expect(await f.service.probe("workspace")).toHaveLength(1);
    await expect(f.service.readRecovery(source, other)).rejects.toThrow("unavailable or changed");
  }
});

it("lists indexed historical metadata without pretending missing body chunks were verified", async () => {
  const f = await fixture();
  await f.service.updateBuffers(f.report(), owner);
  const source = (await f.service.listRecovery({}, owner)).records[0].source;
  await f.service.updateBuffers(f.report(false), owner);
  const path = join(
    f.history,
    "reports",
    f.id,
    `${source.reportVersion.toString().padStart(16, "0")}-${source.snapshotDigest}.json`,
  );
  const manifest = JSON.parse(await readFile(path, "utf8"));
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
  const rows = (await f.service.listRecovery({}, owner)).records;
  expect(rows.find((row) => row.source.snapshotDigest === source.snapshotDigest)).toMatchObject({
    verification: "metadata-only",
    retention: "held",
    qualified: false,
  });
  await expect(f.service.readRecovery(source, owner)).rejects.toThrow(/chunk|template/);
  expect(await f.service.probe("workspace")).toHaveLength(1);
});

it("pages high-owner metadata without rejecting a valid accepted report on its next heartbeat", async () => {
  const f = await fixture(),
    report = f.report(false);
  report.clientId = "c".repeat(512);
  report.instanceId = "i".repeat(512);
  report.owners = Array.from({ length: 1000 }, (_, index) => ({
    ownerId: `window-${index}-${"x".repeat(490)}`,
    updatedAt: 1_000_000,
    unknown: false,
    buffers: [],
  }));
  await f.service.updateBuffers(report, owner);
  await f.service.updateBuffers(report, owner);
  const id = hash([hash(owner.ownerId), report.clientId, report.instanceId]);
  const files = await readdir(join(f.history, "reports", id));
  const manifest = JSON.parse(await readFile(join(f.history, "reports", id, files[0]), "utf8"));
  expect(manifest.catalog).toBeUndefined();
  let page = await f.service.listRecovery({ limit: 100 }, owner),
    count = page.records.length;
  expect(page.incomplete).toBe(false);
  while (page.next) {
    page = await f.service.listRecovery({ after: page.next, limit: 100 }, owner);
    count += page.records.length;
    expect(page.incomplete).toBe(false);
  }
  expect(count).toBe(2000);
});

it("bounds cursor capacity, authenticates each page and repeats a lost page ACK exactly", async () => {
  const f = await fixture(),
    report = f.report();
  report.owners.push({ ...report.owners[0], ownerId: "second" });
  await f.service.updateBuffers(report, owner);
  const first = await f.service.listRecovery({ limit: 1 }, owner);
  const next = await f.service.listRecovery({ after: first.next!, limit: 1 }, owner);
  await expect(f.service.listRecovery({ after: first.next!, limit: 1 }, owner)).resolves.toEqual(
    next,
  );
  await expect(f.service.listRecovery({ after: next.next!, limit: 1 }, other)).rejects.toThrow(
    "cursor",
  );
  const cursors = [next.next!];
  for (let index = 0; index < 3; index++)
    cursors.push((await f.service.listRecovery({ limit: 1 }, owner)).next!);
  await expect(f.service.listRecovery({ limit: 1 }, owner)).rejects.toThrow("capacity");
  let rest = await f.service.listRecovery({ after: cursors[0], limit: 1 }, owner);
  while (rest.next) rest = await f.service.listRecovery({ after: rest.next, limit: 1 }, owner);
  expect((await f.service.listRecovery({ limit: 1 }, owner)).records).toHaveLength(1);
  f.advance(61_000);
  await expect(f.service.listRecovery({ after: cursors[1], limit: 1 }, owner)).rejects.toThrow(
    "cursor",
  );
});

it("discovers a valid retained owner population whose full metadata exceeds16MiB lazily", async () => {
  const f = await fixture(),
    clientId = "c".repeat(512),
    instanceId = "i".repeat(512);
  const id = hash([hash(owner.ownerId), clientId, instanceId]);
  const owners = Array.from({ length: 10_000 }, (_, index) => ({
    ownerId: `window-${index}-${"x".repeat(490)}`,
    updatedAt: 1_000_000,
    unknown: true,
    buffers: [],
  }));
  await mkdir(f.directory, { recursive: true });
  await writeFile(
    join(f.directory, `${id}.json`),
    JSON.stringify({
      clientId,
      instanceId,
      processId: process.pid,
      owners,
      device: hash(owner.ownerId),
      receivedAt: 1_000_000,
    }),
  );
  let page = await f.service.listRecovery({ limit: 100 }, owner),
    count = page.records.length,
    metadataBytes = Buffer.byteLength(JSON.stringify(page.records));
  while (page.next) {
    page = await f.service.listRecovery({ after: page.next, limit: 100 }, owner);
    count += page.records.length;
    metadataBytes += Buffer.byteLength(JSON.stringify(page.records));
    expect(page.incomplete).toBe(false);
  }
  expect(count).toBe(10_000);
  expect(metadataBytes).toBeGreaterThan(16 * 1024 * 1024);
});

it("retains exact v1 fallback bytes and reuses an old manifest across retry and restart", async () => {
  const f = await fixture();
  const legacy = {
    ...f.report(),
    device: hash(owner.ownerId),
    receivedAt: 1_000_000,
    extension: Array.from({ length: 200_001 }, () => 1),
  };
  const raw = ` \r\n${JSON.stringify(legacy)}\t`;
  await mkdir(f.directory, { recursive: true });
  await writeFile(f.currentPath, raw);
  const source = (await f.service.listRecovery({}, owner)).records[0].source;
  let lost = false;
  f.setWrite(async (path, bytes) => {
    if (!lost && path.startsWith(join(f.history, "reports"))) {
      lost = true;
      await durableWrite(path, bytes);
      throw new Error("archive ACK lost");
    }
  });
  await expect(f.service.updateBuffers(f.report(false), owner)).rejects.toThrow("archive ACK lost");
  expect(await readFile(f.currentPath, "utf8")).toBe(raw);
  f.setWrite();
  f.restart();
  await f.service.updateBuffers(f.report(false), owner);
  const manifest = JSON.parse(
    await readFile(
      join(
        f.history,
        "reports",
        f.id,
        `${source.reportVersion.toString().padStart(16, "0")}-${source.snapshotDigest}.json`,
      ),
      "utf8",
    ),
  );
  expect(manifest.version).toBe(1);
  expect((await f.service.readRecovery(source, owner)).rawReport).toBe(raw);
});

it("retains an accepted legacy UTF-8 BOM and original whitespace in exact v2 bytes", async () => {
  const f = await fixture();
  const raw = `\uFEFF \r\n${JSON.stringify({ ...f.report(), device: hash(owner.ownerId), receivedAt: 1_000_000 })}\t`;
  await mkdir(f.directory, { recursive: true });
  await writeFile(f.currentPath, raw);
  const source = (await f.service.listRecovery({}, owner)).records[0].source;
  await f.service.updateBuffers(f.report(false), owner);
  f.restart();
  expect((await f.service.readRecovery(source, owner)).rawReport).toBe(raw);
});

it("keeps exact sources through shared-template ACK loss, restart and ABA", async () => {
  const f = await fixture();
  await f.service.updateBuffers(f.report(true, true), owner);
  const source = (await f.service.listRecovery({}, owner)).records[0].source,
    raw = await readFile(f.currentPath, "utf8");
  let lost = false;
  f.setWrite(async (path, bytes) => {
    if (!lost && path.startsWith(join(f.history, "templates"))) {
      lost = true;
      await durableWrite(path, bytes);
      throw new Error("template ACK lost");
    }
  });
  await expect(f.service.updateBuffers(f.report(false, true), owner)).rejects.toThrow(
    "template ACK lost",
  );
  expect(await readFile(f.currentPath, "utf8")).toBe(raw);
  expect(await f.service.probe("workspace")).toHaveLength(1);
  f.setWrite();
  f.restart();
  await f.service.updateBuffers(f.report(false, true), owner);
  await f.service.updateBuffers(f.report(true, true), owner);
  expect((await f.service.readRecovery(source, owner)).rawReport).toBe(raw);
  expect((await f.service.recoveryStatus(source, owner)).found).toBe(true);
  expect((await f.current()).recovery.reportVersion).toBe(4);
});

it("shares large steady heartbeat payloads and catalog templates while retaining all exact receipts", async () => {
  const f = await fixture(),
    report = f.report(false, true);
  report.owners = Array.from({ length: 200 }, (_, index) => {
    const storeInstance = randomUUID(),
      windowIncarnation = randomUUID(),
      buffers = Array.from({ length: 8 }, (_, file) => ({
        path: join(f.path, `${index}-${file}-${"steady-path-".repeat(13)}.txt`),
        dirty: false,
      }));
    return {
      ...report.owners[0],
      ownerId: `physical:v2:${sha(`${storeInstance}:${windowIncarnation}`)}`,
      buffers,
      source: {
        ...report.owners[0].source!,
        storeInstance,
        windowIncarnation,
        snapshotDigest: sha(JSON.stringify(buffers)),
      },
    };
  });
  async function inventory(path: string): Promise<{ bytes: number; files: number }> {
    let bytes = 0,
      files = 0;
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const target = join(path, entry.name);
      if (entry.isDirectory()) {
        const nested = await inventory(target);
        bytes += nested.bytes;
        files += nested.files;
      } else {
        bytes += (await stat(target)).size;
        files++;
      }
    }
    return { bytes, files };
  }
  const beat = async (index: number) => {
    f.advance(15_000);
    for (const item of report.owners) {
      item.updatedAt = 1_000_000 + (index + 1) * 15_000;
      item.source!.reportVersion = index + 1;
      item.source!.reportNonce = randomUUID();
    }
    await f.service.updateBuffers(report, owner);
  };
  await beat(0);
  const source = (await f.service.listRecovery({ limit: 1 }, owner)).records[0].source,
    original = await readFile(f.currentPath, "utf8");
  await beat(1);
  const initial = await inventory(join(f.root, "native-activity")),
    templateCount = (await readdir(join(f.history, "templates"))).length;
  for (let index = 2; index < 10; index++) {
    if (index === 5) f.restart();
    await beat(index);
  }
  const final = await inventory(join(f.root, "native-activity")),
    growth = (final.bytes - initial.bytes) / 8,
    rawBytes = Buffer.byteLength(original);
  console.info(
    "HOST_BUFFER_RETENTION_GROWTH",
    JSON.stringify({
      owners: 200,
      buffers: 1600,
      heartbeats: 10,
      rawBytes,
      initial,
      final,
      addedBytesPerHeartbeat: growth,
      templates: (await readdir(join(f.history, "templates"))).length,
    }),
  );
  expect((await readdir(join(f.history, "templates"))).length).toBe(templateCount);
  expect(growth).toBeLessThan(rawBytes * 0.5);
  expect(final.files - initial.files).toBe(8);
  expect((await f.service.readRecovery(source, owner)).rawReport).toBe(original);
  expect((await readdir(join(f.history, "reports", f.id))).length).toBe(9);
});
