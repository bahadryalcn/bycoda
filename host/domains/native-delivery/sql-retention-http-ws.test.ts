import { lstat, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { expect, it } from "vitest";
import { fixture } from "../../devices/native-devices.test-support";
import { deliveryIdentity, deliverySha } from "../../native-delivery/native-delivery.test-support";
import { nativeDeliveryConsumedResult } from "../../native-delivery/native-delivery-store";
import { createNativeBufferPersistenceStore } from "../../native-buffer/native-buffer-persistence-store";
import type { NativeBufferDeliveryProof } from "../native-delivery/ports";
import type { NativeBufferClockState } from "../../ports/native-buffer-persistence";

const evidenceId = "2026-10-29-buffer-sql-wire";
type WireFixture = Awaited<ReturnType<typeof fixture>>;
const report = () =>
  JSON.stringify({
    clientId: "sql-wire-client",
    instanceId: "physical-instance",
    processId: 1,
    owners: [],
  });
const recorded = (identity: ReturnType<typeof deliveryIdentity>) => ({
  ...identity,
  state: "recorded",
  result: { acknowledged: true },
});
const activityPath = (f: WireFixture) => resolve(f.root, "managed-workspaces", "native-activity");

async function removeFixtureCache(f: WireFixture) {
  const path = activityPath(f),
    root = resolve(f.root);
  if (!path.startsWith(root + sep) || path !== join(root, "managed-workspaces", "native-activity"))
    throw new Error("Cache deletion escaped the isolated fixture");
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return;
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    !(await realpath(path)).startsWith((await realpath(root)) + sep)
  )
    throw new Error("Unsafe fixture cache path");
  await rm(path, { recursive: true, force: true });
}
async function assertNoCache(f: WireFixture) {
  await expect(lstat(activityPath(f))).rejects.toMatchObject({ code: "ENOENT" });
  expect((await lstat(join(f.root, "host.db"))).isFile()).toBe(true);
}
async function retained(f: WireFixture, identity: ReturnType<typeof deliveryIdentity>) {
  const receipt = await f.store.db
    .prepare(
      "SELECT state,proof_json FROM native_delivery_receipts WHERE environment_id=? AND principal_id=? AND original_id=?",
    )
    .get(f.store.environmentId, deliverySha(f.device.token), identity.originalId);
  expect(receipt?.state).toBe("recorded");
  const proof = JSON.parse(String(receipt!.proof_json)) as NativeBufferDeliveryProof;
  const row = await f.store.db
    .prepare("SELECT state_json FROM native_buffer_clocks WHERE report_id=?")
    .get(proof.reportId);
  expect(row).toBeDefined();
  const clock = JSON.parse(String(row!.state_json)) as NativeBufferClockState;
  const witness = await f.store.db
    .prepare("SELECT state_json FROM native_buffer_clock_witnesses WHERE report_id=?")
    .get(proof.reportId);
  expect(witness?.state_json).toBe(row!.state_json);
  expect(clock.reportId).toBe(proof.reportId);
  expect(clock.highWater).toBeGreaterThanOrEqual(proof.reportVersion);
  const certificate = await createNativeBufferPersistenceStore(f.store).readCertificate(
    {
      reportId: proof.reportId,
      reportVersion: proof.reportVersion,
      snapshotDigest: proof.snapshotDigest,
    },
    64 * 1024 * 1024,
  );
  expect(certificate).not.toBeNull();
  expect(certificate!.clockId).toBe(clock.clockId);
  expect(certificate!.byteLength).toBe(proof.byteLength);
  expect(certificate!.raw.length).toBe(proof.byteLength);
  expect(deliverySha(certificate!.raw)).toBe(proof.snapshotDigest);
  const binding = {
    ...identity,
    principalId: deliverySha(f.device.token),
    environmentId: f.store.environmentId,
  };
  expect(certificate!.originalDelivery).toEqual(binding);
  expect(JSON.parse(certificate!.raw.toString("utf8"))).toMatchObject({
    clientId: "sql-wire-client",
    instanceId: "physical-instance",
    processId: 1,
    originalDelivery: binding,
    recovery: { reportVersion: proof.reportVersion, clockId: clock.clockId },
  });
  expect(
    (
      await f.store.db
        .prepare("SELECT COUNT(*) AS count FROM native_buffer_blob_chunks WHERE sha256=?")
        .get(proof.snapshotDigest)
    )?.count,
  ).toBeGreaterThan(0);
  return { proof, clock, certificate: certificate! };
}
async function cacheMirrorThenErase(f: WireFixture, source: Awaited<ReturnType<typeof retained>>) {
  const buffers = join(activityPath(f), "buffers"),
    clocks = join(activityPath(f), "buffer-history", "clocks");
  await mkdir(buffers, { recursive: true });
  await mkdir(clocks, { recursive: true });
  await writeFile(join(buffers, source.proof.reportId + ".json"), source.certificate.raw);
  // A stale clock cache must have no authority once the actual SQL floor exists.
  await writeFile(join(clocks, source.proof.reportId + ".journal"), "obsolete fixture cache");
  expect((await lstat(activityPath(f))).isDirectory()).toBe(true);
  await removeFixtureCache(f);
  await assertNoCache(f);
}
async function effectSnapshot(f: WireFixture) {
  return {
    clocks: await f.store.db
      .prepare("SELECT report_id,state_json FROM native_buffer_clocks ORDER BY report_id")
      .all(),
    certificates: await f.store.db
      .prepare(
        "SELECT report_id,report_version,snapshot_digest FROM native_buffer_certificates ORDER BY report_id,report_version,snapshot_digest",
      )
      .all(),
    heads: await f.store.db
      .prepare("SELECT key,sha256,byte_length FROM native_buffer_artifacts ORDER BY key")
      .all(),
  };
}

it("uses actual captured HTTP/WS owners and SQL completion without filesystem caches, keeping status read-only", async () => {
  const f = await fixture(evidenceId),
    ws = await f.connect(),
    paramsJson = report(),
    identity = deliveryIdentity(paramsJson);
  await removeFixtureCache(f);
  await assertNoCache(f);
  expect(await f.callHttp("native.buffers.delivery.apply", { ...identity, paramsJson })).toEqual(
    recorded(identity),
  );
  const source = await retained(f, identity);
  expect(source.proof.reportVersion).toBeGreaterThan(0);
  expect(
    (await f.store.db.prepare("SELECT COUNT(*) AS count FROM native_buffer_clocks").get())?.count,
  ).toBe(1);
  await assertNoCache(f);
  const before = f.store.db.dataMutationVersion,
    effects = await effectSnapshot(f);
  expect(await ws.call("native.buffers.delivery.status", identity)).toEqual(recorded(identity));
  expect(await f.callHttp("native.buffers.delivery.status", identity)).toEqual(recorded(identity));
  expect(await effectSnapshot(f)).toEqual(effects);
  expect(f.store.db.dataMutationVersion).toBe(before);
  await assertNoCache(f);
  expect(f.command).not.toHaveBeenCalled();
  expect(f.binary).not.toHaveBeenCalled();
});

it("keeps recorded proof through same-process total cache loss and retires over HTTP without replay or other-credential access", async () => {
  const f = await fixture(evidenceId),
    ws = await f.connect(),
    foreign = await f.connect(f.other.token),
    paramsJson = report(),
    identity = deliveryIdentity(paramsJson);
  expect(await f.callHttp("native.buffers.delivery.apply", { ...identity, paramsJson })).toEqual(
    recorded(identity),
  );
  const source = await retained(f, identity),
    effects = await effectSnapshot(f);
  await cacheMirrorThenErase(f, source);
  const before = f.store.db.dataMutationVersion;
  expect(await ws.call("native.buffers.delivery.status", identity)).toEqual(recorded(identity));
  expect((await f.http("native.buffers.delivery.status", identity, f.other.token)).result).toEqual({
    state: "absent",
  });
  expect(await foreign.call("native.buffers.delivery.status", identity)).toEqual({
    state: "absent",
  });
  expect(f.store.db.dataMutationVersion).toBe(before);
  const consumedResult = nativeDeliveryConsumedResult("buffer", { acknowledged: true }),
    ack = { ...identity, consumedResult },
    retired = { ...ack, state: "retired" };
  const deniedHttp = await f.http("native.buffers.delivery.ack", ack, f.other.token);
  expect(deniedHttp.error).toBeDefined();
  expect(deniedHttp.result).toBeUndefined();
  const denied = await foreign.request("native.buffers.delivery.ack", ack);
  expect(denied.error).toBeDefined();
  expect(denied.result).toBeUndefined();
  expect(await f.callHttp("native.buffers.delivery.ack", ack)).toEqual(retired);
  const retiredBefore = f.store.db.dataMutationVersion;
  expect(await ws.call("native.buffers.delivery.status", identity)).toEqual(retired);
  expect(f.store.db.dataMutationVersion).toBe(retiredBefore);
  expect(await f.callHttp("native.buffers.delivery.apply", { ...identity, paramsJson })).toEqual(
    retired,
  );
  expect(await ws.call("native.buffers.delivery.ack", ack)).toEqual(retired);
  expect(await effectSnapshot(f)).toEqual(effects);
  expect(
    await f.store.db
      .prepare(
        "SELECT state,result_json,proof_json FROM native_delivery_receipts WHERE original_id=?",
      )
      .get(identity.originalId),
  ).toEqual({ state: "retired", result_json: null, proof_json: null });
  await assertNoCache(f);
  expect(f.command).not.toHaveBeenCalled();
  expect(f.binary).not.toHaveBeenCalled();
});

it("advances the same SQL clock for a distinct original after cache loss while the old original proof stays recorded", async () => {
  const f = await fixture(evidenceId),
    ws = await f.connect(),
    paramsJson = report(),
    first = deliveryIdentity(paramsJson),
    second = deliveryIdentity(paramsJson);
  expect(await f.callHttp("native.buffers.delivery.apply", { ...first, paramsJson })).toEqual(
    recorded(first),
  );
  const old = await retained(f, first);
  await cacheMirrorThenErase(f, old);
  expect(await ws.call("native.buffers.delivery.apply", { ...second, paramsJson })).toEqual(
    recorded(second),
  );
  const current = await retained(f, second);
  expect(current.proof.reportId).toBe(old.proof.reportId);
  expect(current.proof.reportVersion).toBeGreaterThan(old.proof.reportVersion);
  expect(current.proof.snapshotDigest).not.toBe(old.proof.snapshotDigest);
  expect(current.clock.clockId).toBe(old.clock.clockId);
  expect(current.clock.base).toBe(old.clock.base);
  expect(current.clock.highWater).toBe(current.proof.reportVersion);
  expect(
    (
      await f.store.db
        .prepare("SELECT sha256 FROM native_buffer_artifacts WHERE key=?")
        .get(`native-activity/buffers/${current.proof.reportId}.json`)
    )?.sha256,
  ).toBe(current.proof.snapshotDigest);
  const before = f.store.db.dataMutationVersion,
    effects = await effectSnapshot(f);
  expect(await ws.call("native.buffers.delivery.status", first)).toEqual(recorded(first));
  expect(await f.callHttp("native.buffers.delivery.status", second)).toEqual(recorded(second));
  expect((await retained(f, first)).certificate.raw).toEqual(old.certificate.raw);
  expect(f.store.db.dataMutationVersion).toBe(before);
  expect(await f.callHttp("native.buffers.delivery.apply", { ...first, paramsJson })).toEqual(
    recorded(first),
  );
  expect(await effectSnapshot(f)).toEqual(effects);
  await assertNoCache(f);
  expect(f.command).not.toHaveBeenCalled();
  expect(f.binary).not.toHaveBeenCalled();
});
