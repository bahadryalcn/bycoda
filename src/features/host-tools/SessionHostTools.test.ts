// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionHostTools } from "./SessionHostTools";
import {
  hostFeatureRequest,
  hostToolRequest,
  listHostToolMachines,
} from "../connections/model/hostFeatureClient";
vi.mock("../connections/model/hostFeatureClient", () => ({
  deviceTouchAvailable: vi.fn().mockResolvedValue(false),
  hostFeatureRequest: vi.fn(),
  hostToolRequest: vi.fn(),
  listHostToolMachines: vi.fn(),
  subscribeDeviceVideo: vi.fn().mockRejectedValue(new Error("DEVICE_STREAM_UNSUPPORTED")),
}));
let root: Root;
let container: HTMLDivElement;

/** Let the actual optional module load before inspecting its UI or host requests. */
async function toolAct(run: () => unknown) {
  await act(async () => {
    await run();
  });
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

const toolTabs = () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
/** The visible tool navigation: the selected tab names the active tool. */
const toolChooser = () =>
  container.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')!;
async function chooseTool(name: string) {
  const tab = toolTabs().find((tab) => tab.getAttribute("aria-label") === name)!;
  expect(tab).toBeDefined();
  await toolAct(() => tab.click());
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(listHostToolMachines)
    .mockReset()
    .mockResolvedValue([
      {
        id: "local",
        name: "Windows",
        environmentId: "local-env",
        endpoint: "http://127.0.0.1:37766",
        localHost: true,
      },
      { id: "mac", name: "MacBook", environmentId: "macbook", endpoint: "ssh://mac" },
      { id: "linux", name: "Linux server", environmentId: "linux-env", endpoint: "ssh://linux" },
    ]);
  vi.mocked(hostToolRequest)
    .mockReset()
    .mockImplementation(async (_cwd, _capability, method) =>
      method === "resources.read"
        ? { samples: [] }
        : method === "runtimeLogs.read"
          ? { streamId: "test-stream", entries: [], sources: [], cursor: 0, dropped: 0 }
          : method === "devices.status"
            ? {
                running: false,
                installed: true,
                agentInstalled: true,
                platform: "win32",
                platforms: [],
              }
            : { open: false, url: null, controlling: false },
    );
  vi.mocked(hostFeatureRequest)
    .mockReset()
    .mockImplementation(async (_cwd, _capability, method) =>
      method === "devServers.list"
        ? { status: "ok", servers: [], scannedAt: Date.now() }
        : method === "runtimeLogs.monitors.list"
          ? []
          : method === "devices.status"
            ? {
                running: false,
                installed: false,
                agentInstalled: false,
                platform: "win32",
                platforms: [],
              }
            : { open: false, url: null, controlling: false },
    );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
it("keeps common chrome compact and selects another tool without starting resource sampling", async () => {
  await toolAct(async () =>
    root.render(
      createElement(SessionHostTools, {
        cwd: "/compact-tools",
        sessionId: "session",
        title: "Tools",
      }),
    ),
  );
  expect(container.querySelector(".host-tools-heading")).toBeNull();
  expect(container.querySelectorAll(".host-tools-topbar")).toHaveLength(1);
  expect(container.querySelector(".host-tools-topbar-device")).toBeNull();
  await chooseTool("Resource usage");
  expect(container.querySelector("[data-active-tool]")?.getAttribute("data-active-tool")).toBe(
    "resources",
  );
  expect(container.querySelectorAll(".host-tools-topbar")).toHaveLength(1);
  expect(toolChooser().textContent).toContain("Resource usage");
  expect(container.textContent).toContain("No samples yet");
  expect(
    vi.mocked(hostFeatureRequest).mock.calls.some((call) => call[2] === "resources.read"),
  ).toBe(false);
});

it("discovers servers only while the development servers panel is visible", async () => {
  await toolAct(async () =>
    root.render(
      createElement(SessionHostTools, {
        cwd: "remote://machine/repo",
        sessionId: "session",
        title: "Remote project",
      }),
    ),
  );
  expect(
    vi.mocked(hostFeatureRequest).mock.calls.some((call) => call[2] === "devServers.list"),
  ).toBe(false);
  await chooseTool("Development servers");
  expect(hostFeatureRequest).toHaveBeenCalledWith(
    "remote://machine/repo",
    "dev.servers",
    "devServers.list",
    { refresh: false },
  );
  expect(container.textContent).toContain("No servers found");
});

it("shares one named chooser and header row across all five panels", async () => {
  await toolAct(() =>
    root.render(
      createElement(SessionHostTools, {
        cwd: "/five-tools",
        sessionId: "five-tools-session",
        title: "One work surface",
      }),
    ),
  );
  for (const name of ["Devices", "Host browser", "Development servers", "Logs", "Resource usage"]) {
    await chooseTool(name);
    const header = container.querySelector(".host-tools-topbar")!;
    expect(container.querySelectorAll(".host-tools-topbar")).toHaveLength(1);
    // Wide panes show the tablist, narrow panes one named selector; a container
    // query displays exactly one of them, so both are present in the DOM here.
    expect(
      header.querySelectorAll('[role="tablist"][aria-label="Conversation tool selection"]'),
    ).toHaveLength(1);
    expect(header.querySelectorAll(".host-tools-compact-selector")).toHaveLength(1);
    expect(header.querySelector(".host-tools-compact-trigger")?.textContent).toContain(name);
    expect(container.querySelectorAll(".host-tools-heading")).toHaveLength(0);
    expect(toolTabs()).toHaveLength(5);
    expect(toolChooser().textContent).toContain(name);
    expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
    const panel = container.querySelector('[role="tabpanel"]')!;
    expect(
      document.getElementById(panel.getAttribute("aria-labelledby")!)!.getAttribute("aria-label"),
    ).toBe(name);
  }
});
afterEach(async () => {
  await toolAct(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("retains visited tools and moves between visible tool tabs with the keyboard", async () => {
  await toolAct(async () =>
    root.render(
      createElement(SessionHostTools, {
        cwd: "/repo",
        sessionId: "session-1",
        title: "Current conversation",
      }),
    ),
  );
  expect(hostFeatureRequest).toHaveBeenCalledWith("/repo", "device.host", "devices.status", {});
  expect(container.textContent).not.toContain("Saved visuals");
  expect(container.textContent).not.toContain("PR tracking");
  expect(toolTabs()).toHaveLength(5);
  expect(toolChooser().getAttribute("aria-label")).toBe("Devices");
  await toolAct(() => {
    toolChooser().focus();
    toolChooser().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
  });
  expect(toolChooser().getAttribute("aria-label")).toBe("Host browser");
  expect(document.activeElement).toBe(toolChooser());
  expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
  expect(hostFeatureRequest).toHaveBeenCalledWith(
    "/repo",
    "browser.sessionScopes.v1",
    "browser.status",
    {
      sessionId: "session-1",
      leaseId: undefined,
    },
  );
  await toolAct(() =>
    toolChooser().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" })),
  );
  expect(toolChooser().getAttribute("aria-label")).toBe("Resource usage");
  expect(document.activeElement).toBe(toolChooser());
  expect(
    vi.mocked(hostFeatureRequest).mock.calls.some((call) => call[2] === "resources.read"),
  ).toBe(false);
});

it("keeps every tool on the remote project and uses the host conversation identity", async () => {
  const cwd = "remote://macbook/Users/owner/project";
  const sessionId = "host-session";
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) => {
    if (method === "resources.read") return { samples: [] };
    if (method === "devices.status")
      return {
        running: false,
        installed: true,
        agentInstalled: false,
        platform: "darwin",
        platforms: [],
      };
    return { open: false, url: null, controlling: false };
  });
  await toolAct(async () =>
    root.render(
      createElement(SessionHostTools, {
        cwd,
        sessionId,
        title: "iOS work",
        composerSessionId: "shell-session",
      }),
    ),
  );
  await chooseTool("Devices");
  await chooseTool("Host browser");
  await chooseTool("Resource usage");
  await toolAct(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.getAttribute("aria-label") === "Sample now")!
      .click(),
  );
  expect(hostFeatureRequest).toHaveBeenCalledWith(cwd, "device.host", "devices.status", {});
  expect(hostFeatureRequest).toHaveBeenCalledWith(
    cwd,
    "browser.sessionScopes.v1",
    "browser.status",
    {
      sessionId,
      leaseId: undefined,
    },
  );
  expect(hostFeatureRequest).toHaveBeenCalledWith(cwd, "resources.diagnostics", "resources.read");
  expect(vi.mocked(hostFeatureRequest).mock.calls.every((call) => call[0] === cwd)).toBe(true);
});

it("hands off automatic device control when switching conversations in the same project", async () => {
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method, params) =>
    method === "devices.list"
      ? {
          devices: [{ id: "sim", name: "iPhone", platform: "ios", booted: true, physical: false }],
          errors: [],
        }
      : method === "devices.control.status"
        ? { deviceId: "sim", busy: false }
        : method === "devices.control.claim"
          ? {
              deviceId: "sim",
              leaseId: `lease-${String(params?.requestId)}`,
              expiresAt: Number.MAX_SAFE_INTEGER,
            }
          : method === "devices.control.release"
            ? { released: true }
            : {
                running: true,
                installed: true,
                agentInstalled: true,
                controlProtocol: 1,
                platform: "darwin",
                platforms: [],
                devices: [],
                errors: [],
              },
  );
  const render = (sessionId: string) =>
    toolAct(async () =>
      root.render(
        createElement(SessionHostTools, {
          cwd: "remote://mac/repo",
          sessionId,
          title: sessionId,
        }),
      ),
    );
  await render("first");
  await chooseTool("Devices");
  const claims = () =>
    vi.mocked(hostFeatureRequest).mock.calls.filter((call) => call[2] === "devices.control.claim");
  expect(claims()).toHaveLength(1);
  const firstRequest = claims()[0][3]?.requestId;
  await render("second");
  await chooseTool("Devices");
  expect(hostFeatureRequest).toHaveBeenCalledWith(
    "remote://mac/repo",
    "device.host",
    "devices.control.release",
    { deviceId: "sim", leaseId: `lease-${String(firstRequest)}` },
  );
  expect(claims()).toHaveLength(2);
  expect(claims()[1][3]?.requestId).not.toBe(firstRequest);
  expect(container.querySelector('[aria-label="Allow device control"]')).toBeNull();
});

const clickToolTab = chooseTool;
const machineTrigger = () =>
  container.querySelector<HTMLButtonElement>('.host-tools-machine button[aria-haspopup="dialog"]')!;
const openMachineOptions = async () => {
  if (machineTrigger().getAttribute("aria-expanded") !== "true") {
    await toolAct(() => machineTrigger().click());
  }
};
const chooseMachine = async (value: string) => {
  await openMachineOptions();
  const labels: Record<string, string> = {
    local: "This computer",
    "machine:linux": "Linux server",
    "machine:mac": "MacBook",
  };
  const label = labels[value];
  await toolAct(() =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((option) =>
        value === "project"
          ? option.textContent?.includes("Project host")
          : option.textContent === label,
      )!
      .click(),
  );
};

it.each(["project", "local"])(
  "shows one local machine with the %s target selected",
  async (initialMachine) => {
    const onViewChange = vi.fn();
    await toolAct(() =>
      root.render(
        createElement(SessionHostTools, {
          cwd: "/local/project",
          sessionId: "session",
          title: "Local project",
          initialTab: "browser",
          initialMachine,
          onViewChange,
        }),
      ),
    );
    await openMachineOptions();
    const options = [
      ...document.querySelectorAll('[role="listbox"][aria-label="Tool machine"] [role="option"]'),
    ];
    const localOptions = options.filter((option) => option.textContent?.includes("This computer"));
    expect(localOptions).toHaveLength(1);
    expect(localOptions[0]?.getAttribute("aria-selected")).toBe("true");
    expect(options.find((option) => option.textContent === "MacBook")).toBeDefined();
    expect(onViewChange).toHaveBeenLastCalledWith({ tab: "browser", machine: initialMachine });
  },
);

it("switches Devices from a local project to the paired Mac from Setup and access", async () => {
  const cwd = "/local/project";
  vi.mocked(hostToolRequest).mockResolvedValue({
    running: false,
    installed: true,
    agentInstalled: false,
    platform: "darwin",
    platforms: [{ platform: "ios", available: true }],
  });
  await toolAct(() =>
    root.render(
      createElement(SessionHostTools, { cwd, sessionId: "session", title: "Local project" }),
    ),
  );
  await clickToolTab("Devices");
  const openSetup = () =>
    toolAct(() =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Setup and access")!
        .click(),
    );
  const setup = () => document.querySelector('[role="dialog"][aria-label="Setup and access"]')!;
  await openSetup();
  await toolAct(() =>
    setup()
      .querySelector<HTMLButtonElement>(
        'button[aria-haspopup="dialog"][aria-label*="Tool machine"]',
      )!
      .click(),
  );
  await toolAct(() =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((option) => option.textContent === "MacBook")!
      .click(),
  );
  expect(hostToolRequest).toHaveBeenCalledExactlyOnceWith(
    cwd,
    "device.host",
    "devices.status",
    {},
    { kind: "machine", machineId: "mac" },
  );
  await openSetup();
  expect(setup().textContent).toContain("MacBook");
  expect(setup().textContent).toContain("SDK detected");
  expect(hostToolRequest).toHaveBeenCalledTimes(1);
});

it("offers local and saved machines only for host tools while keeping conversation tools on their owner", async () => {
  const cwd = "remote://macbook/Users/owner/project";
  await toolAct(async () =>
    root.render(createElement(SessionHostTools, { cwd, sessionId: "session", title: "iOS task" })),
  );
  expect(listHostToolMachines).toHaveBeenCalledOnce();
  await clickToolTab("Devices");
  await openMachineOptions();
  expect(
    document.querySelector('[role="listbox"][aria-label="Tool machine"]')?.textContent,
  ).toContain("MacBook");
  expect(
    document.querySelector('[role="listbox"][aria-label="Tool machine"]')?.textContent,
  ).toContain("Project host");
  expect(
    document.querySelector('[role="listbox"][aria-label="Tool machine"]')?.textContent,
  ).toContain("This computer");
  expect(
    document.querySelector('[role="listbox"][aria-label="Tool machine"]')?.textContent,
  ).toContain("Linux server");
  await chooseMachine("local");
  expect(hostToolRequest).toHaveBeenCalledWith(
    cwd,
    "device.host",
    "devices.status",
    {},
    { kind: "local" },
  );
  expect(machineTrigger().getAttribute("aria-label")).toContain("This computer");
  expect(container.textContent).toContain("Connect a device");
  const connect = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Connect devices",
  )!;
  expect(connect).toBeTruthy();
  expect(connect.disabled).toBe(true); // The selected host reports an installed runtime without a detected SDK.
  expect(hostToolRequest).not.toHaveBeenCalledWith(
    cwd,
    "device.host",
    "devices.start",
    {},
    { kind: "local" },
  );
  await toolAct(() =>
    [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Setup and access")!
      .click(),
  );
  expect(document.querySelector(".device-panel-setup-host")?.textContent).toContain(
    "This computer",
  );
  expect(document.querySelector(".device-panel-setup-summary")?.textContent).toContain(
    "Device host stopped",
  );
  await clickToolTab("Resource usage");
  await toolAct(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.getAttribute("aria-label") === "Sample now")!
      .click(),
  );
  expect(hostToolRequest).toHaveBeenCalledWith(
    cwd,
    "resources.diagnostics",
    "resources.read",
    {},
    { kind: "local" },
  );
  await chooseMachine("machine:linux");
  await clickToolTab("Host browser");
  // The browser panel loads on first open and asks for status from its effect; a slow runner
  // reaches this line before that request.
  await vi.waitFor(
    () =>
      expect(hostToolRequest).toHaveBeenCalledWith(
        cwd,
        "browser.ownerPresentationScopes.v1",
        "browser.status",
        { leaseId: undefined, sessionId: "session", ownerPresentationScope: expect.any(String) },
        { kind: "machine", machineId: "linux" },
      ),
    { timeout: 10_000, interval: 25 },
  );
  expect(
    document.querySelector('[role="dialog"][aria-label="Browser controls and setup"]'),
  ).toBeNull();
  const annotate = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Select element and add to composer"]',
  )!;
  expect(annotate.getAttribute("aria-disabled")).toBe("true");
  await toolAct(() => annotate.click());
  expect(
    vi
      .mocked(hostToolRequest)
      .mock.calls.some(([, , method]) => method === "browser.annotate.start"),
  ).toBe(false);
  await clickToolTab("Development servers");
  expect(container.querySelector(".host-tools-machine")).toBeNull();
});

it("clears machine selection on a conversation switch and retains a removed explicit machine without fallback", async () => {
  const render = (sessionId: string) =>
    toolAct(async () =>
      root.render(
        createElement(SessionHostTools, {
          cwd: "remote://macbook/repo",
          sessionId,
          title: sessionId,
        }),
      ),
    );
  await render("first");
  await clickToolTab("Devices");
  await chooseMachine("machine:linux");
  vi.mocked(listHostToolMachines).mockResolvedValue([]);
  await openMachineOptions();
  await toolAct(async () =>
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Refresh machines")!
      .click(),
  );
  expect(machineTrigger().getAttribute("aria-label")).toContain(
    "Selected machine unavailable · linux",
  );
  expect(container.textContent).toContain("Selected machine unavailable");
  await render("second");
  await clickToolTab("Devices");
  expect(machineTrigger().getAttribute("aria-label")).toContain("macbook");
  expect(hostFeatureRequest).toHaveBeenLastCalledWith(
    "remote://macbook/repo",
    "device.host",
    "devices.status",
    {},
  );
});

it("clears the device screen and control and discovers devices on another machine", async () => {
  const response = async (
    _cwd: string,
    _capability: string,
    method: string,
    _params?: unknown,
    target?: { kind: string },
  ) => {
    if (method === "devices.list")
      return {
        devices: [
          {
            id: "sim",
            name: "iPhone",
            platform: "ios",
            version: "27",
            booted: true,
            physical: false,
          },
        ],
        errors: [],
      };
    if (method === "devices.capture")
      return {
        mime: "image/png",
        base64: target?.kind === "local" ? "new-host-frame" : "old-host-frame",
        capturedAt: "now",
      };
    if (method === "devices.control.status") return { deviceId: "sim", busy: false };
    if (method === "devices.control.claim")
      return {
        deviceId: "sim",
        leaseId: target?.kind === "local" ? "local-lease" : "project-lease",
        expiresAt: Number.MAX_SAFE_INTEGER,
      };
    if (method === "devices.control.release") return { released: true };
    return {
      running: true,
      installed: true,
      agentInstalled: true,
      controlProtocol: 1,
      platform: "darwin",
      platforms: [],
    };
  };
  vi.mocked(hostFeatureRequest).mockImplementation(response);
  vi.mocked(hostToolRequest).mockImplementation(response);
  await toolAct(async () =>
    root.render(
      createElement(SessionHostTools, {
        cwd: "remote://macbook/repo",
        sessionId: "session",
        title: "iOS work",
      }),
    ),
  );
  await clickToolTab("Devices");
  expect(
    container.querySelector('button[aria-label^="Selected device:"]')?.getAttribute("aria-label"),
  ).toContain("iPhone");
  await toolAct(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.getAttribute("aria-label") === "Capture")!
      .click(),
  );
  expect(container.querySelector("img")).not.toBeNull();
  await chooseMachine("local");
  expect(container.querySelector("img")?.getAttribute("src")).not.toContain("old-host-frame");
  expect(
    container.querySelector('button[aria-label^="Selected device:"]')?.getAttribute("aria-label"),
  ).toContain("iPhone");
  expect(hostFeatureRequest).toHaveBeenCalledWith(
    "remote://macbook/repo",
    "device.host",
    "devices.control.release",
    { deviceId: "sim", leaseId: "project-lease" },
  );
  expect(hostToolRequest).toHaveBeenCalledWith(
    "remote://macbook/repo",
    "device.host",
    "devices.control.claim",
    expect.objectContaining({ deviceId: "sim" }),
    { kind: "local" },
  );
  expect(hostToolRequest).toHaveBeenCalledWith(
    "remote://macbook/repo",
    "device.host",
    "devices.status",
    {},
    { kind: "local" },
  );
});

it("moves an explicit Browser request to the project Host and navigates it once", async () => {
  const cwd = "remote://macbook/Users/owner/project";
  const props = {
    cwd,
    sessionId: "host-session",
    title: "Remote",
    initialTab: "devices" as const,
    initialMachine: "machine:linux",
  };
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) =>
    method === "devServers.list"
      ? { status: "ok", servers: [], scannedAt: Date.now() }
      : {
          open: method !== "browser.status",
          url: "http://localhost:3000/a?b=1#c",
          controlling: method !== "browser.status",
          leaseId: method !== "browser.status" ? "lease" : undefined,
          leaseExpiresAt: Date.now() + 30_000,
        },
  );
  await toolAct(async () => root.render(createElement(SessionHostTools, props)));
  const viewRequest = {
    id: "session-host-tools-navigation",
    tab: "browser" as const,
    machine: "project",
    url: "http://localhost:3000/a?b=1#c",
  };
  await toolAct(async () =>
    root.render(createElement(SessionHostTools, { ...props, viewRequest })),
  );
  await toolAct(async () =>
    root.render(createElement(SessionHostTools, { ...props, viewRequest: { ...viewRequest } })),
  );
  const opens = vi
    .mocked(hostFeatureRequest)
    .mock.calls.filter((call) => call[2] === "browser.open");
  expect(opens).toEqual([
    [
      cwd,
      "browser.sessionScopes.v1",
      "browser.open",
      expect.objectContaining({ url: viewRequest.url }),
    ],
  ]);
  expect(
    vi.mocked(hostToolRequest).mock.calls.some((call) => String(call[2]).startsWith("browser.")),
  ).toBe(false);
});
