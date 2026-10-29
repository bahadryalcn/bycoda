import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { expect, it, vi } from "vitest";
import { fixture } from "../../native-devices.test-support";
import { deliveryIdentity, deliverySha } from "../../native-delivery.test-support";
import { nativeDeliveryConsumedResult } from "../../native-delivery-store";
import { WorkspaceCommands } from "../../workspace-commands";
import { ConversationDesktopRelay } from "../../conversation-tools";
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
import { NATIVE_BUFFER_UPLOAD_METHODS } from "../../../src/shared/model/host-contracts/native-buffer-upload";
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
const bufferAck = (original: NativeDeliveryIdentity) => ({
  ...original,
  consumedResult: nativeDeliveryConsumedResult("buffer", { acknowledged: true }),
});
const formatAck = (original: NativeDeliveryIdentity) => ({
  ...original,
  target: formatTarget,
  consumedResult: nativeDeliveryConsumedResult(formatTarget, formatted),
});
async function clocks(f: Fixture) {
  return f.store.db
    .prepare("SELECT report_id,state_json FROM native_buffer_clocks ORDER BY report_id")
    .all();
}
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
  target?: typeof formatTarget | typeof finishTarget,
  delivery?: NativeDeliveryIdentity,
) {
  const uploadId = randomUUID(),
    bytes = Buffer.from(raw);
  const family = target ? "native.services.upload" : "native.buffers.upload";
  await ws.call(`${family}.${target ? "begin" : "start"}`, {
    uploadId,
    ...(target ? { target } : {}),
    byteLength: bytes.length,
    sha256: deliverySha(bytes),
    ...(delivery ? { delivery } : {}),
  });
  await ws.call(`${family}.${target ? "append" : "write"}`, {
    uploadId,
    offset: 0,
    data: bytes.toString("base64"),
  });
  return () => ws.call(`${family}.commit`, { uploadId });
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
        ...NATIVE_BUFFER_UPLOAD_METHODS,
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

it("fences compacted actual buffer deliveries across authenticated HTTP and WebSocket without repeating effects", async () => {
  const f = await fixture(evidenceId),
    ws = await f.connect();
  const epoch = await f.callHttp("native.delivery.epochs.open", { openId: randomUUID() });
  expect(epoch).toMatchObject({ version: 2, through: 0, highWater: 0, closed: false });
  const raw = JSON.stringify(report()),
    original = identity(epoch, 1, raw);
  const applying = { ...original, paramsJson: raw };
  expect(await ws.call("native.buffers.delivery.apply", applying)).toEqual({
    ...original,
    state: "recorded",
    result: { acknowledged: true },
  });
  expect(await receipts(f)).toBe(1);
  expect(await f.callHttp("native.buffers.delivery.ack", bufferAck(original))).toMatchObject({
    state: "retired",
  });
  const compacted = await ws.call("native.delivery.epochs.compact", {
    ...ref(epoch),
    expectedThrough: 0,
    through: 1,
  });
  expect(compacted).toEqual({ ...epoch, through: 1, highWater: 1 });
  expect(await receipts(f)).toBe(0);
  const beforeClocks = await clocks(f),
    beforeVersion = f.store.db.dataMutationVersion;
  const fenced = {
    ...original,
    state: "fenced",
    epoch: { ...ref(epoch), through: 1, closed: false },
  };
  expect(await f.callHttp("native.buffers.delivery.apply", applying)).toEqual(fenced);
  expect(await ws.call("native.buffers.delivery.status", original)).toEqual(fenced);
  expect((await f.http("native.buffers.delivery.ack", bufferAck(original))).error).toBeDefined();
  expect(
    (await f.http("native.delivery.epochs.status", ref(epoch), f.other.token)).error,
  ).toBeDefined();
  const foreign = await f.connect(f.other.token);
  const denied = await foreign.request("native.buffers.delivery.status", original);
  expect(denied.error).toBeDefined();
  expect(denied.result).toBeUndefined();
  expect(await clocks(f)).toEqual(beforeClocks);
  expect(f.store.db.dataMutationVersion).toBe(beforeVersion);
  expect(await receipts(f)).toBe(0);
});

it("holds one shared cross-kind prefix for unacknowledged and missing sequence holes before terminal close", async () => {
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
  const bufferJson = JSON.stringify(report()),
    second = identity(epoch, 2, bufferJson);
  await ws.call("native.buffers.delivery.apply", { ...second, paramsJson: bufferJson });
  await f.callHttp("native.buffers.delivery.ack", bufferAck(second));
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
  const third = identity(epoch, 3, bufferJson);
  await f.callHttp("native.buffers.delivery.apply", { ...third, paramsJson: bufferJson });
  await ws.call("native.buffers.delivery.ack", bufferAck(third));
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
  expect(format).toHaveBeenCalledTimes(2);
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
  const bufferParams = report(),
    bufferJson = JSON.stringify(bufferParams);
  // Staging predates the floor. Only the final actual owner may admit its effect.
  const stagedBuffer = await stage(ws, bufferJson);
  const stagedFormat = await stage(ws, oldJson, formatTarget);
  const stagedFinish = await stage(ws, JSON.stringify(pending.params), finishTarget);
  const epoch = await ws.call("native.delivery.epochs.open", { openId: randomUUID() });
  const beforeClocks = await clocks(f);
  expect(
    (
      await f.http("native.buffers.delivery.apply", {
        ...deliveryIdentity(bufferJson),
        paramsJson: bufferJson,
      })
    ).error,
  ).toBeDefined();
  expect(
    (
      await ws.request("native.services.delivery.apply", {
        ...deliveryIdentity(oldJson),
        target: formatTarget,
        paramsJson: oldJson,
      })
    ).error,
  ).toBeDefined();
  expect((await ws.request("native.buffers.update", bufferParams)).error).toBeDefined();
  expect((await f.http("native.buffers.update", bufferParams)).error).toBeDefined();
  expect((await ws.request(formatTarget, formatParams(f))).error).toBeDefined();
  expect((await f.http("workspace.run", formatParams(f))).error).toBeDefined();
  expect((await ws.request(finishTarget, pending.params)).error).toBeDefined();
  expect((await f.http("conversation.desktop.finish", pending.params)).error).toBeDefined();
  for (const commit of [stagedBuffer, stagedFormat, stagedFinish])
    expect(await commit()).toMatchObject({ state: "failed", outcome: { delivery: "unknown" } });
  expect(await clocks(f)).toEqual(beforeClocks);
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
  const third = identity(epoch, 3, bufferJson);
  expect(await (await stage(ws, bufferJson, undefined, third))()).toMatchObject({
    state: "completed",
    result: { ...third, state: "recorded", result: { acknowledged: true } },
  });
  expect(format).toHaveBeenCalledTimes(2);
  expect(finish).toHaveBeenCalledTimes(1);
  expect(await receipts(f)).toBe(4);
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
  expect(
    (
      await ws.request("native.delivery.epochs.compact", {
        ...ref(epoch),
        expectedThrough: 0,
        through: 1,
      })
    ).error,
  ).toBeDefined();
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
