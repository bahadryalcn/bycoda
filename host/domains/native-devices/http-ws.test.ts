import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { DeviceHost } from "../../device-host";
import { RPC_ERROR_CODES, WS_LIMITS } from "../../../src/shared/model/host-contracts";
import { fixture, sha } from "../../native-devices.test-support";

it("routes actual DeviceHost inventory, preflight, boot, action and four-MiB capture through shared HTTP and WS", async () => {
  const f = await fixture(),
    ws = await f.connect();
  for (const method of ["devices.status", "devices.list", "devices.preflight", "devices.boot"]) {
    const params =
      method.endsWith("preflight") || method.endsWith("boot") ? { deviceId: "emulator-5554" } : {};
    expect(await ws.call(method, params)).toEqual(await f.callHttp(method, params));
  }
  const frame = await ws.call("devices.capture", { deviceId: "emulator-5554" });
  const image = Buffer.from(frame.base64, "base64");
  expect(image.length).toBe(f.png.length);
  expect(sha(image)).toBe(sha(f.png));
  expect(await f.callHttp("devices.capture", { deviceId: "emulator-5554" })).toEqual(frame);
  const action = await ws.call("devices.action", {
    deviceId: "emulator-5554",
    action: { type: "snapshot" },
  });
  expect(JSON.parse(action).data.xml).toBe(f.xml);
  expect(Buffer.byteLength(JSON.stringify(action))).toBeGreaterThan(WS_LIMITS.maxMessageBytes);
  expect(
    await f.callHttp("devices.action", { deviceId: "emulator-5554", action: { type: "snapshot" } }),
  ).toBe(action);
  // Existing start's already-running path retains the actual exclusive owner lane.
  const status = await f.callHttp("devices.status");
  vi.spyOn(DeviceHost.prototype, "status").mockResolvedValue({ ...status, running: true });
  expect(await ws.call("devices.start")).toEqual({ ...status, running: true });
  expect(await f.callHttp("devices.start")).toEqual({ ...status, running: true });
});

async function previewFixture() {
  const f = await fixture();
  const status = await f.callHttp("devices.status");
  vi.spyOn(DeviceHost.prototype, "status").mockResolvedValue({ ...status, running: true });
  vi.spyOn(DeviceHost.prototype, "prepareExpo").mockResolvedValue({
    app: "host.exp.exponent",
  } as any);
  vi.spyOn(DeviceHost.prototype, "openExpo").mockResolvedValue(undefined);
  return f;
}
async function ready(
  f: Awaited<ReturnType<typeof fixture>>,
  channel: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["connect"]>>,
  expires?: number,
) {
  const admitted = await channel.call("devices.preview", {
    requestId: randomUUID(),
    deviceId: "emulator-5554",
    url: "exp://127.0.0.1:8081",
    previewOwner: "env:" + "session".repeat(70),
    ...(expires === undefined ? {} : { previewExpiresAt: expires }),
  });
  let result: any;
  await vi.waitFor(
    async () => {
      result = await channel.call("devices.preview.status", {
        id: admitted.id,
        previewOwner: "env:" + "session".repeat(70),
        includeFrame: true,
      });
      expect(result.state, JSON.stringify(result.stages)).toBe("ready");
    },
    { timeout: 10000, interval: 10 },
  );
  const image = Buffer.from(result.frame.base64, "base64");
  expect(image.length).toBe(f.png.length);
  expect(sha(image)).toBe(sha(f.png));
  return result;
}
it("retains original preview expiry after completion and through each actual bulk HTTP fetch with a still-live paired token", async () => {
  const f = await previewFixture(),
    ws = await f.connect();
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const preview = await ready(f, ws, now + 30000);
  const params = {
    id: preview.id,
    previewOwner: "env:" + "session".repeat(70),
    includeFrame: true,
  };
  const descriptor = (await ws.request("devices.preview.status", params)).result.$bulk;
  expect(descriptor.totalBytes).toBeGreaterThan(5 * 1024 * 1024);
  const foreign = await f.connect(f.other.token);
  expect((await foreign.request("devices.preview.status", params)).error).toBeTruthy();
  now += 30001;
  expect(await f.store.authenticated(f.device.token)).toBe(true);
  const chunk = await fetch(`${f.endpoint}/ws-bulk/${descriptor.transferId}?offset=0`, {
    headers: { Authorization: `Bearer ${f.device.token}` },
  });
  expect(chunk.status).toBe(404);
  expect((await chunk.arrayBuffer()).byteLength).toBe(0);
  expect((await ws.request("devices.preview.status", params)).error).toBeTruthy();
  expect((await f.http("devices.preview.status", params)).error).toBeTruthy();
});
it("rejects forged/malformed/environment-mismatched calls before any device effect and keeps original owner on reenrollment", async () => {
  const f = await previewFixture(),
    ws = await f.connect();
  const preview = await ready(f, ws),
    before = f.binary.mock.calls.length;
  expect(
    (await ws.request("devices.capture", { deviceId: "emulator-5554", owner: "forged" })).error
      .code,
  ).toBe(RPC_ERROR_CODES.invalidParams);
  expect(
    (
      await ws.request("devices.action", {
        deviceId: "emulator-5554",
        action: { type: "shell", command: "echo x" },
      })
    ).error,
  ).toBeTruthy();
  expect(
    (await ws.request("native.devices.capture", { deviceId: "emulator-5554" })).error.code,
  ).toBe(RPC_ERROR_CODES.methodNotFound);
  expect(
    (await ws.request("devices.capture", { deviceId: "emulator-5554", projectId: "absent" })).error,
  ).toBeTruthy();
  expect(
    (await f.http("devices.capture", { deviceId: "emulator-5554" }, f.device.token, "wrong-host"))
      .error,
  ).toContain("Host identity changed");
  expect(f.binary.mock.calls.length).toBe(before);
  await f.store.revokeDevice(f.device.id);
  const enrolled = await f.store.issueDevice("Same owner reenrolled"),
    fresh = await f.connect(enrolled.token);
  expect(
    (
      await fresh.request("devices.preview.status", {
        id: preview.id,
        previewOwner: "env:" + "session".repeat(70),
        includeFrame: true,
      })
    ).error,
  ).toBeTruthy();
});
it("keeps admitted input alive after socket loss and never resends it on reconnect", async () => {
  const f = await fixture(),
    ws = await f.connect();
  const original = f.command.getMockImplementation()!;
  let began!: () => void, finish!: () => void;
  const started = new Promise<void>((done) => {
      began = done;
    }),
    held = new Promise<void>((done) => {
      finish = done;
    });
  let taps = 0;
  f.command.mockImplementation(async (exe, args, options) => {
    if (args.includes("tap")) {
      taps++;
      began();
      await held;
    }
    return original(exe, args, options);
  });
  const pending = ws
    .request("devices.action", { deviceId: "emulator-5554", action: { type: "press", x: 1, y: 2 } })
    .catch(() => undefined);
  await started;
  ws.socket.terminate();
  finish();
  await pending;
  const fresh = await f.connect();
  await fresh.call("devices.list");
  expect(taps).toBe(1);
});

it("keeps real scoped Conversation Tools grants outside the paired-owner Device9 port", async () => {
  const f = await fixture(),
    ws = await f.connect();
  const receipt = await f.engine.command({
    type: "create",
    workspaceMode: "current",
    commandId: randomUUID(),
    projectId: f.project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  const grant = await ws.call("native.services.conversation.access.issue", {
    sessionId: receipt.sessionId,
  });
  expect(
    (await f.http("devices.capture", { deviceId: "emulator-5554" }, grant.token)).error,
  ).toContain("Conversation Tools");
  const scoped = await f.http(
    "conversation.tools.call",
    { action: "devices.list", input: {} },
    grant.token,
  );
  expect(scoped.error).toBeUndefined();
  expect(scoped.result.devices[0].id).toBe("emulator-5554");
  await expect(f.connect(grant.token)).rejects.toThrow();
  expect(f.binary).not.toHaveBeenCalled();
});
it("suppresses a frame when the real paired owner revokes during an admitted capture", async () => {
  const f = await fixture(),
    ws = await f.connect();
  let began!: () => void, finish!: () => void;
  const started = new Promise<void>((done) => {
      began = done;
    }),
    held = new Promise<void>((done) => {
      finish = done;
    });
  f.binary.mockImplementation(async () => {
    began();
    await held;
    return f.png;
  });
  const pending = ws
    .request("devices.capture", { deviceId: "emulator-5554" })
    .catch(() => undefined);
  await started;
  await f.store.revokeDevice(f.device.id);
  finish();
  const reply = await pending;
  expect(reply?.result).toBeUndefined();
  if (reply) expect(reply.error.data).toMatchObject({ delivery: "unknown", retryable: false });
  expect(f.binary).toHaveBeenCalledOnce();
});

it("cancels only the capture waiter, retains accepted IO until settlement, and reports unknown delivery", async () => {
  const f = await fixture(),
    ws = await f.connect();
  let began!: () => void, finish!: () => void, settled!: () => void;
  const started = new Promise<void>((done) => {
      began = done;
    }),
    held = new Promise<void>((done) => {
      finish = done;
    }),
    completed = new Promise<void>((done) => {
      settled = done;
    });
  f.binary.mockImplementation(async () => {
    began();
    await held;
    settled();
    return f.png;
  });
  const pending = ws.request("devices.capture", { deviceId: "emulator-5554" }, "owned-capture");
  await started;
  expect(
    (await ws.request("requests.cancel", { requestId: "owned-capture" })).result.accepted,
  ).toBe(true);
  expect((await pending).error.data).toMatchObject({
    category: "cancelled",
    delivery: "unknown",
    retryable: false,
  });
  finish();
  await completed;
  await ws.call("devices.list");
  expect(f.binary).toHaveBeenCalledOnce();
});
