// @vitest-environment jsdom
// The loading section writes only owner-confirmed policy and refetches after a failed save.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ invoke: vi.fn(), remote: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("../../connections/model/connections", () => ({ remoteRequest: mock.remote }));
vi.mock("../../connections/model/localSync", () => ({ isLocalSyncMachine: () => true }));
import { clearMcpSettingsCache } from "../model/mcpSettingsCache";
import { McpLoadingMode } from "./McpLoadingMode";

afterEach(() => {
  vi.restoreAllMocks();
  mock.remote.mockReset();
  mock.invoke.mockReset();
  clearMcpSettingsCache();
});

const policy = (direct: string[]) => ({ version: 1, mode: "onDemand", direct });

it("toggles Load at start, persists direct[] and refetches after a failed save", async () => {
  mock.invoke.mockResolvedValue([{ id: "local" }]);
  let stored = policy([]);
  let fail = false;
  mock.remote.mockImplementation(async (_id: string, method: string, params: any) => {
    if (method === "mcp.hub.loading.get")
      return { policy: stored, corrupt: false, servers: ["alpha", "beta"] };
    if (fail) throw new Error("offline");
    stored = { ...stored, mode: params.mode, direct: params.direct };
    return { policy: stored, corrupt: false };
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(McpLoadingMode, { cwd: "/fixture" })));
    const switches = () => [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')];
    expect(switches()).toHaveLength(2);
    await act(async () => switches()[1].click());
    expect(mock.remote).toHaveBeenCalledWith("local", "mcp.hub.loading.set", {
      mode: "onDemand",
      direct: ["beta"],
    });
    expect(switches()[1].getAttribute("aria-checked")).toBe("true");
    fail = true;
    const gets = () => mock.remote.mock.calls.filter((c) => c[1] === "mcp.hub.loading.get").length;
    const before = gets();
    await act(async () => switches()[0].click());
    expect(container.textContent).toContain("Saving MCP loading failed");
    expect(gets()).toBe(before + 1);
    expect(switches()[0].getAttribute("aria-checked")).toBe("false");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("locks controls and explains a corrupt policy file", async () => {
  mock.invoke.mockResolvedValue([{ id: "local" }]);
  mock.remote.mockResolvedValue({ policy: policy([]), corrupt: true, servers: ["alpha"] });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(McpLoadingMode, { cwd: "/corrupt" })));
    expect(container.textContent).toContain("unreadable");
    expect(container.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
