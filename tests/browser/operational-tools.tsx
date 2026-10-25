import { createRoot } from "react-dom/client";
import { DevicePanel } from "../../src/features/devices/DevicePanel";
import type { DevicePanelApi, DeviceSummary } from "../../src/features/devices/types";
import { DevServersPanel } from "../../src/features/host-tools/DevServersPanel";
import type { DevServer } from "../../src/features/host-tools/devServerTypes";
import { setDomainLanguagePreference, setLanguagePreference } from "../../src/shared/i18n";
import "../../src/styles/index.css";
import "../../src/features/host-tools/host-tools.css";

// Memory-only APIs. No real devices, processes, host connections, or credentials.
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
const calls: string[] = [];
const held = new Set<string>();
const completions = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
async function operation(name: string) {
  calls.push(name);
  if (held.has(name))
    await new Promise<void>((resolve, reject) => completions.set(name, { resolve, reject }));
}
const device: DeviceSummary = {
  id: "fixture-phone",
  name: "Test phone",
  platform: "android",
  version: "17",
  booted: true,
  physical: true,
};
const status = {
  running: true,
  installed: true,
  agentInstalled: true,
  platform: "win32",
  platforms: [{ platform: "android" as const, available: true }],
};
const canvas = document.createElement("canvas");
canvas.width = 360;
canvas.height = 640;
const context = canvas.getContext("2d")!;
// Labeled synthetic screen content, not a native-device acceptance capture.
context.fillStyle = "#f4f4f4";
context.fillRect(0, 0, canvas.width, canvas.height);
context.fillStyle = "#242424";
context.font = "20px system-ui";
context.fillText("Fixture device screen", 28, 54);
context.font = "16px system-ui";
["Screen capture", "Touch controls", "App launch"].forEach((text, index) => {
  context.fillText(text, 28, 122 + index * 60);
});
const api: DevicePanelApi = {
  status: async () => {
    await operation("status");
    return status;
  },
  setup: async () => {
    await operation("setup");
    return status;
  },
  start: async () => {
    await operation("start");
    return status;
  },
  stop: async () => {
    await operation("stop");
    return { ...status, running: false };
  },
  list: async () => {
    await operation("list");
    return { devices: [device], errors: [] };
  },
  boot: async () => {
    await operation("boot");
    return device;
  },
  capture: async () => {
    await operation("capture");
    return { mime: "image/png", base64: canvas.toDataURL().split(",")[1], capturedAt: "fixture" };
  },
  action: async (_deviceId, action) => {
    await operation(action.type);
    return "Completed";
  },
};
const server: DevServer = {
  id: "fixture-server",
  name: "bycoda preview",
  command: "pnpm dev",
  cwd: "/fixture/project",
  process: { pid: 4100, startedAt: "fixture-process", name: "node" },
  endpoints: [{ address: "127.0.0.1", port: 3000, url: "http://127.0.0.1:3000/" }],
  managed: true,
  state: "running",
  association: "managed",
  logsAvailable: true,
};
let callbackId = 0;
const callbacks = new Map<number, unknown>();
Object.assign(window, {
  operationalFixture: {
    calls,
    hold: (name: string) => held.add(name),
    finish: (name: string, message?: string) => {
      held.delete(name);
      const completion = completions.get(name);
      completions.delete(name);
      if (message) completion?.reject(new Error(message));
      else completion?.resolve();
    },
  },
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback: (callback: unknown) => {
      callbacks.set(++callbackId, callback);
      return callbackId;
    },
    unregisterCallback: (id: number) => callbacks.delete(id),
    invoke: async (command: string, input: Record<string, unknown> = {}) => {
      if (command === "local_host_connect")
        return {
          id: "fixture-host",
          name: "This computer",
          environmentId: "fixture-env",
          localHost: true,
        };
      if (command === "remote_request") {
        const method = String(input.method);
        if (method === "projects.list") return [{ id: "fixture-project", cwd: "/fixture/project" }];
        if (method === "environment.describe") return { capabilities: ["dev.servers"] };
        await operation(method);
        if (method === "devServers.list")
          return { status: "ok", servers: [server], scannedAt: Date.now() };
        if (method === "devServers.details")
          return { server, descendants: [], affectedPorts: [3000] };
        if (method === "devServers.logs") return { available: true, output: "Ready on port 3000" };
        if (method === "devServers.start" || method === "devServers.restart") return { server };
        if (method === "devServers.stop")
          return { state: "stopped", requiresForce: false, affectedPorts: [3000] };
      }
      if (command === "plugin:event|listen") return ++callbackId;
      return null;
    },
  },
});
if (params.get("lang") === "de") {
  await setLanguagePreference("de");
  await setDomainLanguagePreference("technical", "app");
}
createRoot(document.getElementById("root")!).render(
  <main className="host-tools host-tools-section" style={{ minHeight: "100vh" }}>
    {params.get("tool") === "servers" ? (
      <DevServersPanel cwd="/fixture/project" />
    ) : (
      <DevicePanel api={api} hostLabel="This computer" onAddDevice={() => operation("add")} />
    )}
  </main>,
);
