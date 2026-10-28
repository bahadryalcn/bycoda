import { beforeEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  mkdir: vi.fn(),
  resolve: vi.fn(),
  spawn: vi.fn(),
  kill: vi.fn(),
  watch: vi.fn(),
  unwatch: vi.fn(),
  request: vi.fn(),
  notify: vi.fn(),
  close: vi.fn(),
}));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  mkdir: calls.mkdir,
}));
vi.mock("../src/integrations/harness/core/child", () => ({
  resolveCodexBinary: calls.resolve,
  spawnChild: calls.spawn,
  killChild: calls.kill,
  watchChild: calls.watch,
  unwatchChild: calls.unwatch,
}));
vi.mock("../src/integrations/harness/core/jsonRpc", () => ({
  JsonRpcClient: class {
    request = calls.request;
    notify = calls.notify;
    close = calls.close;
    respond = vi.fn();
    pushLine = vi.fn();
  },
}));
import { probeNativeCodexImageCapability } from "./social-images";

beforeEach(() => {
  vi.resetAllMocks();
  calls.mkdir.mockResolvedValue(undefined);
  calls.resolve.mockResolvedValue({ path: "fixture-codex" });
  calls.spawn.mockResolvedValue(undefined);
  calls.kill.mockResolvedValue(undefined);
  calls.request.mockImplementation(async (method: string) => {
    if (method === "config/feature/list")
      return { features: [{ name: "image_generation", enabled: true }] };
    if (method === "account/read") return { account: { type: "fixture" } };
    return {};
  });
});

it("does not create a workspace or launch a native process without current authority", async () => {
  const revoked = Object.assign(new Error("revoked"), { code: "HOST_AUTH_REVOKED" });
  await expect(
    probeNativeCodexImageCapability("fixture", async () => {
      throw revoked;
    }),
  ).rejects.toBe(revoked);
  expect(calls.mkdir).not.toHaveBeenCalled();
  expect(calls.spawn).not.toHaveBeenCalled();
  expect(calls.request).not.toHaveBeenCalled();
});

it("rechecks after asynchronous binary discovery before native spawn", async () => {
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((done) => {
    entered = done;
  });
  const held = new Promise<void>((done) => {
    release = done;
  });
  calls.resolve.mockImplementation(async () => {
    entered();
    await held;
    return { path: "fixture-codex" };
  });
  let allowed = true;
  const guard = async () => {
    if (!allowed) throw new Error("revoked during discovery");
  };
  const pending = probeNativeCodexImageCapability("fixture", guard).catch((error) => error);
  await started;
  allowed = false;
  release();
  expect((await pending).message).toBe("revoked during discovery");
  expect(calls.mkdir).toHaveBeenCalledOnce();
  expect(calls.spawn).not.toHaveBeenCalled();
  expect(calls.request).not.toHaveBeenCalled();
});

it("does not read account data after authority is revoked during a feature RPC", async () => {
  let allowed = true;
  calls.request.mockImplementation(async (method: string) => {
    if (method === "config/feature/list") {
      allowed = false;
      return { features: [] };
    }
    return {};
  });
  await expect(
    probeNativeCodexImageCapability("fixture", async () => {
      if (!allowed) throw new Error("revoked after feature read");
    }),
  ).rejects.toThrow("revoked after feature read");
  expect(calls.request.mock.calls.map(([method]) => method)).toEqual([
    "initialize",
    "config/feature/list",
  ]);
  expect(calls.kill).toHaveBeenCalledOnce();
});

it("retains legacy no-grant capability checks and ordinary unavailable results", async () => {
  expect(await probeNativeCodexImageCapability("fixture")).toMatchObject({
    provider: "codex",
    available: true,
  });
  calls.resolve.mockRejectedValueOnce(new Error("runtime absent"));
  expect(await probeNativeCodexImageCapability("fixture")).toMatchObject({ available: false });
});
