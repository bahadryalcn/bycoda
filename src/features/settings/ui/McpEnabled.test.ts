// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRetainedState, resetRetainedState } from "../../../shared/hooks/useRetainedState";
import { clearMcpSettingsCache } from "../model/mcpSettingsCache";
import type { McpConnection } from "../model/mcp";
import { McpSettings } from "./McpSettings";

vi.mock("./ExternalMcpAccess", () => ({ ExternalMcpAccess: () => null }));
vi.mock("../../sessions", () => import("../../sessions/ui/HarnessIcon"));
vi.mock("../../projects", () => import("../../projects/ui/SearchableProjectPicker"));
const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: (...args: unknown[]) => invoke(...args),
}));

let container: HTMLDivElement;
let root: Root;
let servers: McpConnection[];

beforeEach(async () => {
  resetRetainedState();
  clearMcpSettingsCache();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  function ProjectView() {
    useRetainedState("mcp:view", "project");
    return null;
  }
  await act(async () => root.render(createElement(ProjectView)));
  servers = [
    {
      provider: "claude",
      name: "shared",
      scope: "user",
      configPath: "/home/.claude.json",
      transport: "stdio",
      enabled: false,
    },
    {
      provider: "claude",
      name: "shared",
      scope: "project",
      configPath: "/project/.mcp.json",
      transport: "stdio",
      enabled: true,
    },
    {
      provider: "codex",
      name: "shared",
      scope: "user",
      configPath: "/home/.codex/config.toml",
      transport: "stdio",
      enabled: true,
    },
  ];
  invoke.mockReset();
  invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    if (command === "mcp_discover") return servers.map((server) => ({ ...server }));
    if (command === "claude_mcp_list") return "";
    if (command === "mcp_set_enabled") {
      const server = servers.find(
        (entry) =>
          entry.provider === args.provider &&
          entry.scope === args.scope &&
          entry.name === args.name &&
          entry.configPath === args.configPath,
      );
      if (!server) throw new Error("Unknown fixture server");
      server.enabled = Boolean(args.enabled);
    }
    return undefined;
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  clearMcpSettingsCache();
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(createElement(McpSettings, { cwd: "/project" })));
}

function menus() {
  return [
    ...container.querySelectorAll<HTMLButtonElement>('button[aria-label="Actions for shared"]'),
  ];
}

function toggles() {
  return [...container.querySelectorAll<HTMLButtonElement>('button[role="switch"]')];
}

async function pick(index: number, action: "Enable" | "Disable") {
  const toggle = toggles()[index];
  expect(toggle, `${action} must be available on the exact server row`).toBeDefined();
  expect(toggle.getAttribute("aria-checked")).toBe(action === "Enable" ? "false" : "true");
  await act(async () => toggle.click());
}

it("enables and disables the exact provider, scope and configuration among duplicate names", async () => {
  await render();
  await pick(0, "Enable");
  expect(invoke).toHaveBeenCalledWith("mcp_set_enabled", {
    cwd: "/project",
    provider: "claude",
    name: "shared",
    scope: "user",
    configPath: "/home/.claude.json",
    enabled: true,
    expectedEnabled: false,
  });
  expect(servers.map((server) => server.enabled)).toEqual([true, true, true]);
  await pick(1, "Disable");
  expect(invoke).toHaveBeenCalledWith("mcp_set_enabled", {
    cwd: "/project",
    provider: "claude",
    name: "shared",
    scope: "project",
    configPath: "/project/.mcp.json",
    enabled: false,
    expectedEnabled: true,
  });
  expect(servers.map((server) => server.enabled)).toEqual([true, false, true]);
  await pick(2, "Disable");
  expect(invoke).toHaveBeenCalledWith("mcp_set_enabled", {
    cwd: "/project",
    provider: "codex",
    name: "shared",
    scope: "user",
    configPath: "/home/.codex/config.toml",
    enabled: false,
    expectedEnabled: true,
  });
  expect(invoke.mock.calls.filter(([command]) => command === "mcp_discover")).toHaveLength(4);
});

it("locks every row while enable is pending and refreshes only after confirmed success", async () => {
  let finish!: () => void;
  invoke.mockImplementation(async (command: string) => {
    if (command === "mcp_discover") return servers;
    if (command === "mcp_set_enabled")
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    return undefined;
  });
  await render();
  await pick(0, "Enable");
  expect(
    [...menus(), ...toggles()].every(
      (button) => button.disabled || button.getAttribute("aria-disabled") === "true",
    ),
  ).toBe(true);
  await act(async () => toggles()[0].click());
  expect(invoke.mock.calls.filter(([command]) => command === "mcp_set_enabled")).toHaveLength(1);
  expect(invoke.mock.calls.filter(([command]) => command === "mcp_discover")).toHaveLength(1);
  await act(async () => finish());
  expect(invoke.mock.calls.filter(([command]) => command === "mcp_discover")).toHaveLength(2);
  expect(menus().every((button) => !button.disabled)).toBe(true);
});

it("preserves disabled state after a rejected write without refreshing or retrying", async () => {
  invoke.mockImplementation(async (command: string) => {
    if (command === "mcp_discover") return servers;
    if (command === "mcp_set_enabled") throw new Error("Config changed while saving");
    return undefined;
  });
  await render();
  await pick(0, "Enable");
  expect(container.textContent).toContain("Config changed while saving");
  expect(servers[0].enabled).toBe(false);
  expect(invoke.mock.calls.filter(([command]) => command === "mcp_discover")).toHaveLength(1);
  expect(toggles()[0].getAttribute("aria-checked")).toBe("false");
  expect(toggles()[0].disabled).toBe(false);
});

it.each(["cursor", "claude_desktop"] as const)(
  "keeps unsupported %s toggles unavailable",
  async (provider) => {
    servers = [{ ...servers[0], provider }];
    await render();
    const item = toggles()[0];
    expect(item.disabled).toBe(true);
    await act(async () => item.click());
    expect(invoke.mock.calls.some(([command]) => command === "mcp_set_enabled")).toBe(false);
  },
);

it("keeps Claude permissions project-only and writes Codex Global identity", async () => {
  resetRetainedState();
  await render();
  expect(toggles()).toHaveLength(2);
  expect(toggles()[0].disabled).toBe(true);
  await act(async () => toggles()[1].click());
  expect(invoke).toHaveBeenCalledWith(
    "mcp_set_enabled",
    expect.objectContaining({
      provider: "codex",
      scope: "user",
      globalOnly: true,
      configPath: "/home/.codex/config.toml",
    }),
  );
});
