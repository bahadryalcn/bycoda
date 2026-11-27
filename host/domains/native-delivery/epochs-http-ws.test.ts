import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { expect, it, vi } from "vitest";
import { fixture } from "../../devices/native-devices.test-support";
import { deliveryIdentity, deliverySha } from "../../native-delivery/native-delivery.test-support";
import { nativeDeliveryConsumedResult } from "../../native-delivery/native-delivery-store";
import { initializeNativeDeliveryStore } from "../../native-delivery/native-delivery-store";
import { WorkspaceCommands } from "../../workspaces/workspace-commands";
import { ConversationDesktopRelay } from "../../conversation/conversation-tools";
import {
  nativeDeliveryEpochOriginalId,
  type NativeDeliveryEpochRef,
} from "../../../src/shared/model/host-contracts/native-delivery-epochs";
import type { NativeDeliveryIdentity } from "../../../src/shared/model/host-contracts/native-delivery-identity";
import {
  getHostRpcMethod,
  HOST_SCHEMA_VERSION,
  WS_SUBPROTOCOL,
  WS_WIRE_VERSION,
} from "../../../src/shared/model/host-contracts";
import { NATIVE_DELIVERY_METHODS } from "../../../src/shared/model/host-contracts/native-delivery";
import { NATIVE_WORKSPACE_METHODS } from "../../../src/shared/model/host-contracts/native-workspaces";
import { NATIVE_SERVICE_METHODS } from "../../../src/shared/model/host-contracts/native-services";
import { NATIVE_SERVICE_UPLOAD_METHODS } from "../../../src/shared/model/host-contracts/native-service-upload";

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Client = Awaited<ReturnType<Fixture["connect"]>>;
const evidenceId = "2026-10-29-delivery-epochs-wire";
const formatTarget = "native.services.workspace.format";
const finishTarget = "native.services.conversation.desktop.finish";
const formatted = { formatted: "kept Türkçe 😀", cursorOffset: 1 };
const report = () => ({
  clientId: "epochs-wire",
  instanceId: "actual-instance",
  processId: 1,
  owners: [],
});
const formatParams = (f: Fixture) => ({
  command: "format_text_file",
  args: { path: `${f.projectPath}/source.ts`, source: "source", cursorOffset: 1 },
});
const ref = (epoch: NativeDeliveryEpochRef) => ({
  ownerId: epoch.ownerId,
  generation: epoch.generation,
});
const identity = (epoch: NativeDeliveryEpochRef, sequence: number, raw: string) =>
  deliveryIdentity(raw, nativeDeliveryEpochOriginalId({ ...ref(epoch), sequence }));
const formatAck = (original: NativeDeliveryIdentity) => ({
  ...original,
  target: formatTarget,
  consumedResult: nativeDeliveryConsumedResult(formatTarget, formatted),
});
async function receipts(f: Fixture) {
  return (await f.store.db.prepare("SELECT COUNT(*) AS count FROM native_delivery_receipts").get())
    ?.count;
}
function formatter() {
  return vi.spyOn(WorkspaceCommands.prototype, "run").mockImplementation(async (command) => {
    if (command !== "format_text_file")
      throw new Error("Unrelated workspace command reached fixture");
    return formatted;
  });
}
async function pendingFinish(f: Fixture, ws: Client) {
  const relays = new Set<ConversationDesktopRelay>();
  const take = ConversationDesktopRelay.prototype.take;
  vi.spyOn(ConversationDesktopRelay.prototype, "take").mockImplementation(function (
    this: ConversationDesktopRelay,
    owner,
  ) {
    relays.add(this);
    return take.call(this, owner);
  });
  await ws.call("native.services.conversation.desktop.take");
  const relay = [...relays][0];
  if (!relay) throw new Error("Actual desktop relay was not reached");
  const waiting = relay.call("ptyMobile.write", { fixture: true }, f.projectPath, {
    kind: "session",
    projectId: f.project.id,
    sessionId: "epochs-fixture-session",
    provider: "codex",
  });
  void waiting.catch(() => {});
  const [request] = await ws.call("native.services.conversation.desktop.take");
  return { waiting, params: { id: request.id as string, result: { text: "delivered" } } };
}
async function stage(
  ws: Client,
  raw: string,
  target: typeof formatTarget | typeof finishTarget,
  delivery?: NativeDeliveryIdentity,
) {
  const uploadId = randomUUID(),
    bytes = Buffer.from(raw);
  await ws.call("native.services.upload.begin", {
    uploadId,
    target,
    byteLength: bytes.length,
    sha256: deliverySha(bytes),
    ...(delivery ? { delivery } : {}),
  });
  await ws.call("native.services.upload.append", {
    uploadId,
    offset: 0,
    data: bytes.toString("base64"),
  });
  return () => ws.call("native.services.upload.commit", { uploadId });
}

it("advertises the same complete finite Native catalog through HTTP discovery and the actual WebSocket hello", async () => {
  const f = await fixture(evidenceId);
  const descriptor = await f.callHttp("environment.describe");
  const socket = new WebSocket(f.endpoint.replace("http:", "ws:") + "/ws", WS_SUBPROTOCOL, {
    headers: { Authorization: `Bearer ${f.device.token}` },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const hello = await new Promise<{ methods: string[]; capabilities: string[] }>(
      (done, reject) => {
        timer = setTimeout(() => reject(new Error("Actual catalog hello did not settle")), 5_000);
        socket.once("error", reject);
        socket.on("message", (data) => {
          const response = JSON.parse(data.toString());
          if (response.id !== "catalog-hello") return;
          if (response.error) reject(new Error("Actual catalog hello failed"));
          else done(response.result);
        });
        socket.once("open", () =>
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: "catalog-hello",
              method: "connection.hello",
              params: {
                environmentId: f.store.environmentId,
                supportedWireVersions: [WS_WIRE_VERSION],
                supportedSchemaVersions: [HOST_SCHEMA_VERSION],
                clientId: "catalog-fixture",
                clientKind: "desktop",
              },
            }),
          ),
        );
      },
    );
    const controls = new Set([
      "connection.probe",
      "requests.cancel",
      "subscriptions.open",
      "subscriptions.ack",
      "subscriptions.close",
    ]);
    expect(Array.isArray(descriptor.methods)).toBe(true);
    expect([...descriptor.methods].sort()).toEqual(
      hello.methods.filter((method) => !controls.has(method)).sort(),
    );
    expect(new Set(descriptor.methods).size).toBe(descriptor.methods.length);
    expect(descriptor.methods).toEqual(
      expect.arrayContaining([
        ...NATIVE_DELIVERY_METHODS,
        ...NATIVE_WORKSPACE_METHODS,
        ...NATIVE_SERVICE_METHODS,
        ...NATIVE_SERVICE_UPLOAD_METHODS,
      ]),
    );
    for (const method of descriptor.methods) expect(getHostRpcMethod(method), method).toBeDefined();
    expect(descriptor.capabilities).toContain("native.delivery.epochs.v2");
    expect(hello.capabilities).toContain("native.delivery.epochs.v2");
  } finally {
    clearTimeout(timer);
    socket.terminate();
  }
});

it("compacts a service delivery across legacy buffer receipts after Host storage upgrade", async () => {
  const f = await fixture(evidenceId);
  const ws = await f.connect();
  const format = formatter();
  const principal = deliverySha(f.device.token);
  const epoch = await ws.call("native.delivery.epochs.open", { openId: randomUUID() });
  const raw = JSON.stringify(report());
  for (const sequence of [1, 2]) {
    const original = identity(epoch, sequence, raw);
    await f.store.db
      .prepare(`INSERT INTO native_delivery_receipts (
      environment_id, principal_id, kind, original_id, sha256, byte_length,
      state, reserved_bytes, epoch_owner_id, epoch_generation, epoch_sequence
    ) VALUES (?, ?, 'buffer', ?, ?, ?, 'admitted', 21, ?, ?, ?)`)
      .run(
        f.store.environmentId,
        principal,
        original.originalId,
        original.sha256,
        original.byteLength,
        epoch.ownerId,
        epoch.generation,
        sequence,
      );
  }
  const ack = JSON.stringify({ acknowledged: true });
  await f.store.db
    .prepare(`UPDATE native_delivery_receipts
    SET state='recorded', reserved_bytes=0, result_json=?, proof_json='{}',
        result_sha256=?, result_bytes=?, consumed_sha256=?, consumed_bytes=?
    WHERE kind='buffer' AND epoch_sequence=2`)
    .run(ack, deliverySha(ack), Buffer.byteLength(ack), deliverySha(ack), Buffer.byteLength(ack));
  expect(await receipts(f)).toBe(2);
  await initializeNativeDeliveryStore(f.store.db);
  await initializeNativeDeliveryStore(f.store.db);
  const legacy = identity(epoch, 1, raw);
  expect(
    await ws.call("native.delivery.epochs.gap.resolve", {
      ...ref(epoch),
      sequence: 1,
      kind: "buffer",
      sha256: legacy.sha256,
      byteLength: legacy.byteLength,
    }),
  ).toMatchObject({ outcome: "abandoned" });
  const paramsJson = JSON.stringify(formatParams(f));
  const service = identity(epoch, 3, paramsJson);
  expect(
    await f.callHttp("native.services.delivery.apply", {
      ...service,
      target: formatTarget,
      paramsJson,
    }),
  ).toMatchObject({ state: "recorded", result: formatted });
  await ws.call("native.services.delivery.ack", formatAck(service));
  expect(
    await ws.call("native.delivery.epochs.compact", {
      ...ref(epoch),
      expectedThrough: 0,
      through: 3,
    }),
  ).toMatchObject({ through: 3, highWater: 3 });
  expect(await receipts(f)).toBe(0);
  expect(
    await f.store.db.prepare("SELECT receipts,bytes FROM native_delivery_quota_totals").get(),
  ).toMatchObject({ receipts: 0, bytes: 0 });
  expect(format).toHaveBeenCalledTimes(1);
});

it("holds one shared service prefix for unacknowledged and missing sequence holes before terminal close", async () => {
  const f = await fixture(evidenceId),
    ws = await f.connect(),
    format = formatter();
  const epoch = await ws.call("native.delivery.epochs.open", { openId: randomUUID() });
  const formatJson = JSON.stringify(formatParams(f)),
    first = identity(epoch, 1, formatJson);
  expect(
    await f.callHttp("native.services.delivery.apply", {
      ...first,
      target: formatTarget,
      paramsJson: formatJson,
    }),
  ).toMatchObject({ state: "recorded", result: formatted });
  const second = identity(epoch, 2, formatJson);
  await ws.call("native.services.delivery.apply", {
    ...second,
    target: formatTarget,
    paramsJson: formatJson,
  });
  await f.callHttp("native.services.delivery.ack", formatAck(second));
  expect(
    (
      await ws.request("native.delivery.epochs.compact", {
        ...ref(epoch),
        expectedThrough: 0,
        through: 2,
      })
    ).error,
  ).toBeDefined();
  expect(await receipts(f)).toBe(2);
  expect(await f.callHttp("native.delivery.epochs.status", ref(epoch))).toMatchObject({
    through: 0,
    highWater: 2,
  });
  await ws.call("native.services.delivery.ack", formatAck(first));
  expect(
    await f.callHttp("native.delivery.epochs.compact", {
      ...ref(epoch),
      expectedThrough: 0,
      through: 2,
    }),
  ).toMatchObject({ through: 2, highWater: 2 });
  const fourth = identity(epoch, 4, formatJson);
  await ws.call("native.services.delivery.apply", {
    ...fourth,
    target: formatTarget,
    paramsJson: formatJson,
  });
  await ws.call("native.services.delivery.ack", formatAck(fourth));
  expect(
    (
      await f.http("native.delivery.epochs.compact", {
        ...ref(epoch),
        expectedThrough: 2,
        through: 4,
      })
    ).error,
  ).toBeDefined();
  const third = identity(epoch, 3, formatJson);
  await f.callHttp("native.services.delivery.apply", {
    ...third,
    target: formatTarget,
    paramsJson: formatJson,
  });
  await ws.call("native.services.delivery.ack", formatAck(third));
  const closed = await ws.call("native.delivery.epochs.close", {
    ...ref(epoch),
    expectedThrough: 2,
    through: 4,
  });
  expect(closed).toMatchObject({ through: 4, highWater: 4, closed: true });
  expect(await f.callHttp("native.delivery.epochs.open", { openId: epoch.openId })).toEqual(closed);
  const neverAdmitted = identity(epoch, 5, formatJson);
  expect(
    await f.callHttp("native.services.delivery.apply", {
      ...neverAdmitted,
      target: formatTarget,
      paramsJson: formatJson,
    }),
  ).toEqual({
    ...neverAdmitted,
    target: formatTarget,
    state: "fenced",
    epoch: { ...ref(epoch), through: 4, closed: true },
  });
  expect(format).toHaveBeenCalledTimes(4);
  expect(await receipts(f)).toBe(0);
});

it("enforces the principal v2 floor at actual direct, legacy and pre-staged helper owners while preserving old receipts", async () => {
  const f = await fixture(evidenceId),
    ws = await f.connect(),
    format = formatter();
  const oldJson = JSON.stringify(formatParams(f)),
    old = deliveryIdentity(oldJson);
  await f.callHttp("native.services.delivery.apply", {
    ...old,
    target: formatTarget,
    paramsJson: oldJson,
  });
  const pending = await pendingFinish(f, ws),
    finish = vi.spyOn(ConversationDesktopRelay.prototype, "finish");
  // Staging predates the floor. Only the final actual owner may admit its effect.
  const stagedFormat = await stage(ws, oldJson, formatTarget);
  const stagedFinish = await stage(ws, JSON.stringify(pending.params), finishTarget);
  const epoch = await ws.call("native.delivery.epochs.open", { openId: randomUUID() });
  expect(
    (
      await ws.request("native.services.delivery.apply", {
        ...deliveryIdentity(oldJson),
        target: formatTarget,
        paramsJson: oldJson,
      })
    ).error,
  ).toBeDefined();
  expect(await ws.call("native.buffers.update", report())).toEqual({ acknowledged: true });
  expect((await ws.request(formatTarget, formatParams(f))).error).toBeDefined();
  expect((await f.http("workspace.run", formatParams(f))).error).toBeDefined();
  expect((await ws.request(finishTarget, pending.params)).error).toBeDefined();
  expect((await f.http("conversation.desktop.finish", pending.params)).error).toBeDefined();
  for (const commit of [stagedFormat, stagedFinish])
    expect(await commit()).toMatchObject({ state: "failed", outcome: { delivery: "unknown" } });
  expect(format).toHaveBeenCalledTimes(1);
  expect(finish).not.toHaveBeenCalled();
  expect(
    await ws.call("native.services.delivery.status", { ...old, target: formatTarget }),
  ).toMatchObject({ state: "recorded", result: formatted });
  expect(await f.callHttp("native.services.delivery.ack", formatAck(old))).toMatchObject({
    state: "retired",
  });
  expect(
    await ws.call("native.services.delivery.apply", {
      ...old,
      target: formatTarget,
      paramsJson: oldJson,
    }),
  ).toMatchObject({ state: "retired" });
  // A fresh v2 winner carries its private matching effect admission through staging.
  const first = identity(epoch, 1, oldJson);
  expect(await (await stage(ws, oldJson, formatTarget, first))()).toMatchObject({
    state: "completed",
    result: { ...first, target: formatTarget, state: "recorded", result: formatted },
  });
  const finishJson = JSON.stringify(pending.params),
    second = identity(epoch, 2, finishJson);
  expect(
    await f.callHttp("native.services.delivery.apply", {
      ...second,
      target: finishTarget,
      paramsJson: finishJson,
    }),
  ).toMatchObject({ state: "recorded", result: { accepted: true } });
  expect(await pending.waiting).toEqual(pending.params.result);
  expect(format).toHaveBeenCalledTimes(2);
  expect(finish).toHaveBeenCalledTimes(1);
  expect(await receipts(f)).toBe(3);
});

it("keeps a real committed floor after a lost HTTP compaction acknowledgement and never repeats the effect", async () => {
  const f = await fixture(evidenceId),
    ws = await f.connect(),
    format = formatter();
  const epoch = await f.callHttp("native.delivery.epochs.open", { openId: randomUUID() });
  const raw = JSON.stringify(formatParams(f)),
    original = identity(epoch, 1, raw);
  const applying = { ...original, target: formatTarget, paramsJson: raw };
  await ws.call("native.services.delivery.apply", applying);
  await f.callHttp("native.services.delivery.ack", formatAck(original));
  const exec = f.store.db.exec.bind(f.store.db);
  let lost = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
  const commit = vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
    await exec(sql);
    if (sql === "COMMIT" && !lost) {
      lost = true;
      throw new Error("Fixture lost actual compact COMMIT acknowledgement");
    }
  });
  const uncertain = await f.http("native.delivery.epochs.compact", {
    ...ref(epoch),
    expectedThrough: 0,
    through: 1,
  });
  expect(lost).toBe(true);
  expect(uncertain.error).toBeDefined();
  commit.mockRestore();
  expect(await ws.call("native.delivery.epochs.status", ref(epoch))).toMatchObject({
    through: 1,
    highWater: 1,
  });
  expect(await receipts(f)).toBe(0);
  // The retry still expects the old floor: a refusal that changed nothing, so the desktop reads
  // the status instead of holding delivery on an unknown outcome.
  expect(
    (
      await ws.request("native.delivery.epochs.compact", {
        ...ref(epoch),
        expectedThrough: 0,
        through: 1,
      })
    ).error,
  ).toMatchObject({
    message: expect.stringContaining("NATIVE_DELIVERY_EPOCH_CAS"),
    data: { category: "conflict", delivery: "not-sent", code: "CONTEXT_CHANGED" },
  });
  expect(await f.callHttp("native.services.delivery.apply", applying)).toEqual({
    ...original,
    target: formatTarget,
    state: "fenced",
    epoch: { ...ref(epoch), through: 1, closed: false },
  });
  expect(
    (await ws.request("native.services.delivery.ack", formatAck(original))).error,
  ).toBeDefined();
  expect(format).toHaveBeenCalledTimes(1);
});
