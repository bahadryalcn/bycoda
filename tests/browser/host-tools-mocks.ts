import type {
  DeviceFrame,
  DeviceHostStatus,
  DeviceSummary,
} from "../../src/features/devices/types";
import type { DevServer } from "../../src/features/host-tools/devServerTypes";
import type { HostToolTarget } from "../../src/features/connections/model/hostToolTarget";
import type { RemoteMachine } from "../../src/features/connections/model/protocol";

let devServers: DevServer[] = [
  {
    id: "fixture-dev-server",
    name: "Demo dev server",
    managed: true,
    state: "running",
    process: {
      pid: 90001,
      startedAt: "fixture-birth",
      name: "node",
      command: "pnpm dev",
      cwd: "G:/demo/example",
    },
    endpoints: [
      { address: "127.0.0.1", port: 5173, url: "http://127.0.0.1:5173" },
      { address: "::1", port: 5173, url: "http://[::1]:5173" },
    ],
    command: "pnpm dev",
    cwd: "G:/demo/example",
    projectName: "Demo project",
    association: "managed",
    logsAvailable: true,
  },
  {
    id: "fixture-external",
    name: "External server",
    managed: false,
    state: "running",
    process: { pid: 90003, startedAt: "external-birth", name: "node" },
    endpoints: [{ address: "127.0.0.1", port: 8080, url: "http://127.0.0.1:8080" }],
    association: "uncertain",
    logsAvailable: false,
  },
];

if (new URLSearchParams(location.search).get("servers") === "many") {
  devServers.push(
    ...Array.from({ length: 24 }, (_, index): DevServer => ({
      id: `fixture-server-${index}`,
      name: `Preview server ${index + 1}`,
      managed: true,
      state: "running",
      process: { pid: 91000 + index, startedAt: `fixture-${index}`, name: "node" },
      endpoints: [
        { address: "127.0.0.1", port: 6000 + index, url: `http://127.0.0.1:${6000 + index}` },
      ],
      association: "managed",
      logsAvailable: true,
    })),
  );
}

export const fixtureControl = {
  scanFailure: false,
  scanDelayMs: 0,
  updateServer: () => {
    devServers = devServers.map((server) =>
      server.id === "fixture-server-23" ? { ...server, name: "Updated preview server" } : server,
    );
  },
};
Object.assign(window, { hostToolFixture: fixtureControl });

export const calls: {
  cwd: string;
  method: string;
  params: Record<string, unknown>;
  target?: HostToolTarget;
}[] = [];
let browser = {
  open: false,
  url: null as string | null,
  controlling: false,
  leaseId: undefined as string | undefined,
  leaseExpiresAt: undefined as number | undefined,
  runtime: { installed: true, running: false },
};
let deviceStatus: DeviceHostStatus = {
  running: false,
  installed: true,
  agentInstalled: true,
  platform: "win32",
  platforms: [
    { platform: "android", available: true },
    { platform: "ios", available: false, reason: "Xcode requires macOS" },
  ],
};
let device: DeviceSummary = {
  id: "demo-emulator",
  name: "Demo Android emulator",
  platform: "android",
  version: "16",
  booted: false,
  physical: false,
};
const toolMachines: RemoteMachine[] = [
  {
    id: "fixture-local",
    name: "This computer (local sync)",
    localHost: true,
    endpoint: "http://127.0.0.1:3776",
    environmentId: "fixture-local-env",
  },
  {
    id: "fixture-mac",
    name: "Fixture MacBook",
    endpoint: "http://127.0.0.1:3777",
    environmentId: "fixture-mac-env",
  },
];
const machineBrowsers = new Map([
  ["fixture-local", browser],
  ["fixture-mac", { ...browser }],
]);
const machineDevices = new Map([
  ["fixture-local", { status: deviceStatus, device }],
  [
    "fixture-mac",
    {
      status: {
        ...deviceStatus,
        platform: "darwin",
        platforms: [
          { platform: "ios" as const, available: true },
          { platform: "android" as const, available: false },
        ],
      },
      device: {
        ...device,
        id: "demo-simulator",
        name: "Demo iOS simulator",
        platform: "ios" as const,
      },
    },
  ],
]);
export async function listHostToolMachines() {
  return toolMachines;
}
export async function hostToolRequest<T>(
  cwd: string,
  capability: string,
  method: string,
  params: Record<string, unknown> = {},
  target: HostToolTarget = { kind: "project" },
): Promise<T> {
  return hostFeatureRequest<T>(cwd, capability, method, params, target);
}
let monitors: { id: string; url: string; sourceId: string }[] = [];

function frame(): DeviceFrame {
  const canvas = document.createElement("canvas");
  canvas.width = 360;
  canvas.height = 640;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f3f6fb";
  ctx.fillRect(0, 0, 360, 640);
  ctx.fillStyle = "#20314a";
  ctx.fillRect(0, 0, 360, 60);
  ctx.fillStyle = "#fff";
  ctx.font = "18px sans-serif";
  ctx.fillText("Demo workspace", 24, 38);
  ctx.fillStyle = "#20314a";
  ctx.font = "24px sans-serif";
  ctx.fillText("Device preview", 24, 115);
  ctx.font = "16px sans-serif";
  ctx.fillText("Fixture data", 24, 150);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = "#dce4ef";
    ctx.fillRect(24, 190 + i * 100, 312, 76);
  }
  return {
    mime: "image/png",
    base64: canvas.toDataURL("image/png").split(",")[1],
    capturedAt: new Date().toISOString(),
  };
}
function browserFrame(state = browser) {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#f4f7fb"/><rect width="1280" height="72" fill="#20314a"/><text x="44" y="46" fill="white" font-size="26" font-family="sans-serif">Example website</text><text x="44" y="155" fill="#20314a" font-size="38" font-family="sans-serif">Shared browser preview</text><rect x="44" y="200" width="560" height="190" rx="12" fill="#dce4ef"/><rect x="628" y="200" width="560" height="190" rx="12" fill="#dce4ef"/></svg>';
  return { ...state, mimeType: "image/svg+xml", data: btoa(svg), width: 1280, height: 720 };
}
export async function hostFeatureRequest<T>(
  cwd: string,
  _capability: string,
  method: string,
  params: Record<string, unknown> = {},
  target: HostToolTarget = { kind: "project" },
): Promise<T> {
  const machineId = target.kind === "machine" ? target.machineId : "fixture-local";
  calls.push({ cwd, method, params, ...(target.kind === "project" ? {} : { target }) });
  await new Promise((resolve) => setTimeout(resolve, 35));
  let browser = machineBrowsers.get(machineId)!;
  let { status: deviceStatus, device } = machineDevices.get(machineId)!;
  let result: unknown;
  switch (method) {
    case "runtimeLogs.read": {
      const label = machineId === "fixture-local" ? "Demo" : "MacBook";
      const sources = [
        { id: `${machineId}-browser`, kind: "browser", label: `${label} browser`, available: true },
        {
          id: `${machineId}-server`,
          kind: "server",
          label: `${label} dev server`,
          available: true,
        },
        {
          id: `${machineId}-external`,
          kind: "server",
          label: "External API server",
          available: false,
          reason: "Output is unavailable for a process started outside bycoda.",
        },
      ];
      const entries = [
        {
          id: `${machineId}-1`,
          cursor: 1,
          timestamp: 1791806400000,
          sourceId: sources[1].id,
          source: "server",
          level: "info",
          message: `${label} development server ready on port 5173`,
        },
        {
          id: `${machineId}-2`,
          cursor: 2,
          timestamp: 1791806400100,
          sourceId: sources[0].id,
          source: "browser",
          level: "info",
          message: "Workspace loaded",
          details: { project: "example", items: 8 },
        },
        {
          id: `${machineId}-3`,
          cursor: 3,
          timestamp: 1791806400200,
          sourceId: sources[0].id,
          source: "browser",
          level: "error",
          message: "Failed to fetch project activity",
          stack:
            "Error: Failed to fetch project activity\n    at loadActivity (src/features/activity.ts:42:7)",
          location: { file: "http://localhost:5173/src/features/activity.ts", line: 42, column: 7 },
        },
        {
          id: `${machineId}-4`,
          cursor: 4,
          timestamp: 1791806400250,
          sourceId: sources[0].id,
          source: "browser",
          level: "error",
          message: "Failed to fetch project activity",
          stack:
            "Error: Failed to fetch project activity\n    at loadActivity (src/features/activity.ts:42:7)",
          location: { file: "http://localhost:5173/src/features/activity.ts", line: 42, column: 7 },
        },
        {
          id: `${machineId}-5`,
          cursor: 5,
          timestamp: 1791806400300,
          sourceId: sources[1].id,
          source: "server",
          level: "warn",
          message: "Activity request timed out after 3000ms",
          details: { route: "/api/activity", status: 504 },
        },
      ];
      if (new URLSearchParams(location.search).has("log-levels")) {
        for (const [index, message, level] of [
          [6, "GET /dashboard 200 in 12ms", "info"],
          [7, "✓ Ready in 120ms", "info"],
          [8, "[debug] Route cache warmed", "debug"],
          [9, "POST /api 500 in 3ms", "info"],
        ] as const) {
          entries.push({
            id: `${machineId}-${index}`,
            cursor: index,
            timestamp: 1791806400000 + index * 100,
            sourceId: sources[1].id,
            source: "server",
            level,
            message,
          });
        }
      }
      result = {
        entries: entries.filter((entry) => entry.cursor > Number(params.after ?? 0)),
        sources,
        cursor: entries.at(-1)?.cursor ?? 5,
        dropped: 0,
      };
      break;
    }
    case "runtimeLogs.sources":
      result = [];
      break;
    case "runtimeLogs.monitors.start": {
      const monitor = {
        id: "fixture-monitor",
        url: String(params.url),
        sourceId: "fixture-monitor-source",
      };
      monitors = [...monitors, monitor];
      result = monitor;
      break;
    }
    case "runtimeLogs.monitors.list":
      result = monitors;
      break;
    case "runtimeLogs.monitors.stop":
      monitors = monitors.filter((monitor) => monitor.id !== params.id);
      result = { stopped: true };
      break;
    case "devServers.list":
      if (fixtureControl.scanDelayMs)
        await new Promise((resolve) => setTimeout(resolve, fixtureControl.scanDelayMs));
      if (fixtureControl.scanFailure) throw new Error("Fixture scan temporarily unavailable");
      result = { status: "ok", servers: devServers, scannedAt: Date.now() };
      break;
    case "devServers.details": {
      const server = devServers.find((value) => value.id === params.id);
      result = {
        server,
        descendants: server?.managed
          ? [{ pid: 90002, parentPid: 90001, startedAt: "child-birth", name: "node" }]
          : [],
        affectedPorts: server?.managed ? [5173, 5174] : [8080],
      };
      break;
    }
    case "devServers.logs":
      result = {
        available: params.id === "fixture-dev-server",
        output: params.id === "fixture-dev-server" ? "Development server ready\n" : "",
      };
      break;
    case "devServers.stop":
      result = { state: "running", requiresForce: true, affectedPorts: [5173, 5174] };
      break;
    case "devServers.kill":
      devServers = devServers.map((server) =>
        server.id === params.id ? { ...server, state: "stopped", endpoints: [] } : server,
      );
      result = { state: "stopped", requiresForce: false, affectedPorts: [5173, 5174] };
      break;
    case "devServers.openExternal":
      result = { url: "http://127.0.0.1:5173" };
      break;
    case "devices.status":
      result = deviceStatus;
      break;
    case "devices.setup":
      deviceStatus = {
        ...deviceStatus,
        installed: true,
        agentInstalled: params.agentAccess === true,
      };
      result = deviceStatus;
      break;
    case "devices.start":
      deviceStatus = { ...deviceStatus, running: true };
      result = deviceStatus;
      break;
    case "devices.stop":
      deviceStatus = { ...deviceStatus, running: false };
      result = deviceStatus;
      break;
    case "devices.list":
      result = { devices: [device], errors: [] };
      break;
    case "devices.boot":
      device = { ...device, booted: true };
      result = device;
      break;
    case "devices.capture":
      result = frame();
      break;
    case "devices.action":
      result = "Device action completed";
      break;
    case "browser.claim":
      browser = {
        ...browser,
        controlling: true,
        leaseId: "fixture-lease",
        leaseExpiresAt: Date.now() + 30_000,
      };
      result = browser;
      break;
    case "browser.release":
      browser = { ...browser, controlling: false, leaseId: undefined };
      result = browser;
      break;
    case "browser.open":
      browser = { ...browser, open: true, url: String(params.url) };
      result = browser;
      break;
    case "browser.close":
      browser = { ...browser, open: false, url: null, controlling: false, leaseId: undefined };
      result = browser;
      break;
    case "browser.frame":
      result = browserFrame(browser);
      break;
    case "browser.status":
      result = browser;
      break;
    case "browser.input":
      result = browser;
      break;
    case "resources.read":
      result = {
        samples: [
          {
            at: Date.now(),
            host: {
              totalMemoryBytes: 16 * 1024 ** 3,
              freeMemoryBytes: 8 * 1024 ** 3,
              logicalCpus: 8,
              loadAverage: null,
            },
            process: {
              pid: 42,
              rssBytes: 140 * 1024 ** 2,
              heapUsedBytes: 48 * 1024 ** 2,
              cpuPercent:
                calls.filter((call) => call.method === "resources.read").length > 1 ? 2.4 : null,
              uptimeSeconds: 60,
            },
          },
        ],
      };
      break;
    case "tasks.list":
      result = [{ id: "demo-task", title: "Example task" }];
      break;
    default:
      throw new Error("Unexpected fixture request: " + method);
  }
  machineBrowsers.set(machineId, browser);
  machineDevices.set(machineId, { status: deviceStatus, device });
  return result as T;
}
