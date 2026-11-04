import { describe, it, expect, vi } from "vitest";
import { DevicePreviews, DEVICE_PREVIEW_RECEIPT_TTL_MS } from "./device-preview";
import type { DeviceHost } from "./device-host";
const input = {
  requestId: "request",
  deviceId: "sim",
  url: "exp://127.0.0.1:8081",
  expectedText: "Kilidi aç",
};
function fixture(now?: () => number) {
  let confirmed = false;
  const host = {
    preflight: vi.fn().mockResolvedValue({
      device: { id: "sim", name: "iPhone", platform: "ios", booted: true },
      checks: { sdk: true, tools: true, agentControl: true },
    }),
    status: vi.fn().mockResolvedValue({ running: true }),
    start: vi.fn(),
    boot: vi.fn(),
    prepareExpo: vi.fn().mockResolvedValue({ app: "host.exp.Exponent" }),
    openExpo: vi.fn().mockResolvedValue(undefined),
    action: vi.fn().mockImplementation(async (_id, action) => {
      if (action.type === "pressElement") confirmed = true;
      return action.type === "snapshot"
        ? JSON.stringify({
            success: true,
            data: {
              nodes: confirmed
                ? []
                : [
                    { type: "Alert", label: "Expo Go ile açılsın mı?" },
                    { type: "Button", label: "Aç", hittable: true },
                  ],
            },
          })
        : '{"success":true}';
    }),
    capture: vi
      .fn()
      .mockResolvedValue({ mime: "image/png", base64: "aW1hZ2U=", capturedAt: "now" }),
  };
  const previews = new DevicePreviews(
    host as unknown as DeviceHost,
    vi.fn().mockResolvedValue({ sdkVersion: "57.0.0" }),
    undefined,
    now,
  );
  return { host, previews };
}

async function settlePreview(previews: DevicePreviews, id: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = previews.status(id, "owner");
    if (value.state === "ready" || value.state === "blocked") return value;
    await Promise.resolve();
  }
  throw new Error("Fixture preview did not settle");
}

describe("device preview receipt retirement", () => {
  it("admits more than 128 completed jobs without replaying an expired request", async () => {
    let now = 0;
    const { host, previews } = fixture(() => now);
    for (let index = 0; index < 260; index++) {
      const job = previews.start({ ...input, requestId: `preview-${index}` }, "owner");
      expect((await settlePreview(previews, job.id)).state).toBe("ready");
      now += DEVICE_PREVIEW_RECEIPT_TTL_MS;
    }
    expect(host.openExpo).toHaveBeenCalledTimes(260);
    expect(() => previews.start({ ...input, requestId: "preview-0" }, "owner")).toThrow(
      "PREVIEW_RECEIPT_EXPIRED",
    );
    expect(host.openExpo).toHaveBeenCalledTimes(260);
  });

  it("retains pending and unknown-effect jobs regardless of elapsed time", async () => {
    let now = 0;
    const { host, previews } = fixture(() => now);
    let finish!: () => void;
    host.openExpo.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = previews.start(input, "owner");
    for (let index = 0; index < 100 && !finish; index++) await Promise.resolve();
    expect(finish).toBeDefined();
    now += DEVICE_PREVIEW_RECEIPT_TTL_MS * 10;
    expect(previews.start(input, "owner").id).toBe(pending.id);
    expect(previews.status(pending.id, "owner").state).toBe("running");
    finish();
    expect((await settlePreview(previews, pending.id)).state).toBe("ready");
    host.openExpo.mockRejectedValueOnce(new Error("RPC_TIMEOUT: launch outcome unknown"));
    const unknownInput = { ...input, requestId: "unknown" };
    const unknown = previews.start(unknownInput, "owner");
    expect((await settlePreview(previews, unknown.id)).state).toBe("blocked");
    now += DEVICE_PREVIEW_RECEIPT_TTL_MS * 10;
    expect(previews.start(unknownInput, "owner").id).toBe(unknown.id);
    expect(previews.status(unknown.id, "owner").state).toBe("blocked");
    expect(host.openExpo).toHaveBeenCalledTimes(2);
  });

  it("retires completed preflight failures but keeps their request IDs fenced", async () => {
    let now = 0;
    const { host, previews } = fixture(() => now);
    const job = previews.start(input, "owner", () => false);
    expect((await settlePreview(previews, job.id)).state).toBe("blocked");
    now += DEVICE_PREVIEW_RECEIPT_TTL_MS;
    expect(() => previews.start(input, "owner", () => true)).toThrow("PREVIEW_RECEIPT_EXPIRED");
    expect(host.preflight).not.toHaveBeenCalled();
    expect(host.openExpo).not.toHaveBeenCalled();
  });

  it("expires frame authority and preserves the same receipt until the TTL boundary", async () => {
    let now = 0;
    const { previews } = fixture(() => now);
    const job = previews.start(input, "owner");
    await settlePreview(previews, job.id);
    const authority = previews.resultAuthority(job.id, "owner");
    now = DEVICE_PREVIEW_RECEIPT_TTL_MS - 1;
    expect(await authority()).toBe(true);
    expect(previews.start(input, "owner").id).toBe(job.id);
    now++;
    expect(await authority()).toBe(false);
    expect(() => previews.status(job.id, "owner", true)).toThrow("PREVIEW_NOT_FOUND");
    expect(() => previews.start(input, "owner")).toThrow("PREVIEW_RECEIPT_EXPIRED");
  });

  it("revokes delayed frame disclosure when the TTL passes during authorization", async () => {
    let now = 0;
    let held = false;
    let resume!: (allowed: boolean) => void;
    const { previews } = fixture(() => now);
    const job = previews.start(input, "owner", () =>
      held
        ? new Promise<boolean>((resolve) => {
            resume = resolve;
          })
        : true,
    );
    await settlePreview(previews, job.id);
    const authority = previews.resultAuthority(job.id, "owner");
    now = DEVICE_PREVIEW_RECEIPT_TTL_MS - 1;
    held = true;
    const disclosure = authority();
    expect(resume).toBeDefined();
    now++;
    resume(true);
    expect(await disclosure).toBe(false);
    expect(() => previews.status(job.id, "owner", true)).toThrow("PREVIEW_NOT_FOUND");
  });
});
describe("observable device previews", () => {
  it("retains the accepted target and launch input across an asynchronous authority wait", async () => {
    const { host, previews } = fixture();
    let release!: () => void;
    const held = new Promise<void>((ready) => {
      release = ready;
    });
    const mutable = { ...input };
    const job = previews.start(mutable, "owner", async () => {
      await held;
      return true;
    });
    mutable.deviceId = "foreign-target";
    mutable.url = "exp://127.0.0.1:8082";
    release();
    await vi.waitFor(() => expect(previews.status(job.id, "owner").state).toBe("ready"));
    expect(host.preflight.mock.calls.every(([id]) => id === "sim")).toBe(true);
    expect(host.openExpo).toHaveBeenCalledWith(
      "sim",
      input.url,
      expect.objectContaining({ authorized: expect.any(Function) }),
    );
    expect(previews.start(input, "owner").id).toBe(job.id);
  });
  it("retains the original job authority after completion and refuses fresh-authority rejoin", async () => {
    const { host, previews } = fixture();
    let authorized = true;
    const job = previews.start(input, "owner", () => authorized);
    await vi.waitFor(() => expect(previews.status(job.id, "owner").state).toBe("ready"));
    const original = previews.resultAuthority(job.id, "owner");
    expect(previews.resultAuthority(job.id, "owner")).toBe(original);
    expect(await original()).toBe(true);
    expect(await previews.authorizedStatus(job.id, "owner", true, () => true)).toHaveProperty(
      "frame",
    );
    const effects = host.action.mock.calls.length;
    authorized = false;
    expect(previews.start(input, "owner", () => true).id).toBe(job.id);
    await expect(previews.authorizedStatus(job.id, "owner", true, () => true)).rejects.toThrow(
      "PREVIEW_AUTHORITY_REVOKED",
    );
    expect(await original()).toBe(false);
    expect(host.action).toHaveBeenCalledTimes(effects);
    expect(() => previews.resultAuthority(job.id, "foreign")).toThrow("PREVIEW_SCOPE_MISMATCH");
  });
  it("checks original authority after an awaited current request check before frame disclosure", async () => {
    const { previews } = fixture();
    let authorized = true;
    const job = previews.start(input, "owner", () => authorized);
    await vi.waitFor(() => expect(previews.status(job.id, "owner").state).toBe("ready"));
    let release!: () => void;
    const held = new Promise<void>((ready) => {
      release = ready;
    });
    const read = previews.authorizedStatus(job.id, "owner", true, async () => {
      await held;
      return true;
    });
    const rejected = expect(read).rejects.toThrow("PREVIEW_AUTHORITY_REVOKED");
    authorized = false;
    release();
    await rejected;
    const authority = previews.resultAuthority(job.id, "owner");
    authorized = true;
    await previews.dispose();
    expect(await authority()).toBe(false);
  });
  it("does not publish a frame if authority expires while its capture settles", async () => {
    const { host, previews } = fixture();
    let authorized = true;
    host.capture.mockImplementationOnce(async () => {
      authorized = false;
      return { mime: "image/png", base64: "private-frame", capturedAt: "now" };
    });
    const job = previews.start(input, "owner", () => authorized);
    await vi.waitFor(() => expect(previews.status(job.id, "owner").state).toBe("blocked"));
    expect(previews.status(job.id, "owner", true)).not.toHaveProperty("frame");
    expect(await previews.resultAuthority(job.id, "owner")()).toBe(false);
    expect(host.capture).toHaveBeenCalledOnce();
  });
  it("joins asynchronous authority checks on disposal and blocks the next device effect", async () => {
    const { host, previews } = fixture();
    let release!: () => void;
    let checked!: () => void;
    const started = new Promise<void>((resolve) => {
      checked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const job = previews.start(input, "owner", async () => {
      checked();
      await gate;
      return true;
    });
    await started;
    const closing = previews.dispose();
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    await closing;
    expect(previews.status(job.id, "owner").state).toBe("blocked");
    expect(host.preflight).not.toHaveBeenCalled();
    expect(host.action).not.toHaveBeenCalled();
  });
  it("reconciles only an exact owned request and hides foreign active identity from stop impact", async () => {
    const { host, previews } = fixture();
    let finish!: (value: unknown) => void;
    host.preflight.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const job = previews.start(input, "owner");
    expect(previews.mobileStatus("owner", { requestId: input.requestId })).toMatchObject({
      id: job.id,
      requestId: input.requestId,
    });
    expect(() => previews.mobileStatus("other", { id: job.id })).toThrow("PREVIEW_NOT_FOUND");
    expect(() => previews.mobileStatus("owner", { id: job.id, requestId: "wrong" })).toThrow(
      "PREVIEW_NOT_FOUND",
    );
    expect(previews.stopImpact("other")).toEqual({
      activeCount: 1,
      owned: [],
      otherActiveCount: 1,
    });
    expect(previews.stopImpact("owner")).toEqual({
      activeCount: 1,
      owned: [{ id: job.id, deviceId: "sim", state: "running" }],
      otherActiveCount: 0,
    });
    const stop = vi.fn(async () => undefined);
    await expect(previews.stopIdle(stop)).rejects.toThrow("PREVIEW_BUSY");
    expect(stop).not.toHaveBeenCalled();
    finish({
      device: { id: "sim", platform: "ios", booted: true },
      checks: { sdk: true, tools: true, agentControl: true },
    });
    await vi.waitFor(() => expect(previews.status(job.id, "owner").state).toBe("ready"));
    expect(previews.mobileStatus("owner", { requestId: input.requestId })).not.toHaveProperty(
      "frame",
    );
    expect(previews.mobileStatus("owner", { id: job.id }, true)).toHaveProperty("frame");
  });
  it("holds the stop lease across async stop completion and releases it after a failed stop", async () => {
    const { previews } = fixture();
    let finish!: () => void;
    const stopping = previews.stopIdle(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    expect(() => previews.start(input, "owner")).toThrow("PREVIEW_HOST_STOPPING");
    await expect(previews.stopIdle(async () => undefined)).rejects.toThrow("PREVIEW_HOST_STOPPING");
    finish();
    await stopping;
    await expect(
      previews.stopIdle(async () => {
        throw new Error("Stop failed");
      }),
    ).rejects.toThrow("Stop failed");
    const job = previews.start(input, "owner");
    await vi.waitFor(() => expect(previews.status(job.id, "owner").state).toBe("ready"));
  });
  it("deduplicates setup, verifies content and keeps frame reads in their conversation", async () => {
    const { host, previews } = fixture();
    const first = previews.start(input, "owner");
    expect(previews.start(input, "owner").id).toBe(first.id);
    expect(
      previews.start(
        {
          url: input.url,
          expectedText: input.expectedText,
          deviceId: input.deviceId,
          requestId: input.requestId,
          installExpoGo: false,
        },
        "owner",
      ).id,
    ).toBe(first.id);
    expect(() => previews.start({ ...input, url: "exp://127.0.0.1:8082" }, "owner")).toThrow(
      "PREVIEW_REQUEST_CONFLICT",
    );
    await vi.waitFor(() => expect(previews.status(first.id, "owner").state).toBe("ready"));
    expect(host.prepareExpo).toHaveBeenCalledOnce();
    expect(host.action).toHaveBeenCalledWith(
      "sim",
      { type: "pressElement", label: "Aç" },
      expect.objectContaining({ authorized: expect.any(Function) }),
    );
    expect(host.action).toHaveBeenCalledWith(
      "sim",
      {
        type: "waitForText",
        text: "Kilidi aç",
        timeoutMs: 120000,
      },
      expect.objectContaining({ authorized: expect.any(Function) }),
    );
    expect(previews.status(first.id, "owner")).not.toHaveProperty("frame");
    expect(previews.status(first.id, "owner", true)).toHaveProperty("frame.mime", "image/png");
    expect(() => previews.status(first.id, "other", true)).toThrow("PREVIEW_SCOPE_MISMATCH");
    expect(previews.status(first.id, "owner").stages.map((item) => item.state)).toEqual(
      Array(8).fill("done"),
    );
  });
  it("reports the failing stage without opening an app or enabling permissions", async () => {
    const { host, previews } = fixture();
    host.prepareExpo.mockRejectedValue(
      new Error("EXPO_GO_SETUP_REQUIRED: Install compatible Expo Go."),
    );
    const job = previews.start(input, "owner");
    await vi.waitFor(() => expect(previews.status(job.id, "owner").state).toBe("blocked"));
    expect(previews.status(job.id, "owner").stages.at(-1)).toMatchObject({
      name: "expo-go",
      code: "EXPO_GO_SETUP_REQUIRED",
      state: "blocked",
    });
    expect(host.action).not.toHaveBeenCalled();
    expect(host.capture).not.toHaveBeenCalled();
  });
  it("stops later stages when conversation authority is revoked", async () => {
    const { host, previews } = fixture();
    let allowed = true;
    host.prepareExpo.mockImplementation(async () => {
      allowed = false;
      return { app: "host.exp.Exponent" };
    });
    const job = previews.start(input, "owner", () => allowed);
    await vi.waitFor(() => expect(previews.status(job.id, "owner").state).toBe("blocked"));
    expect(previews.status(job.id, "owner").stages.at(-1)?.code).toBe("PREVIEW_AUTHORITY_REVOKED");
    expect(host.action).not.toHaveBeenCalled();
  });
  it("does not describe launch-only acceptance as verified app content", async () => {
    const { host, previews } = fixture();
    const { expectedText: _, ...launch } = input;
    const job = previews.start(launch, "owner");
    await vi.waitFor(() => expect(previews.status(job.id, "owner").state).toBe("ready"));
    expect(previews.status(job.id, "owner").verification).toBe("launch-only");
    expect(host.action.mock.calls.some((call) => call[1].type === "waitForText")).toBe(false);
  });
});
