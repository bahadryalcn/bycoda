import { describe, it, expect, vi } from "vitest";
import { DevicePreviews } from "./device-preview";
import type { DeviceHost } from "./device-host";
const input = {
  requestId: "request",
  deviceId: "sim",
  url: "exp://127.0.0.1:8081",
  expectedText: "Kilidi aç",
};
function fixture() {
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
  );
  return { host, previews };
}
describe("observable device previews", () => {
  it("deduplicates setup, verifies content and keeps frame reads in their conversation", async () => {
    const { host, previews } = fixture();
    const first = previews.start(input, "owner");
    expect(previews.start(input, "owner").id).toBe(first.id);
    expect(previews.start({ url: input.url, expectedText: input.expectedText, deviceId: input.deviceId, requestId: input.requestId, installExpoGo: false }, "owner").id).toBe(first.id);
    expect(() => previews.start({ ...input, url: "exp://127.0.0.1:8082" }, "owner")).toThrow(
      "PREVIEW_REQUEST_CONFLICT",
    );
    await vi.waitFor(() => expect(previews.status(first.id, "owner").state).toBe("ready"));
    expect(host.prepareExpo).toHaveBeenCalledOnce();
    expect(host.action).toHaveBeenCalledWith("sim", { type: "pressElement", label: "Aç" });
    expect(host.action).toHaveBeenCalledWith("sim", {
      type: "waitForText",
      text: "Kilidi aç",
      timeoutMs: 120000,
    });
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
