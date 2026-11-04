import { afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ own: "main", labels: ["main"] as string[], failed: false }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: api.own }) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getAllWebviewWindows: async () => {
    if (api.failed) throw new Error("unavailable");
    return api.labels.map((label) => ({ label }));
  },
}));
import { isLeadWindow } from "./workspaceWindows";
afterEach(() => { api.own = "main"; api.labels = ["main"]; api.failed = false; });

it("elects only workspace windows and transfers after original leader leaves", async () => {
  api.labels = ["desktop-control-indicator", "quick-composer", "voice-overlay-main", "quick-composer-git", "main", "window-b"];
  expect(await isLeadWindow()).toBe(true);
  api.own = "window-b";
  expect(await isLeadWindow()).toBe(false);
  api.failed = false;
  api.labels = [];
  expect(await isLeadWindow()).toBe(false);
  api.labels = api.labels.filter((label) => label !== "main");
  expect(await isLeadWindow()).toBe(true);
  api.own = "desktop-control-indicator";
  expect(await isLeadWindow()).toBe(false);
});

it("retains one canonical fallback without granting an unidentified window ownership", async () => {
  api.failed = true;
  expect(await isLeadWindow()).toBe(true);
  api.own = "window-b";
  expect(await isLeadWindow()).toBe(false);
});
