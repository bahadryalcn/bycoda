import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { DeviceHost } from "../../devices/device-host";
import { DevicePreviews } from "../../devices/device-preview";
import { RPC_ERROR_CODES } from "../../../src/shared/model/host-contracts";
import { fixture, sha } from "../../devices/native-devices.test-support";

// This entry imports DevicePreviews directly; register its manifest fixture
// before that import rather than relying on a later helper-module mock.
vi.mock("../../devices/expo-go", async (original) => ({
  ...(await original<typeof import("../../devices/expo-go")>()),
  expoManifest: async () => ({ sdkVersion: "53.0.0" }),
}));

const evidenceId = "2026-10-29-device-lifecycle-host";
async function mobileFixture() {
  const f = await fixture(evidenceId),
    status = await f.callHttp("devices.status");
  vi.spyOn(DeviceHost.prototype, "status").mockResolvedValue({ ...status, running: true });
  const prepare = vi
    .spyOn(DeviceHost.prototype, "prepareExpo")
    .mockResolvedValue({ app: "host.exp.exponent" } as any);
  vi.spyOn(DeviceHost.prototype, "openExpo").mockResolvedValue(undefined);
  return { ...f, prepare };
}
const intent = (projectId: string) => ({
  projectId,
  requestId: randomUUID(),
  deviceId: "emulator-5554",
  url: "exp://127.0.0.1:8081",
  installExpoGo: false,
});
async function ready(
  channel: { call(method: string, params?: unknown): Promise<any> },
  params: { projectId: string; requestId: string },
) {
  let result: any;
  await vi.waitFor(
    async () => {
      result = await channel.call("devices.preview.mobile.status", {
        projectId: params.projectId,
        requestId: params.requestId,
        includeFrame: true,
      });
      expect(result.state, JSON.stringify(result.stages)).toBe("ready");
    },
    { timeout: 10000, interval: 10 },
  );
  return result;
}

it("routes actual paired-owner setup and stop through HTTP/WS with explicit agent consent and preserved setup budget", async () => {
  const f = await fixture(evidenceId),
    ws = await f.connect();
  const npm = join(f.root, "node_modules", "npm", "bin");
  await mkdir(npm, { recursive: true });
  await writeFile(join(npm, "npm-cli.js"), "fixture, never executed");
  vi.spyOn(DeviceHost.prototype as any, "nodePath", "get").mockReturnValue(
    join(f.root, "node.exe"),
  );
  const setup = vi.spyOn(DeviceHost.prototype, "setup"),
    stop = vi.spyOn(DeviceHost.prototype, "stop"),
    timer = vi.spyOn(globalThis, "setTimeout");
  const first = await f.callHttp("devices.setup", { projectId: f.project.id, agentAccess: false });
  expect(await ws.call("devices.setup", { projectId: f.project.id, agentAccess: false })).toEqual(
    first,
  );
  await ws.call("devices.setup", { agentAccess: true });
  expect(timer.mock.calls.map((call) => call[1])).toContain(1230000);
  timer.mockRestore();
  expect(setup.mock.calls.map((call) => call[0])).toEqual([false, false, true]);
  for (const [, effect] of setup.mock.calls) expect(await effect!.authorized()).toBe(true);
  expect(await ws.call("devices.stop", { projectId: f.project.id })).toEqual(
    await f.callHttp("devices.stop", { projectId: f.project.id }),
  );
  expect(stop).toHaveBeenCalledTimes(2);
  expect((await ws.request("devices.setup", { agentAccess: "yes" })).error.code).toBe(
    RPC_ERROR_CODES.invalidParams,
  );
  expect((await f.http("devices.setup", {})).error).toContain("Choose whether");
  expect((await f.http("devices.setup", {})).delivery).toBe("not-sent");
  expect(f.command).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.arrayContaining(["install"]),
    expect.anything(),
  );
});

it("retains unknown HTTP delivery when the original paired owner revokes after setup queue admission", async () => {
  const f = await fixture(evidenceId);
  let began!: () => void, finish!: () => void;
  const started = new Promise<void>((done) => {
      began = done;
    }),
    held = new Promise<void>((done) => {
      finish = done;
    });
  const status = DeviceHost.prototype.status;
  vi.spyOn(DeviceHost.prototype, "status").mockImplementation(async function (effect) {
    began();
    await held;
    return status.call(this, effect);
  });
  const pending = f.http("devices.setup", { projectId: f.project.id, agentAccess: false });
  await started;
  await f.store.revokeDevice(f.device.id);
  finish();
  const reply = await pending;
  expect(reply.result).toBeUndefined();
  expect(reply.delivery).toBe("unknown");
  expect(reply.code).toBe("HOST_DEVICE_OPERATION_UNCONFIRMED");
  expect(f.command).not.toHaveBeenCalled();
  const denied = await f.http("devices.setup", { agentAccess: false });
  expect(denied.status).toBe(401);
  expect(denied.delivery).toBeUndefined();
});

it("preserves HTTP401 with unknown delivery for a known final owner-auth failure after stop returned", async () => {
  const f = await fixture(evidenceId);
  let began!: () => void, finish!: () => void;
  const started = new Promise<void>((done) => {
      began = done;
    }),
    held = new Promise<void>((done) => {
      finish = done;
    });
  const stop = DeviceHost.prototype.stop;
  vi.spyOn(DeviceHost.prototype, "stop").mockImplementation(async function (effect) {
    const result = await stop.call(this, effect);
    began();
    await held;
    return result;
  });
  const pending = f.http("devices.stop", { projectId: f.project.id });
  await started;
  await f.store.revokeDevice(f.device.id);
  finish();
  const reply = await pending;
  expect(reply).toMatchObject({
    status: 401,
    delivery: "unknown",
    code: "HOST_DEVICE_OPERATION_UNCONFIRMED",
  });
  expect(reply.result).toBeUndefined();
  const denied = await f.http("devices.stop", { projectId: f.project.id });
  expect(denied.status).toBe(401);
  expect(denied.delivery).toBeUndefined();
});

it("keeps the exact existing mobile owner namespace across HTTP/WS and discloses full guarded frames", async () => {
  const f = await mobileFixture(),
    ws = await f.connect(),
    first = intent(f.project.id),
    start = vi.spyOn(DevicePreviews.prototype, "start"),
    summary = vi.spyOn(DevicePreviews.prototype, "mobileStatus");
  const admitted = await f.callHttp("devices.preview.mobile.start", first);
  const completed = await ready(ws, first);
  expect(completed.id).toBe(admitted.id);
  expect(sha(Buffer.from(completed.frame.base64, "base64"))).toBe(sha(f.png));
  expect(start.mock.calls[0][1]).toBe(
    `mobile:${createHash("sha256").update(f.device.token).digest("hex")}:${f.project.id}`,
  );
  expect(f.prepare.mock.calls[0][2]).toBe(false);
  expect(summary.mock.calls.every((call) => call[2] === false)).toBe(true);
  const next = intent(f.project.id);
  await ws.call("devices.preview.mobile.start", next);
  const queried = await ready({ call: f.callHttp }, next);
  expect(sha(Buffer.from(queried.frame.base64, "base64"))).toBe(sha(f.png));
  expect((await ws.call("environment.describe")).capabilities).toEqual(
    expect.arrayContaining(["devices.preview.mobile.v1", "transport.ws.devices.preview.mobile.v1"]),
  );
});

it("requires exact status identity and retains original cwd/principal through inline and bulk disclosure", async () => {
  const f = await mobileFixture(),
    ws = await f.connect(),
    original = intent(f.project.id);
  const admitted = await ws.call("devices.preview.mobile.start", original);
  await ready(ws, original);
  const params = {
    projectId: f.project.id,
    id: admitted.id,
    requestId: original.requestId,
    includeFrame: true,
  };
  for (const invalid of [
    { projectId: f.project.id },
    { ...params, requestId: "different" },
    { ...params, id: "bad/id" },
    { ...params, owner: "forged" },
  ])
    expect((await ws.request("devices.preview.mobile.status", invalid)).error).toBeTruthy();
  const foreign = await f.connect(f.other.token);
  expect((await foreign.request("devices.preview.mobile.status", params)).error).toBeTruthy();
  const descriptor = (await ws.request("devices.preview.mobile.status", params)).result.$bulk;
  await f.store.db
    .prepare("UPDATE projects SET cwd=? WHERE id=?")
    .run(join(f.root, "replacement"), f.project.id);
  expect(await f.store.authenticated(f.device.token)).toBe(true);
  const chunk = await fetch(`${f.endpoint}/ws-bulk/${descriptor.transferId}?offset=0`, {
    headers: { Authorization: `Bearer ${f.device.token}` },
  });
  expect(chunk.status).toBe(404);
  expect((await chunk.arrayBuffer()).byteLength).toBe(0);
  expect((await ws.request("devices.preview.mobile.status", params)).error).toBeTruthy();
  expect((await f.http("devices.preview.mobile.status", params)).error).toBeTruthy();
});

it("returns only the correct owner's active rows and keeps global stop blocked without disclosing other job metadata", async () => {
  const f = await mobileFixture(),
    ws = await f.connect();
  let began!: () => void, finish!: () => void;
  const started = new Promise<void>((done) => {
      began = done;
    }),
    held = new Promise<void>((done) => {
      finish = done;
    });
  f.prepare.mockImplementation(async () => {
    began();
    await held;
    return { app: "host.exp.exponent" } as any;
  });
  const request = intent(f.project.id),
    admitted = await ws.call("devices.preview.mobile.start", request);
  await started;
  try {
    const owned = await ws.call("devices.preview.impact", { projectId: f.project.id });
    expect(owned).toEqual({
      activeCount: 1,
      owned: [{ id: admitted.id, deviceId: request.deviceId, state: "running" }],
      otherActiveCount: 0,
    });
    const otherPath = join(f.root, "other");
    await mkdir(otherPath);
    const otherProject = await f.engine.openProject(otherPath),
      foreign = await f.connect(f.other.token);
    for (const [channel, projectId] of [
      [ws, otherProject.id],
      [foreign, f.project.id],
    ] as const)
      expect(await channel.call("devices.preview.impact", { projectId })).toEqual({
        activeCount: 1,
        owned: [],
        otherActiveCount: 1,
      });
    const stop = vi.spyOn(DeviceHost.prototype, "stop");
    expect(
      (await ws.request("devices.stop", { projectId: f.project.id })).error.data,
    ).toMatchObject({
      delivery: "not-sent",
      retryable: false,
    });
    expect(stop).not.toHaveBeenCalled();
    await f.store.db
      .prepare("UPDATE projects SET cwd=? WHERE id=?")
      .run(join(f.root, "replacement"), f.project.id);
    expect(await ws.call("devices.preview.impact", { projectId: f.project.id })).toEqual({
      activeCount: 1,
      owned: [],
      otherActiveCount: 1,
    });
  } finally {
    finish();
  }
});

it("does not widen scoped Conversation Tools to paired-owner lifecycle or mobile methods", async () => {
  const f = await fixture(evidenceId),
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
  const stop = vi.spyOn(DeviceHost.prototype, "stop"),
    setup = vi.spyOn(DeviceHost.prototype, "setup");
  for (const action of [
    "devices.setup",
    "devices.stop",
    "devices.preview.mobile.start",
    "devices.preview.mobile.status",
    "devices.preview.impact",
  ]) {
    expect(
      (await f.http(action, { projectId: f.project.id, agentAccess: false }, grant.token)).error,
    ).toContain("Conversation Tools");
    expect(
      (await f.http("conversation.tools.call", { action, input: {} }, grant.token)).error,
    ).toBeTruthy();
  }
  expect(stop).not.toHaveBeenCalled();
  expect(setup).not.toHaveBeenCalled();
});
