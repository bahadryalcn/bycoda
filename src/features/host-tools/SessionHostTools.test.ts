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
  hostFeatureRequest: vi.fn(),
  hostToolRequest: vi.fn(),
  listHostToolMachines: vi.fn(),
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
it("discovers servers only while the development servers tab is visible", async () => {
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
  const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (value) => value.textContent === "Development servers",
  )!;
  await toolAct(async () => tab.click());
  expect(hostFeatureRequest).toHaveBeenCalledWith(
    "remote://machine/repo",
    "dev.servers",
    "devServers.list",
    { refresh: false },
  );
  expect(container.textContent).toContain("No servers found");
});
afterEach(async () => {
  await toolAct(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("only mounts the active tool and connects keyboard tabs to their panel", async () => {
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
  const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  expect(tabs.filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
  await toolAct(async () =>
    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })),
  );
  expect(tabs[1].getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(tabs[1]);
  expect(container.querySelector('[role="tabpanel"]')!.getAttribute("aria-labelledby")).toBe(
    tabs[1].id,
  );
  expect(hostFeatureRequest).toHaveBeenCalledWith("/repo", "browser.shared", "browser.status", {
    leaseId: undefined,
  });
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
  const clickTab = async (name: string) =>
    toolAct(async () => {
      [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
        .find((tab) => tab.textContent === name)!
        .click();
    });
  await clickTab("Devices");
  await clickTab("Host browser");
  await clickTab("Resource usage");
  await toolAct(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Sample now")!
      .click(),
  );
  expect(hostFeatureRequest).toHaveBeenCalledWith(cwd, "device.host", "devices.status", {});
  expect(hostFeatureRequest).toHaveBeenCalledWith(cwd, "browser.shared", "browser.status", {
    leaseId: undefined,
  });
  expect(hostFeatureRequest).toHaveBeenCalledWith(cwd, "resources.diagnostics", "resources.read");
  expect(vi.mocked(hostFeatureRequest).mock.calls.every((call) => call[0] === cwd)).toBe(true);
});

it("resets device control when switching conversations in the same project", async () => {
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) =>
    method === "devices.list"
      ? {
          devices: [{ id: "sim", name: "iPhone", platform: "ios", booted: true, physical: false }],
          errors: [],
        }
      : {
          running: true,
          installed: true,
          agentInstalled: true,
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
  await toolAct(async () =>
    [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((tab) => tab.textContent === "Devices")!
      .click(),
  );
  await toolAct(async () =>
    container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Allow device control"]')!.click(),
  );
  expect(container.querySelector('[role="switch"][aria-label="Allow device control"]')!.getAttribute("aria-checked")).toBe("true");
  await render("second");
  await toolAct(async () =>
    [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((tab) => tab.textContent === "Devices")!
      .click(),
  );
  expect(container.querySelector('[role="switch"][aria-label="Allow device control"]')!.getAttribute("aria-checked")).toBe("false");
});

const clickToolTab = (name: string) =>
  toolAct(async () =>
    [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((tab) => tab.textContent === name)!
      .click(),
  );
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
          ? option.textContent?.startsWith("Project host")
          : option.textContent === label,
      )!
      .click(),
  );
};

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
  ).toContain("Project host · MacBook");
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
  expect(container.textContent).toContain("Devices · This computer");
  await clickToolTab("Resource usage");
  await toolAct(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Sample now")!
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
  expect(hostToolRequest).toHaveBeenCalledWith(
    cwd,
    "browser.shared",
    "browser.status",
    { leaseId: undefined },
    { kind: "machine", machineId: "linux" },
  );
  expect(container.textContent).toContain("Browser selections can be attached only");
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
  await toolAct(async () =>
    container.querySelector<HTMLButtonElement>(".host-tools-machine-refresh")!.click(),
  );
  expect(machineTrigger().getAttribute("aria-label")).toContain(
    "Selected machine unavailable · linux",
  );
  expect(container.textContent).toContain("Selected machine unavailable");
  await render("second");
  await clickToolTab("Devices");
  expect(machineTrigger().getAttribute("aria-label")).toContain("Project host");
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
    return {
      running: true,
      installed: true,
      agentInstalled: true,
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
    container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Allow device control"]')!.click(),
  );
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
  expect(container.querySelector('[role="switch"][aria-label="Allow device control"]')!.getAttribute("aria-checked")).toBe("false");
  expect(hostToolRequest).toHaveBeenCalledWith(
    "remote://macbook/repo",
    "device.host",
    "devices.status",
    {},
    { kind: "local" },
  );
});
