import { expect, it, vi } from "vitest";
import { fixture } from "../../native-devices.test-support";
import { deliveryIdentity } from "../../native-delivery.test-support";
import { deliverySha } from "../../native-delivery.test-support";
import { nativeDeliveryConsumedResult } from "../../native-delivery-store";
import { WorkspaceCommands } from "../../workspace-commands";
import { ConversationDesktopRelay } from "../../conversation-tools";
import { NATIVE_BUFFER_UPLOAD_LIMITS } from "../../../src/shared/model/host-contracts/native-buffer-upload";

async function pendingFinish(
  f: Awaited<ReturnType<typeof fixture>>,
  ws: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["connect"]>>,
) {
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
    sessionId: "fixture-session",
    provider: "codex",
  });
  void waiting.catch(() => {});
  const [request] = await ws.call("native.services.conversation.desktop.take");
  return { waiting, id: request.id as string };
}

it("routes finite delivery HTTP/WS through actual captured owners and isolates original credentials", async () => {
  const f = await fixture("2026-10-29-host-native-delivery"),
    ws = await f.connect();
  const paramsJson = JSON.stringify({
    clientId: "delivery-wire",
    instanceId: "first-instance",
    processId: 1,
    owners: [],
  });
  const identity = deliveryIdentity(paramsJson),
    params = { ...identity, paramsJson };
  expect(await f.callHttp("native.buffers.delivery.apply", params)).toEqual({
    ...identity,
    state: "recorded",
    result: { acknowledged: true },
  });
  expect(await ws.call("native.buffers.delivery.status", identity)).toEqual({
    ...identity,
    state: "recorded",
    result: { acknowledged: true },
  });
  const stored = await f.store.db
    .prepare("SELECT COUNT(*) AS count FROM native_delivery_receipts")
    .get();
  expect(stored?.count).toBe(1);
  expect(await ws.call("native.buffers.delivery.apply", params)).toMatchObject({
    state: "recorded",
  });
  expect(
    (await f.store.db.prepare("SELECT COUNT(*) AS count FROM native_delivery_receipts").get())
      ?.count,
  ).toBe(1);
  expect((await f.http("native.buffers.delivery.status", identity, f.other.token)).result).toEqual({
    state: "absent",
  });
  const invalid = await f.http("native.buffers.delivery.apply", {
    ...params,
    paramsJson: paramsJson + " ",
  });
  expect(invalid.status).toBe(400);
  const pending = await pendingFinish(f, ws);
  const finish = vi.spyOn(ConversationDesktopRelay.prototype, "finish");
  const finishJson = JSON.stringify({ id: pending.id, result: { text: "kept 😀" } });
  const finishIdentity = deliveryIdentity(finishJson),
    finishParams = {
      ...finishIdentity,
      target: "native.services.conversation.desktop.finish",
      paramsJson: finishJson,
    };
  expect(await ws.call("native.services.delivery.apply", finishParams)).toEqual({
    ...finishIdentity,
    target: finishParams.target,
    state: "recorded",
    result: { accepted: true },
  });
  expect(
    await f.callHttp("native.services.delivery.status", {
      ...finishIdentity,
      target: finishParams.target,
    }),
  ).toMatchObject({ state: "recorded" });
  expect(await f.callHttp("native.services.delivery.apply", finishParams)).toMatchObject({
    state: "recorded",
  });
  expect(finish).toHaveBeenCalledTimes(1);
  expect(await pending.waiting).toEqual({ text: "kept 😀" });
  const finishAck = {
    ...finishIdentity,
    target: finishParams.target,
    consumedResult: nativeDeliveryConsumedResult("native.services.conversation.desktop.finish", {
      accepted: true,
    }),
  };
  expect(await f.callHttp("native.services.delivery.ack", finishAck)).toEqual({
    ...finishAck,
    state: "retired",
  });
  expect(
    await ws.call("native.services.delivery.status", {
      ...finishIdentity,
      target: finishParams.target,
    }),
  ).toEqual({ ...finishAck, state: "retired" });
  expect(await ws.call("native.services.delivery.apply", finishParams)).toEqual({
    ...finishAck,
    state: "retired",
  });
  const bufferAck = {
    ...identity,
    consumedResult: nativeDeliveryConsumedResult("buffer", { acknowledged: true }),
  };
  expect(await ws.call("native.buffers.delivery.ack", bufferAck)).toEqual({
    ...bufferAck,
    state: "retired",
  });
  expect(await f.callHttp("native.buffers.delivery.status", identity)).toEqual({
    ...bufferAck,
    state: "retired",
  });
  expect(
    (await f.http("native.buffers.delivery.ack", bufferAck, f.other.token)).error,
  ).toBeDefined();
  expect(finish).toHaveBeenCalledTimes(1);
});

it("stages original large bytes with immutable delivery metadata and exposes recorded results independently of staging", async () => {
  const f = await fixture("2026-10-29-host-native-delivery"),
    ws = await f.connect();
  const target = "native.services.conversation.desktop.finish";
  const pending = await pendingFinish(f, ws),
    result = { text: "" };
  const overhead = Buffer.byteLength(JSON.stringify({ id: pending.id, result }));
  result.text = "x".repeat(NATIVE_BUFFER_UPLOAD_LIMITS.maxBytes - overhead);
  const paramsJson = JSON.stringify({ id: pending.id, result }),
    bytes = Buffer.from(paramsJson),
    identity = deliveryIdentity(paramsJson),
    uploadId = identity.originalId;
  expect(bytes.length).toBe(NATIVE_BUFFER_UPLOAD_LIMITS.maxBytes);
  const initial = await ws.call("native.services.upload.begin", {
    uploadId,
    target,
    byteLength: bytes.length,
    sha256: identity.sha256,
    delivery: identity,
  });
  expect(initial.delivery).toEqual(identity);
  for (let offset = 0; offset < bytes.length; offset += NATIVE_BUFFER_UPLOAD_LIMITS.chunkBytes)
    await ws.call("native.services.upload.append", {
      uploadId,
      offset,
      data: bytes
        .subarray(offset, offset + NATIVE_BUFFER_UPLOAD_LIMITS.chunkBytes)
        .toString("base64"),
    });
  expect(await ws.call("native.services.upload.commit", { uploadId })).toMatchObject({
    state: "completed",
    delivery: identity,
    result: { ...identity, target, state: "recorded", result: { accepted: true } },
  });
  expect(await f.callHttp("native.services.delivery.status", { ...identity, target })).toEqual({
    ...identity,
    target,
    state: "recorded",
    result: { accepted: true },
  });
  const mismatch = await ws.request("native.services.upload.begin", {
    uploadId,
    target,
    byteLength: bytes.length,
    sha256: identity.sha256,
    delivery: { ...identity, originalId: "replacement-original" },
  });
  expect(mismatch.error).toBeDefined();
  expect(await pending.waiting).toEqual(result);
});

it("transfers an actual owner-recorded large formatter result through finite authenticated HTTP/WS chunks", async () => {
  const f = await fixture("2026-10-29-host-native-delivery"),
    ws = await f.connect(),
    target = "native.services.workspace.format";
  const result = { formatted: "Türkçe 😀\n".repeat(150_000), cursorOffset: 1 },
    raw = Buffer.from(JSON.stringify(result));
  const format = vi
    .spyOn(WorkspaceCommands.prototype, "run")
    .mockImplementation(async (command) => {
      if (command !== "format_text_file") throw new Error("Unexpected fixture command");
      return result;
    });
  const paramsJson = JSON.stringify({
      command: "format_text_file",
      args: { path: `${f.projectPath}/source.ts`, source: "source", cursorOffset: 1 },
    }),
    identity = deliveryIdentity(paramsJson);
  const status = await ws.call("native.services.delivery.apply", {
    ...identity,
    target,
    paramsJson,
  });
  expect(status).toEqual({
    ...identity,
    target,
    state: "recorded",
    resultSource: { sha256: deliverySha(raw), byteLength: raw.length },
  });
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < raw.length; offset += 65_536) {
    const request = {
      ...identity,
      target,
      resultSource: status.resultSource,
      offset,
      limit: 65_536,
    };
    const part =
      offset % 131_072 === 0
        ? await ws.call("native.services.delivery.result.read", request)
        : await f.callHttp("native.services.delivery.result.read", request);
    expect(part).toMatchObject({ ...identity, target, resultSource: status.resultSource, offset });
    chunks.push(Buffer.from(part.data, "base64"));
  }
  const received = Buffer.concat(chunks);
  expect(received.length).toBe(raw.length);
  expect(deliverySha(received)).toBe(status.resultSource.sha256);
  expect(format).toHaveBeenCalledTimes(1);
  expect(
    (
      await f.http(
        "native.services.delivery.result.read",
        { ...identity, target, resultSource: status.resultSource, offset: 0, limit: 65_536 },
        f.other.token,
      )
    ).error,
  ).toBeDefined();
  expect(
    (
      await ws.request("native.services.delivery.result.read", {
        ...identity,
        target,
        resultSource: status.resultSource,
        offset: 0,
        limit: 65_537,
      })
    ).error,
  ).toBeDefined();
  expect(format).toHaveBeenCalledTimes(1);
});
