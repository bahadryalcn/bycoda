// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetRetainedState } from "../../shared/hooks/useRetainedState";
import { DevServersPanel } from "./DevServersPanel";
import { hostFeatureRequest } from "../connections/model/hostFeatureClient";
import type { DevServer, DevServerDetails } from "./devServerTypes";

vi.mock("../connections/model/hostFeatureClient", () => ({ hostFeatureRequest: vi.fn() }));
vi.mock("../connections/model/workspaceUrls", () => ({
  accessibleDevelopmentUrl: vi.fn(async (_cwd: string, url: string) => url),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../connections/ui/ProjectTunnelDialog", () => ({
  ProjectTunnelDialog: ({ localUrl }: { localUrl: string }) =>
    createElement("div", { "data-sharing-url": localUrl }),
}));
vi.mock("./BrowserPanel", () => ({
  BrowserPanel: ({ cwd, initialUrl }: { cwd: string; initialUrl: string }) =>
    createElement("div", { "data-preview-host": cwd }, initialUrl),
}));
let root: Root;
let container: HTMLDivElement;
const server: DevServer = {
  id: "process:41:birth-41",
  process: { pid: 41, startedAt: "birth-41", name: "node", command: "node dev.js" },
  endpoints: [
    { address: "127.0.0.1", port: 4100, url: "http://127.0.0.1:4100/" },
    { address: "::1", port: 4101, url: "http://[::1]:4101/" },
  ],
  managed: false,
  state: "running",
  name: "node",
  association: "uncertain",
  logsAvailable: false,
};
let details: DevServerDetails;
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (value) => value.textContent === text || value.getAttribute("aria-label") === text,
  )!;
const menuItem = async (text: string) => {
  if (!document.querySelector('[role="menu"]')) await act(async () => button("Actions").click());
  return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((value) =>
    value.textContent?.includes(text),
  )!;
};
const mount = (cwd = "/repo") =>
  act(async () => root.render(createElement(DevServersPanel, { cwd })));
const setInput = (label: string, value: string) => {
  const input = (
    [...container.querySelectorAll("label")].find(
      (node) => node.textContent === label,
    )! as HTMLLabelElement
  ).control as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
beforeEach(() => {
  resetRetainedState();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  details = {
    server,
    descendants: [{ pid: 42, startedAt: "birth-42", parentPid: 41, name: "node" }],
    affectedPorts: [4100, 4101, 4200],
  };
  vi.mocked(hostFeatureRequest)
    .mockReset()
    .mockImplementation(async (_cwd, _capability, method) => {
      if (method === "devServers.list") return { status: "ok", servers: [server], scannedAt: 1 };
      if (method === "devServers.details") return details;
      if (method === "devServers.logs") return { available: false, output: "" };
      if (method === "devServers.stop")
        return {
          state: "running",
          requiresForce: true,
          affectedPorts: [4100, 4101],
          message: "Still running",
        };
      if (method === "devServers.kill")
        return { state: "stopped", requiresForce: false, affectedPorts: [4100, 4101] };
      return {};
    });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("groups ports by process and discloses uncertain project association and unavailable logs", async () => {
  await mount();
  expect(container.querySelectorAll(".dev-server-row")).toHaveLength(1);
  expect(container.querySelector(".dev-server-ports")!.textContent).toBe(":4100 :4101");
  expect(container.textContent).toContain("http://127.0.0.1:4100/");
  expect(container.textContent).toContain("PID 41 · node");
  expect(container.textContent).toContain("Project association uncertain");
  await act(async () => button("Process details").click());
  await act(async () => button("Show logs").click());
  expect(container.textContent).toContain("Logs are unavailable for this external process.");
});

it.each(["Process details", "Stop", "Restart"])(
  "reveals the selected controls after clicking %s",
  async (label) => {
    await mount();
    await act(async () => button(label).click());
    expect(document.activeElement).toBe(container.querySelector(".dev-server-details"));
    if (label === "Stop") expect(button("Confirm graceful stop")).toBeDefined();
    if (label === "Restart") expect(button("Confirm restart")).toBeDefined();
  },
);

it("reveals a failed process request and restores the row after a failed stop", async () => {
  await mount();
  vi.mocked(hostFeatureRequest).mockRejectedValueOnce(new Error("Process identity changed"));
  await act(async () => button("Process details").click());
  expect(document.activeElement?.textContent).toBe("Process identity changed");
  expect(document.activeElement?.tagName).toBe("DIV");
  expect(document.activeElement?.getAttribute("role")).toBe("alert");
  expect(document.activeElement?.classList.contains("bycoda-arc")).toBe(true);
  expect(document.activeElement?.classList.contains("host-tool-error-payload")).toBe(true);
  await act(async () => button("Stop").click());
  vi.mocked(hostFeatureRequest).mockRejectedValueOnce(new Error("Host disconnected"));
  await act(async () => button("Confirm graceful stop").click());
  expect(document.activeElement?.textContent).toBe("Host disconnected");
  expect(container.querySelector(".dev-server-row")?.textContent).toContain("Running");
  expect(button("Confirm graceful stop").disabled).toBe(false);
});

it("shares the chosen server address including its IPv6 loopback", async () => {
  vi.mocked(hostFeatureRequest).mockResolvedValueOnce({
    status: "ok",
    servers: [{ ...server, endpoints: [server.endpoints[1]] }],
    scannedAt: 1,
  });
  await mount();
  const share = await menuItem("Share server");
  await act(async () => share.click());
  expect(container.querySelector("[data-sharing-url]")?.getAttribute("data-sharing-url")).toBe(
    "http://[::1]:4101/",
  );
});

it("distinguishes an empty successful scan from a failed scan", async () => {
  vi.mocked(hostFeatureRequest).mockResolvedValueOnce({ status: "ok", servers: [], scannedAt: 1 });
  await mount();
  expect(container.textContent).toContain("No servers found");
  vi.mocked(hostFeatureRequest).mockResolvedValueOnce({
    status: "error",
    servers: [],
    scannedAt: 2,
    error: "Permission denied",
  });
  await act(async () => button("Refresh").click());
  expect(container.textContent).toContain("Scan failed");
  expect(container.textContent).not.toContain("No servers found");
  expect(container.textContent).toContain("Permission denied");
});

it("shows affected ports before graceful stop and requires a separate explicit force choice", async () => {
  await mount();
  await act(async () => button("Stop").click());
  expect(container.textContent).toContain("Affected ports");
  expect(container.querySelector(".dev-server-details")!.textContent).toContain("4100, 4101");
  expect(
    vi.mocked(hostFeatureRequest).mock.calls.some((call) => call[2] === "devServers.stop"),
  ).toBe(false);
  await act(async () => button("Confirm graceful stop").click());
  expect(hostFeatureRequest).toHaveBeenCalledWith("/repo", "dev.servers", "devServers.stop", {
    id: server.id,
    identity: { pid: 41, startedAt: "birth-41" },
    tree: false,
  });
  expect(button("Confirm force terminate")).toBeDefined();
  expect(
    vi.mocked(hostFeatureRequest).mock.calls.some((call) => call[2] === "devServers.kill"),
  ).toBe(false);
  await act(async () => button("Confirm force terminate").click());
  expect(hostFeatureRequest).toHaveBeenCalledWith("/repo", "dev.servers", "devServers.kill", {
    id: server.id,
    identity: { pid: 41, startedAt: "birth-41" },
    tree: false,
  });
});

it("discloses descendant ports and only includes child processes after the user selects them", async () => {
  await mount();
  const kill = await menuItem("Force terminate");
  await act(async () => kill.click());
  expect(hostFeatureRequest).toHaveBeenCalledWith("/repo", "dev.servers", "devServers.details", {
    id: server.id,
    identity: { pid: 41, startedAt: "birth-41" },
    tree: true,
  });
  await act(async () => container.querySelector<HTMLInputElement>('[type="checkbox"]')!.click());
  expect(container.querySelector(".dev-server-details")!.textContent).toContain("4100, 4101, 4200");
  await act(async () => button("Confirm force terminate").click());
  expect(hostFeatureRequest).toHaveBeenCalledWith("/repo", "dev.servers", "devServers.kill", {
    id: server.id,
    identity: { pid: 41, startedAt: "birth-41" },
    tree: true,
  });
});

it("requires exact restart information for external processes and sends user-entered values", async () => {
  details = {
    ...details,
    server: { ...server, process: { ...server.process!, command: undefined } },
  };
  await mount();
  await act(async () => button("Restart").click());
  expect(button("Confirm restart").disabled).toBe(true);
  await act(async () => {
    setInput("Restart command", "node ./dev.js --port 4300");
    setInput("Restart working directory", "/repo/custom");
  });
  expect(button("Confirm restart").disabled).toBe(false);
  await act(async () => button("Confirm restart").click());
  expect(hostFeatureRequest).toHaveBeenCalledWith("/repo", "dev.servers", "devServers.restart", {
    id: server.id,
    identity: { pid: 41, startedAt: "birth-41" },
    tree: true,
    command: "node ./dev.js --port 4300",
    cwd: "/repo/custom",
  });
});

it("keeps observed external argv read-only until the user defines an exact restart command", async () => {
  const observedCommand = 'node /repo with spaces/dev.js --title "hello world"';
  details = {
    ...details,
    server: {
      ...server,
      command: observedCommand,
      process: { ...server.process!, command: observedCommand, cwd: "/repo with spaces" },
    },
  };
  await mount();
  await act(async () => button("Restart").click());
  const field = (label: string) =>
    (
      [...container.querySelectorAll("label")].find(
        (node) => node.textContent === label,
      )! as HTMLLabelElement
    ).control as HTMLInputElement;
  expect(container.querySelector(".dev-server-metadata")!.textContent).toContain(observedCommand);
  expect(field("Restart command").value).toBe("");
  expect(field("Restart working directory").value).toBe("/repo with spaces");
  expect(button("Confirm restart").disabled).toBe(true);
  await act(async () => setInput("Restart command", 'node "./dev.js" --title "hello world"'));
  expect(button("Confirm restart").disabled).toBe(false);
  await act(async () => button("Confirm restart").click());
  expect(hostFeatureRequest).toHaveBeenCalledWith("/repo", "dev.servers", "devServers.restart", {
    id: server.id,
    identity: { pid: 41, startedAt: "birth-41" },
    tree: true,
    command: 'node "./dev.js" --title "hello world"',
    cwd: "/repo with spaces",
  });
});

it("routes preview and external opening through the selected remote host", async () => {
  const cwd = "remote://remote-host/repo";
  await mount(cwd);
  const host = await menuItem("Open in external browser on host");
  await act(async () => host.click());
  expect(hostFeatureRequest).toHaveBeenCalledWith(cwd, "dev.servers", "devServers.openExternal", {
    id: server.id,
    identity: { pid: 41, startedAt: "birth-41" },
    tree: false,
    port: 4100,
    address: "127.0.0.1",
  });
  await act(async () => button("Open in preview").click());
  expect(
    container.querySelector('[data-preview-host="remote://remote-host/repo"]')!.textContent,
  ).toBe("http://127.0.0.1:4100/");
});

it("shows a port conflict and accepts another port only through an explicit command", async () => {
  await act(async () =>
    root.render(
      createElement(DevServersPanel, {
        cwd: "/repo",
        launch: {
          input: { name: "Dev", command: "node dev.js --port 4100", expectedPort: 4100 },
          result: { conflict: { port: 4100, servers: [server] } },
        },
      }),
    ),
  );
  expect(container.textContent).toContain("Port 4100 is already in use.");
  expect(container.querySelector('[aria-label="Port conflict"]')!.textContent).toContain("PID 41");
  await act(async () => {
    setInput("Server command", "node dev.js --port 4300");
    setInput("Expected port (optional)", "4300");
  });
  await act(async () => button("Start command").click());
  expect(hostFeatureRequest).toHaveBeenCalledWith("/repo", "dev.servers", "devServers.start", {
    name: "Dev",
    command: "node dev.js --port 4300",
    expectedPort: 4300,
  });
});

it("keeps polling sequential, ignores late reads from another host and stops when unmounted", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(hostFeatureRequest).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await mount("/old");
  await act(async () => vi.advanceTimersByTimeAsync(12_000));
  expect(hostFeatureRequest).toHaveBeenCalledTimes(1);
  await mount("/new");
  await act(async () =>
    finish({ status: "ok", servers: [{ ...server, name: "Old server" }], scannedAt: 1 }),
  );
  expect(container.textContent).not.toContain("Old server");
  await act(async () => root.unmount());
  const count = vi.mocked(hostFeatureRequest).mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(20_000));
  expect(hostFeatureRequest).toHaveBeenCalledTimes(count);
});

it("shares the initial scan across Strict Mode effect replay", async () => {
  await act(async () =>
    root.render(createElement(StrictMode, null, createElement(DevServersPanel, { cwd: "/repo" }))),
  );
  expect(hostFeatureRequest).toHaveBeenCalledTimes(1);
  expect(container.querySelectorAll(".dev-server-row")).toHaveLength(1);
  expect(button("Refresh").disabled).toBe(false);
});

it("preserves the last successful rows and scroll position when a background scan fails", async () => {
  await mount();
  const row = container.querySelector(".dev-server-row");
  container.scrollTop = 420;
  vi.mocked(hostFeatureRequest).mockRejectedValueOnce(new Error("Host disconnected"));
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(container.querySelector(".dev-server-row")).toBe(row);
  expect(container.scrollTop).toBe(420);
  expect(container.textContent).toContain("Showing the last successful scan. Retry to update.");
  expect(container.textContent).toContain("Host disconnected");
  expect(button("Open in preview").disabled).toBe(false);
  await act(async () => button("Retry scan").click());
  expect(container.textContent).not.toContain("Host disconnected");
  expect(container.querySelector(".dev-server-row")).toBe(row);
});

it("searches the server name, process, port and URL without making host requests", async () => {
  vi.mocked(hostFeatureRequest).mockResolvedValueOnce({
    status: "ok",
    servers: [
      server,
      {
        ...server,
        id: "api",
        name: "Payments API",
        process: { ...server.process!, name: "python" },
        endpoints: [{ address: "127.0.0.1", port: 8000, url: "http://localhost:8000/api" }],
      },
    ],
    scannedAt: 1,
  });
  await mount();
  for (const query of ["8000", "PAYMENTS", "python", "localhost:8000/api"]) {
    await act(async () => setInput("Find server", query));
    expect(container.querySelectorAll(".dev-server-list .dev-server-row")).toHaveLength(1);
    expect(
      container.querySelector(".dev-server-list .dev-server-row")!.getAttribute("aria-label"),
    ).toBe("Payments API");
  }
  await act(async () => setInput("Find server", "missing"));
  expect(container.textContent).toContain("No servers match your search.");
  await act(async () => setInput("Find server", ""));
  expect(container.querySelectorAll(".dev-server-list .dev-server-row")).toHaveLength(2);
  expect(hostFeatureRequest).toHaveBeenCalledTimes(1);
});

it("keeps local controls usable during discovery and prevents overlapping scans", async () => {
  await mount();
  let finish!: (value: unknown) => void;
  vi.mocked(hostFeatureRequest).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(button("Refresh").disabled).toBe(true);
  expect(button("Open in preview").disabled).toBe(false);
  expect(container.querySelector(".dev-servers-panel")!.getAttribute("aria-busy")).toBe("false");
  await act(async () => {
    setInput("Find server", "4100");
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(hostFeatureRequest).toHaveBeenCalledTimes(2);
  await act(async () => finish({ status: "ok", servers: [server], scannedAt: 2 }));
  expect(container.querySelector<HTMLInputElement>('[type="search"]')!.value).toBe("4100");
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(hostFeatureRequest).toHaveBeenCalledTimes(3);
});

it("backs off after failures and pauses after three failed scans until explicit recovery", async () => {
  await mount();
  vi.mocked(hostFeatureRequest)
    .mockRejectedValueOnce(new Error("offline"))
    .mockRejectedValueOnce(new Error("offline"))
    .mockRejectedValueOnce(new Error("offline"));
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(hostFeatureRequest).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTimeAsync(29_999));
  expect(hostFeatureRequest).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(hostFeatureRequest).toHaveBeenCalledTimes(3);
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(hostFeatureRequest).toHaveBeenCalledTimes(4);
  expect(container.textContent).toContain("Automatic refresh paused after repeated failures.");
  await act(async () => vi.advanceTimersByTimeAsync(600_000));
  expect(hostFeatureRequest).toHaveBeenCalledTimes(4);
  await act(async () => button("Retry scan").click());
  expect(hostFeatureRequest).toHaveBeenCalledTimes(5);
  expect(button("Pause automatic refresh")).toBeDefined();
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(hostFeatureRequest).toHaveBeenCalledTimes(6);
});

it("pauses discovery while hidden and resumes one scan when visible", async () => {
  await mount();
  const visibility = vi.spyOn(document, "visibilityState", "get");
  visibility.mockReturnValue("hidden");
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(hostFeatureRequest).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue("visible");
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(hostFeatureRequest).toHaveBeenCalledTimes(2);
  await act(async () => button("Pause automatic refresh").click());
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(hostFeatureRequest).toHaveBeenCalledTimes(2);
  visibility.mockRestore();
});

it("waits for an active scan before a process operation without duplicating the operation", async () => {
  await mount();
  let finish!: (value: unknown) => void;
  vi.mocked(hostFeatureRequest).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  await act(async () => {
    button("Stop").click();
    button("Stop").click();
  });
  expect(
    vi.mocked(hostFeatureRequest).mock.calls.filter((call) => call[2] === "devServers.details"),
  ).toHaveLength(0);
  await act(async () => finish({ status: "ok", servers: [server], scannedAt: 2 }));
  expect(
    vi.mocked(hostFeatureRequest).mock.calls.filter((call) => call[2] === "devServers.details"),
  ).toHaveLength(1);
});

it("blocks duplicate destructive actions before React paints the busy state", async () => {
  await mount();
  await act(async () => button("Stop").click());
  let finish!: (value: unknown) => void;
  vi.mocked(hostFeatureRequest).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => {
    button("Confirm graceful stop").click();
    button("Confirm graceful stop").click();
  });
  expect(
    vi.mocked(hostFeatureRequest).mock.calls.filter((call) => call[2] === "devServers.stop"),
  ).toHaveLength(1);
  await act(async () =>
    finish({ state: "stopped", requiresForce: false, affectedPorts: [4100, 4101] }),
  );
});

it("disables process control when a birth identity is unavailable", async () => {
  vi.mocked(hostFeatureRequest).mockResolvedValueOnce({
    status: "ok",
    servers: [{ ...server, process: { ...server.process!, startedAt: "" } }],
    scannedAt: 1,
  });
  await mount();
  expect(button("Stop").disabled).toBe(true);
  expect((await menuItem("Force terminate")).disabled).toBe(true);
  expect(button("Restart").disabled).toBe(true);
});

it("restarts managed servers without asking for launch information and includes owned children", async () => {
  const managed = {
    ...server,
    managed: true,
    association: "managed" as const,
    command: "node dev.js",
    cwd: "/repo",
  };
  details = { ...details, server: managed };
  vi.mocked(hostFeatureRequest).mockResolvedValueOnce({
    status: "ok",
    servers: [managed],
    scannedAt: 1,
  });
  await mount();
  await act(async () => button("Restart").click());
  expect(button("Confirm restart").disabled).toBe(false);
  expect(container.querySelector<HTMLInputElement>('[type="checkbox"]')!.checked).toBe(true);
  expect(container.textContent).toContain("4100, 4101, 4200");
  await act(async () => button("Confirm restart").click());
  expect(hostFeatureRequest).toHaveBeenCalledWith("/repo", "dev.servers", "devServers.restart", {
    id: server.id,
    identity: { pid: 41, startedAt: "birth-41" },
    tree: true,
  });
});

it("drops a pending confirmation when another server is selected", async () => {
  const other = { ...server, id: "api", name: "Payments API" };
  vi.mocked(hostFeatureRequest).mockResolvedValueOnce({
    status: "ok",
    servers: [server, other],
    scannedAt: 1,
  });
  await mount();
  await act(async () => button("Stop").click());
  expect(button("Confirm graceful stop")).toBeDefined();
  vi.mocked(hostFeatureRequest).mockResolvedValueOnce({
    status: "ok",
    servers: [other, server],
    scannedAt: 2,
  });
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(container.querySelector(".dev-server-selection h4")!.textContent).toBe("node");
  expect(button("Confirm graceful stop")).toBeDefined();
  const row = container.querySelector<HTMLButtonElement>('[aria-label="Payments API"] button')!;
  await act(async () => row.click());
  expect(row.getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector(".dev-server-selection h4")!.textContent).toBe("Payments API");
  expect(button("Confirm graceful stop")).toBeUndefined();
});
