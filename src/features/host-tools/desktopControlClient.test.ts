// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ host: vi.fn(), invoke: vi.fn() }));
vi.mock("../connections/model/hostFeatureClient", () => ({ hostToolRequest: mock.host }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({}) }));
import { desktopControlRequest } from "./desktopControlClient";
const configuration = {
  enabled: true,
  binaryPath: "",
  binarySha256: "",
  allowedApps: [],
  allowPhysicalInput: false,
  permissionMode: "ask",
  allowAllApps: false,
  driver: "agent-desktop",
  version: 1,
} as const;
beforeEach(() => {
  mock.host.mockReset().mockResolvedValue({ configuration });
  mock.invoke.mockReset().mockResolvedValue(undefined);
});
it("wakes the native status watcher only after control is configured or resumed", async () => {
  await desktopControlRequest({ op: "resume" });
  await desktopControlRequest({
    op: "configure",
    expectedVersion: 0,
    configuration: {
      enabled: true,
      binaryPath: "",
      binarySha256: "",
      allowedApps: [],
      allowPhysicalInput: false,
    },
  });
  expect(mock.invoke.mock.calls).toEqual([
    ["desktop_control_indicator_watch"],
    ["desktop_control_indicator_watch"],
  ]);
});
it("leaves the watcher alone for reads and Stop, and when the Host request fails", async () => {
  mock.host.mockResolvedValueOnce({}).mockResolvedValueOnce({});
  await desktopControlRequest({ op: "status" });
  await desktopControlRequest({ op: "stop" });
  mock.host.mockRejectedValueOnce(new Error("Host unavailable"));
  await expect(desktopControlRequest({ op: "resume" })).rejects.toThrow("Host unavailable");
  expect(mock.invoke).not.toHaveBeenCalled();
});
it("never lets a missing native bridge fail a settings save", async () => {
  mock.invoke.mockRejectedValue(new Error("not running in Tauri"));
  await expect(desktopControlRequest({ op: "resume" })).resolves.toEqual({ configuration });
});
