// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRetainedState, resetRetainedState } from "../../../shared/hooks/useRetainedState";
import type { McpHub } from "../hooks/useMcpHub";
import { McpSettings } from "./McpSettings";
import { clearMcpSettingsCache } from "../model/mcpSettingsCache";
import { rememberRemoteProject } from "../../connections/public/remoteProjects";

// External owner-token lifecycle has its own isolated browser coverage. Keep
// these discovery/cache assertions scoped to provider MCP connections.
vi.mock("./ExternalMcpAccess", () => ({ ExternalMcpAccess: () => null }));
// The Host hub hook has its own tests (useMcpHub.test.ts); here it is a controllable stub.
const hubMock = vi.hoisted(() => ({ hub: undefined as unknown as McpHub }));
vi.mock("../hooks/useMcpHub", () => ({ useMcpHub: () => hubMock.hub }));
const machinesMock = vi.hoisted(() => ({
  machines: [] as { id: string; name: string; environmentId: string; endpoint: string }[],
  request: vi.fn(),
}));
vi.mock("../../connections/public/connections", () => ({
  useRemoteMachines: () => ({ machines: machinesMock.machines, loading: false, refresh: vi.fn() }),
  remoteRequest: machinesMock.request,
}));
// Keep this settings fixture independent of unrelated application barrel cycles.
vi.mock("../../sessions", () => import("../../sessions/ui/HarnessIcon"));
vi.mock("../../projects", () => import("../../projects/ui/SearchableProjectPicker"));

const invoke = vi.fn();
const ask = vi.fn(async () => true);
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  convertFileSrc: (path: string) => path,
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...args: unknown[]) => ask(...args),
}));
vi.mock("../../../shared/model/appConfirm", () => ({
  confirmInApp: (...args: unknown[]) => ask(...args),
}));

function makeHub(over: Partial<McpHub> = {}): McpHub {
  return {
    pending: false,
    error: "",
    saving: false,
    waiting: "",
    busy: "",
    dismissError: vi.fn(),
    refresh: vi.fn(async () => {}),
    setMode: vi.fn(async () => {}),
    setDirect: vi.fn(async () => {}),
    signIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    ...over,
  };
}

let container: HTMLDivElement;
const addServerButton = () =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Add server",
  ) ?? null;
let root: Root;

beforeEach(async () => {
  resetRetainedState();
  clearMcpSettingsCache();
  hubMock.hub = makeHub();
  machinesMock.machines = [];
  machinesMock.request.mockReset();
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
  invoke.mockReset();
  invoke.mockImplementation(async (command: string) =>
    command === "mcp_discover"
      ? [
          {
            provider: "claude",
            name: "sentry",
            scope: "user",
            configPath: "/home/.claude.json",
            transport: "http",
          },
          {
            provider: "codex",
            name: "docs",
            scope: "user",
            configPath: "/home/.codex/config.toml",
            transport: "http",
          },
        ]
      : command === "claude_mcp_list"
        ? "sentry: https://mcp.example.com - ! Needs authentication"
        : command === "mcp_server_config_read"
          ? { config: "{}", revision: "r1" }
          : undefined,
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  clearMcpSettingsCache();
  container.remove();
  vi.unstubAllGlobals();
});

async function refreshStatus() {
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Refresh"]')!.click(),
  );
}

const rowButton = (name: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="Open ${name}"]`);
const rowOf = (name: string) => rowButton(name)!.closest<HTMLElement>("[data-collection-row]")!;
const quickSignIn = (name: string) =>
  [...rowOf(name).querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Sign in",
  );
const allQuickSignIns = () =>
  [...container.querySelectorAll<HTMLButtonElement>("[data-collection-row] button")].filter(
    (button) => button.textContent === "Sign in",
  );
const sheet = () => document.querySelector<HTMLElement>('[role="dialog"]');
const sheetButtons = (label: string) =>
  [...(sheet()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].filter(
    (button) => button.textContent === label,
  );
async function openDetail(name: string) {
  await act(async () => rowButton(name)!.click());
  expect(sheet(), `detail sheet for ${name}`).not.toBeNull();
}

async function openProviderJson() {
  const details = sheet()!.querySelector<HTMLDetailsElement>("details")!;
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
}

it("keeps a configuration draft open when discovery loses its server", async () => {
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  await openDetail("docs");
  await openProviderJson();
  const editor = sheet()!.querySelector<HTMLTextAreaElement>("textarea")!;
  const draft = '{"args":["keep"]}';
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      editor,
      draft,
    );
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(sheetButtons("Save")[0]?.disabled).toBe(false);

  invoke.mockImplementation(async (command: string) => (command === "mcp_discover" ? [] : ""));
  await refreshStatus();

  expect(rowButton("docs")).toBeNull();
  expect(sheet()?.querySelector("textarea")?.value).toBe(draft);
  expect(sheet()?.textContent).toContain("Unavailable");
  expect(sheetButtons("Save")[0]?.disabled).toBe(true);
});

it("groups providers that share a name into one row and keeps progress on the exact action", async () => {
  let finishLogin!: () => void;
  invoke.mockImplementation(async (command: string) => {
    if (command === "mcp_discover")
      return [
        {
          provider: "claude",
          name: "shared-name",
          scope: "user",
          configPath: "/home/.claude.json",
          transport: "http",
        },
        {
          provider: "codex",
          name: "shared-name",
          scope: "user",
          configPath: "/home/.codex/config.toml",
          transport: "http",
        },
      ];
    if (command === "claude_mcp_list")
      return "shared-name: https://mcp.example.com - ! Needs authentication";
    if (command === "mcp_server_config_read") return { config: "{}", revision: "r1" };
    if (command === "mcp_provider_login")
      return new Promise((resolve) => {
        finishLogin = () => resolve(undefined);
      });
    return undefined;
  });
  await act(async () => root.render(createElement(McpSettings, { cwd: "/local-project" })));
  expect(container.querySelectorAll("[data-collection-row]")).toHaveLength(1);
  expect(rowOf("shared-name").textContent).toContain("Claude Code · Codex");
  await openDetail("shared-name");
  // One Sign in per provider configuration.
  const signIns = sheetButtons("Sign in");
  expect(signIns).toHaveLength(2);
  await act(async () => signIns[0].click());
  expect(signIns[0].getAttribute("aria-busy")).toBe("true");
  expect(signIns[1].getAttribute("aria-busy")).not.toBe("true");
  await act(async () => signIns[0].click());
  expect(invoke.mock.calls.filter(([command]) => command === "mcp_provider_login")).toHaveLength(1);
  expect(invoke).toHaveBeenCalledWith("mcp_provider_login", {
    cwd: "/local-project",
    provider: "claude",
    name: "shared-name",
  });
  await act(async () => finishLogin());
});

it("confirms before removing a Claude entry and sends scope and name only after confirmation", async () => {
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  await openDetail("sentry");
  const remove = () => sheetButtons("Remove")[0];
  ask.mockResolvedValueOnce(false);
  await act(async () => remove().click());
  expect(ask).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Remove MCP server?",
      confirmLabel: "Remove server",
      tone: "danger",
    }),
  );
  expect(invoke.mock.calls.some(([command]) => command === "claude_mcp_remove")).toBe(false);
  await act(async () => remove().click());
  expect(invoke).toHaveBeenCalledWith("claude_mcp_remove", {
    cwd: "/repo",
    name: "sentry",
    scope: "user",
  });
  // Only Claude entries can be removed here; the Codex entry offers no Remove.
  await act(async () =>
    sheet()!.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click(),
  );
  await openDetail("docs");
  expect(sheetButtons("Remove")).toHaveLength(0);
});

it("keeps an unavailable remote project selected and permits choosing a local project", async () => {
  await act(async () =>
    root.render(
      createElement(McpSettings, {
        cwd: "remote://fixture-host/work/remote-project",
        recents: [
          { path: "/local-project", openedAt: 1 },
          { path: "remote://fixture-host/work/other-remote", openedAt: 2 },
        ],
      }),
    ),
  );
  expect(container.textContent).toContain("This computer is no longer available in Connections.");
  expect(addServerButton()).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
  const picker = container.querySelector<HTMLButtonElement>(
    '[aria-label^="Switch project, current project"]',
  )!;
  await act(async () => picker.click());
  const options = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
  );
  expect(options.some((option) => option.textContent?.includes("other-remote"))).toBe(true);
  const local = options.find((option) => option.textContent?.includes("local-project"))!;
  await act(async () => local.click());
  expect(invoke).toHaveBeenCalledWith("mcp_discover", { cwd: "/local-project" });
  expect(invoke.mock.calls.every(([, args]) => !args?.cwd?.startsWith("remote://"))).toBe(true);
  expect(addServerButton()).not.toBeNull();
});

it("uses the owning Host and project ID for Project, then discovers this computer in Global", async () => {
  const cwd = "remote://fixture-host/work/remote-project";
  rememberRemoteProject("fixture-host", {
    id: "registered-project",
    name: "remote-project",
    cwd: "/work/remote-project",
  });
  machinesMock.machines = [
    { id: "saved-host", name: "Office PC", environmentId: "fixture-host", endpoint: "http://host" },
  ];
  machinesMock.request.mockResolvedValue({ connections: [], warnings: [] });
  await act(async () => root.render(createElement(McpSettings, { cwd })));
  expect(container.textContent).toContain("Office PC");
  expect(machinesMock.request).toHaveBeenCalledWith(
    "saved-host",
    "mcp.config.call",
    {
      projectId: "registered-project",
      command: "mcp_discover",
      args: {},
    },
    false,
    false,
    "fixture-host",
  );
  expect(invoke).not.toHaveBeenCalled();

  const global = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Global",
  )!;
  await act(async () => global.click());
  expect(invoke).toHaveBeenCalledWith("mcp_discover", { cwd: "~", globalOnly: true });
  const chooser = container.querySelector<HTMLButtonElement>('[aria-label^="Computer"]')!;
  await act(async () => chooser.click());
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
    (item) => item.textContent === "Office PC",
  )!;
  await act(async () => option.click());
  expect(machinesMock.request).toHaveBeenLastCalledWith(
    "saved-host",
    "mcp.config.call",
    {
      projectId: undefined,
      command: "mcp_discover",
      args: {},
    },
    false,
    false,
    "fixture-host",
  );
});

async function selectProject(path: string) {
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label^="Switch project"]')!.click(),
  );
  expect(document.querySelector('input[placeholder="Search projects…"]')).not.toBeNull();
  // Each project option names the project's folder (its full path shows only as a tooltip).
  const name = path.split("/").pop()!;
  const option = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
  ).find((button) =>
    Array.from(button.querySelectorAll("span")).some((span) => span.textContent === name),
  )!;
  await act(async () => option.click());
}

const filterDialog = () =>
  document.querySelector('[role="dialog"][aria-label="Filter MCP servers"]');
async function openFilters() {
  if (!filterDialog()) {
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Filters"]')!.click(),
    );
  }
}
const sourceButton = (label: string) =>
  [...filterDialog()!.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === label,
  )!;
async function search(text: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("lists servers and offers a quick Sign in that routes through the provider", async () => {
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  await refreshStatus();
  expect(container.textContent).toContain("sentry");
  expect(rowOf("sentry").textContent).toContain("Needs sign-in");
  expect(rowOf("docs").textContent).toContain("Codex");
  await act(async () => quickSignIn("sentry")!.click());
  expect(invoke).toHaveBeenCalledWith("mcp_provider_login", {
    cwd: "/repo",
    provider: "claude",
    name: "sentry",
  });
});

it("filters connections by provider", async () => {
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  await openFilters();
  await act(async () => sourceButton("Codex").click());
  expect(container.textContent).toContain("docs");
  expect(container.textContent).not.toContain("sentry");
  await act(async () => quickSignIn("docs")!.click());
  expect(invoke).toHaveBeenCalledWith("mcp_provider_login", {
    cwd: "/repo",
    provider: "codex",
    name: "docs",
  });
});

it("searches by name, provider and config path", async () => {
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  await search("sentry");
  expect(rowButton("sentry")).not.toBeNull();
  expect(rowButton("docs")).toBeNull();
  await search("config.toml");
  expect(rowButton("docs")).not.toBeNull();
  expect(rowButton("sentry")).toBeNull();
  await search("nothing-like-this");
  expect(container.textContent).toContain("No MCP servers match your search.");
});

it("resets the provider and search together from the filter panel", async () => {
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  await openFilters();
  await act(async () => sourceButton("Codex").click());
  await search("missing");
  await act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Reset filters")!
      .click();
  });
  const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
  expect(input.value).toBe("");
  expect(container.textContent).toContain("sentry");
  expect(container.textContent).toContain("docs");
});

it("keeps a saved provider filter during a cold delayed discovery after returning to Settings", async () => {
  const render = () => act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  await render();
  await openFilters();
  await act(async () => sourceButton("Codex").click());
  await act(async () => root.unmount());
  clearMcpSettingsCache();
  root = createRoot(container);
  const configured = invoke.getMockImplementation()!;
  let finish!: (rows: unknown) => void;
  invoke.mockImplementation((command, ...args) =>
    command === "mcp_discover"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : configured(command, ...args),
  );
  await render();
  await act(async () => finish(await configured("mcp_discover")));
  expect(container.textContent).toContain("docs");
  expect(container.textContent).not.toContain("sentry");
  await openFilters();
  expect(sourceButton("Codex").getAttribute("aria-pressed")).toBe("true");
});

it("shows configured rows while Claude health is still pending", async () => {
  let resolveHealth!: (output: string) => void;
  const discovery = invoke.getMockImplementation()!;
  invoke.mockImplementation((command: string, args: unknown) =>
    command === "claude_mcp_list"
      ? new Promise((resolve) => {
          resolveHealth = resolve;
        })
      : discovery(command, args),
  );
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  await refreshStatus();
  expect(container.textContent).toContain("docs");
  expect(container.textContent).toContain("sentry");
  expect(container.textContent).not.toContain("Checking servers…");
  // Unknown until Claude answers: not "Needs sign-in" yet.
  expect(rowOf("sentry").textContent).not.toContain("Needs sign-in");
  expect(quickSignIn("sentry")).toBeUndefined();
  await act(async () => resolveHealth("sentry: https://example.com - Needs authentication"));
  expect(rowOf("sentry").textContent).toContain("Needs sign-in");
});

it("adds a standard mcpServers entry to the selected provider and project", async () => {
  await act(async () =>
    root.render(
      createElement(McpSettings, {
        cwd: "/repo",
        recents: [{ path: "/other", openedAt: 1 }],
      }),
    ),
  );
  await selectProject("/other");
  await act(async () => addServerButton()!.click());
  expect(document.body.textContent).toContain("Add MCP server");
  const provider = document.body.querySelector<HTMLButtonElement>(
    '[aria-label="Provider: Claude Code"]',
  )!;
  await act(async () => provider.click());
  const cursor = [...document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
    (button) => button.textContent === "Cursor",
  )!;
  await act(async () => cursor.click());
  await act(async () =>
    document.body
      .querySelector<HTMLButtonElement>('[aria-label="Setup method: Server URL"]')!
      .click(),
  );
  const jsonOption = [...document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
    (button) => button.textContent === "JSON configuration",
  )!;
  await act(async () => jsonOption.click());
  const config = document.body.querySelector<HTMLTextAreaElement>("textarea")!;
  const json = '{"mcpServers":{"new-server":{"command":"npx","args":["example"]}}}';
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      config,
      json,
    );
    config.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    document.body
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(invoke).toHaveBeenCalledWith("mcp_add", {
    cwd: "/other",
    provider: "cursor",
    name: "",
    config: json,
    scope: "project",
  });
  expect(invoke).toHaveBeenCalledWith("claude_mcp_list", { cwd: "/other" });
  expect(invoke).toHaveBeenCalledWith("codex_mcp_list", { cwd: "/other" });
});

it("navigates provider choices with arrow keys", async () => {
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  await act(async () => addServerButton()!.click());
  await act(async () =>
    document.body.querySelector<HTMLButtonElement>('[aria-label="Provider: Claude Code"]')!.click(),
  );
  const list = document.body.querySelector<HTMLElement>('[role="listbox"][aria-label="Provider"]')!;
  const options = list.querySelectorAll<HTMLButtonElement>('[role="option"]');
  await act(async () =>
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })),
  );
  expect(list.getAttribute("aria-activedescendant")).toBe(options[0].id);
  await act(async () =>
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })),
  );
  expect(list.getAttribute("aria-activedescendant")).toBe(options[options.length - 1].id);
});

it("hides Sign in when a server has no known transport", async () => {
  invoke.mockImplementation(async (command: string) =>
    command === "mcp_discover"
      ? [
          {
            provider: "claude",
            name: "unknown",
            scope: "local",
            configPath: "",
            transport: "",
          },
        ]
      : "",
  );
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  expect(container.textContent).toContain("unknown");
  expect(allQuickSignIns()).toHaveLength(0);
  await openDetail("unknown");
  expect(sheetButtons("Sign in")).toHaveLength(0);
});

it("exposes configured remote sign-in per provider without offering it to disabled or local tools", async () => {
  const connections = [
    ...(["claude", "codex", "cursor", "opencode"] as const).map((provider) => ({
      provider,
      name: `${provider}-cloudflare`,
      scope: "user",
      configPath: `/config/${provider}`,
      transport: "http",
    })),
    {
      provider: "codex",
      name: "disabled",
      scope: "user",
      configPath: "/config/codex",
      transport: "http",
      enabled: false,
    },
    {
      provider: "claude",
      name: "local-tool",
      scope: "user",
      configPath: "/config/claude",
      transport: "stdio",
    },
    {
      provider: "claude_desktop",
      name: "desktop",
      scope: "user",
      configPath: "/config/desktop",
      transport: "http",
    },
  ];
  invoke.mockImplementation(async (command: string) =>
    command === "mcp_discover" ? connections : "",
  );
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  expect(allQuickSignIns()).toHaveLength(4);
  for (const provider of ["claude", "codex", "cursor", "opencode"]) {
    await act(async () => quickSignIn(`${provider}-cloudflare`)!.click());
    expect(invoke).toHaveBeenCalledWith("mcp_provider_login", {
      cwd: "/repo",
      provider,
      name: `${provider}-cloudflare`,
    });
  }
  expect(rowOf("disabled").textContent).toContain("Off");
  // Configured is the quiet default: the dot names it, the row writes nothing.
  expect(rowOf("local-tool").querySelector('[aria-label="Configured"]')).not.toBeNull();
  expect(rowOf("local-tool").textContent).not.toContain("Configured");
  expect(rowOf("desktop").querySelector('[aria-label="Configured"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Ready");
});

it("shows a connected server as Ready and keeps repeat sign-in in its detail", async () => {
  invoke.mockImplementation(async (command: string) =>
    command === "mcp_discover"
      ? [
          {
            provider: "claude",
            name: "connected",
            scope: "user",
            configPath: "/config/claude",
            transport: "http",
          },
        ]
      : command === "claude_mcp_list"
        ? "connected: https://example.test/mcp - ✔ Connected"
        : command === "mcp_server_config_read"
          ? { config: "{}", revision: "r1" }
          : undefined,
  );
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  await refreshStatus();
  expect(rowOf("connected").textContent).toContain("Ready");
  expect(allQuickSignIns()).toHaveLength(0);
  await openDetail("connected");
  await act(async () => sheetButtons("Sign in")[0].click());
  expect(invoke).toHaveBeenCalledWith("mcp_provider_login", {
    cwd: "/repo",
    provider: "claude",
    name: "connected",
  });
});

it("shows no sign-in until Claude health arrives, then keeps a timed-out partial result", async () => {
  let finish!: (result: { output: string; timedOut: boolean }) => void;
  invoke.mockImplementation((command: string) =>
    command === "mcp_discover"
      ? Promise.resolve([
          {
            provider: "claude",
            name: "hostinger",
            scope: "user",
            configPath: "/config/claude",
            transport: "http",
          },
          {
            provider: "claude",
            name: "arc",
            scope: "user",
            configPath: "/config/claude",
            transport: "http",
          },
        ])
      : command === "claude_mcp_list"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(undefined),
  );
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  await refreshStatus();
  expect(allQuickSignIns()).toHaveLength(0);
  // Windows consoles print √; arc was never reached before the CLI was stopped.
  await act(async () =>
    finish({ output: "hostinger: https://mcp.hostinger.com (HTTP) - √ Connected", timedOut: true }),
  );
  expect(rowOf("hostinger").textContent).toContain("Ready");
  expect(quickSignIn("hostinger")).toBeUndefined();
  expect(container.textContent).toContain("Claude did not finish checking every server in time.");
  expect(allQuickSignIns()).toHaveLength(1);
  expect(quickSignIn("arc")).toBeDefined();
});

it("uses Codex sign-in state, tags scopes and explains a missing Cursor CLI", async () => {
  invoke.mockImplementation(async (command: string) =>
    command === "mcp_discover"
      ? [
          {
            provider: "codex",
            name: "cloudflare",
            scope: "user",
            configPath: "/home/.codex/config.toml",
            transport: "http",
          },
          {
            provider: "codex",
            name: "stripe",
            scope: "user",
            configPath: "/home/.codex/config.toml",
            transport: "http",
          },
          {
            provider: "codex",
            name: "mem0",
            scope: "user",
            configPath: "/home/.codex/config.toml",
            transport: "http",
          },
          {
            provider: "cursor",
            name: "hostinger",
            scope: "project",
            configPath: "/repo/.cursor/mcp.json",
            transport: "http",
          },
        ]
      : command === "codex_mcp_list"
        ? [
            { name: "cloudflare", authStatus: "o_auth" },
            { name: "stripe", authStatus: "not_logged_in" },
            { name: "mem0", authStatus: "unsupported" },
          ]
        : command === "mcp_provider_login"
          ? Promise.reject("cursor CLI not found")
          : command === "claude_mcp_list"
            ? ""
            : undefined,
  );
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  await refreshStatus();
  expect(quickSignIn("cloudflare")).toBeUndefined();
  expect(quickSignIn("stripe")).toBeDefined();
  expect(quickSignIn("mem0")).toBeUndefined();
  expect(rowOf("hostinger").textContent).toContain("Cursor (Project)");
  await act(async () => quickSignIn("hostinger")!.click());
  expect(container.textContent).toContain("Cursor CLI (cursor-agent) is not installed.");
  expect(container.textContent).not.toContain("Showing the last successful result.");
});

it("starts a Host sign-in from the quick action and lists Host-only servers", async () => {
  hubMock.hub = makeHub({
    loading: {
      policy: { version: 1, mode: "onDemand", direct: [] },
      corrupt: false,
      servers: [],
      inventory: [
        {
          name: "plugin-docs",
          kind: "http",
          source: "claude-plugin",
          sources: ["claude-plugin"],
          aliases: [],
          signedIn: false,
        },
      ],
    },
    oauth: [{ name: "plugin-docs", state: "none" }],
  });
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  expect(rowOf("plugin-docs").textContent).toContain("Claude plugin");
  await act(async () => quickSignIn("plugin-docs")!.click());
  expect(hubMock.hub.signIn).toHaveBeenCalledWith("plugin-docs");
  expect(invoke.mock.calls.some(([command]) => command === "mcp_provider_login")).toBe(false);
});

it("sets the session startup mode and a per-server direct start from the Host policy", async () => {
  hubMock.hub = makeHub({
    loading: {
      policy: { version: 1, mode: "onDemand", direct: [] },
      corrupt: false,
      servers: ["docs"],
      inventory: [
        {
          name: "docs",
          kind: "stdio",
          source: "codex",
          sources: ["codex"],
          aliases: [{ provider: "codex", name: "docs" }],
          signedIn: false,
        },
      ],
    },
  });
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Start MCP servers: When needed"]')!
      .click(),
  );
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
    (button) => button.textContent === "With every session",
  )!;
  await act(async () => option.click());
  expect(hubMock.hub.setMode).toHaveBeenCalledWith("always");
  await openDetail("docs");
  await act(async () =>
    sheet()!
      .querySelector<HTMLButtonElement>(
        'button[role="switch"][aria-label="Start docs with every session"]',
      )!
      .click(),
  );
  expect(hubMock.hub.setDirect).toHaveBeenCalledWith("docs", true);
});

it("locks the startup select while the Host policy file is corrupt", async () => {
  hubMock.hub = makeHub({
    loading: {
      policy: { version: 1, mode: "onDemand", direct: [] },
      corrupt: true,
      servers: [],
      inventory: [],
    },
  });
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  expect(container.textContent).toContain("The MCP loading file is unreadable");
  expect(
    container.querySelector<HTMLButtonElement>('[aria-label="Start MCP servers: When needed"]')!
      .disabled,
  ).toBe(true);
});

it("ignores discovery from a previous project after cwd changes", async () => {
  let resolveOld!: (connections: unknown[]) => void;
  invoke.mockImplementation((command: string, args: { cwd: string }) => {
    if (command === "claude_mcp_list") return Promise.resolve("");
    if (args.cwd === "/old")
      return new Promise((resolve) => {
        resolveOld = resolve;
      });
    return Promise.resolve([
      {
        provider: "cursor",
        name: "new-project",
        scope: "project",
        configPath: "/new/.cursor/mcp.json",
        transport: "stdio",
      },
    ]);
  });
  await act(async () => root.render(createElement(McpSettings, { cwd: "/old" })));
  await act(async () => root.render(createElement(McpSettings, { cwd: "/new" })));
  expect(container.textContent).toContain("new-project");
  await act(async () =>
    resolveOld([
      {
        provider: "cursor",
        name: "old-project",
        scope: "project",
        configPath: "/old/.cursor/mcp.json",
        transport: "stdio",
      },
    ]),
  );
  expect(container.textContent).toContain("new-project");
  expect(container.textContent).not.toContain("old-project");
});

it("reuses the loaded list when returning to the page and reloads on Refresh", async () => {
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  expect(invoke).toHaveBeenCalledTimes(2);
  await act(async () => root.render(null));
  await act(() => root.render(createElement(McpSettings, { cwd: "/repo" })));
  expect(container.textContent).toContain("sentry");
  expect(container.textContent).not.toContain("Checking servers…");
  expect(invoke).toHaveBeenCalledTimes(2);

  invoke.mockImplementation(async (command: string) =>
    command === "mcp_discover"
      ? [
          {
            provider: "cursor",
            name: "updated",
            scope: "project",
            configPath: "/repo/.cursor/mcp.json",
            transport: "stdio",
          },
        ]
      : "",
  );
  const refresh = [...container.querySelectorAll("button")].find(
    (button) => button.getAttribute("aria-label") === "Refresh",
  )!;
  await act(async () => refresh.click());
  expect(invoke).toHaveBeenCalledTimes(4);
  expect(hubMock.hub.refresh).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("updated");
  expect(container.textContent).not.toContain("sentry");

  await act(async () => root.render(null));
  await act(() => root.render(createElement(McpSettings, { cwd: "/repo" })));
  expect(container.textContent).toContain("updated");
  expect(container.textContent).not.toContain("Checking servers…");
  expect(invoke).toHaveBeenCalledTimes(4);
});

it("shares the first request across StrictMode and navigation while loading", async () => {
  let resolveDiscovery!: (connections: unknown[]) => void;
  invoke.mockImplementation((command: string) =>
    command === "mcp_discover"
      ? new Promise((resolve) => {
          resolveDiscovery = resolve;
        })
      : Promise.resolve(""),
  );
  const page = () => createElement(StrictMode, null, createElement(McpSettings, { cwd: "/repo" }));
  await act(async () => root.render(page()));
  expect(invoke).toHaveBeenCalledTimes(1);
  await act(async () => root.render(null));
  await act(async () => root.render(page()));
  expect(invoke).toHaveBeenCalledTimes(1);
  await act(async () => resolveDiscovery([]));
  expect(invoke).toHaveBeenCalledTimes(1);
  await act(async () => root.render(null));
  await act(async () => root.render(page()));
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).not.toHaveBeenCalledWith("claude_mcp_list", expect.anything());
  expect(container.textContent).not.toContain("Checking servers…");
});

it("caches an empty list until manually refreshed", async () => {
  invoke.mockImplementation(async (command: string) => (command === "mcp_discover" ? [] : ""));
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  await act(async () => root.render(null));
  await act(() => root.render(createElement(McpSettings, { cwd: "/repo" })));
  expect(container.textContent).toContain("No MCP servers configured");
  expect(container.textContent).not.toContain("Checking servers…");
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("caches discovery failures and lets Refresh retry", async () => {
  invoke.mockRejectedValueOnce(new Error("Discovery failed"));
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  await act(async () => root.render(null));
  await act(() => root.render(createElement(McpSettings, { cwd: "/repo" })));
  expect(container.textContent).toContain("Discovery failed");
  expect(invoke).toHaveBeenCalledTimes(1);
  const refresh = [...container.querySelectorAll("button")].find(
    (button) => button.getAttribute("aria-label") === "Refresh",
  )!;
  await act(async () => refresh.click());
  expect(container.textContent).toContain("sentry");
  expect(container.textContent).not.toContain("Discovery failed");
  expect(invoke).toHaveBeenCalledTimes(4);
});

it("uses the shared project picker and caches each project's list", async () => {
  invoke.mockImplementation(async (command: string, args: { cwd: string }) =>
    command === "mcp_discover"
      ? [
          {
            provider: "cursor",
            name: `${args.cwd.slice(1)}-server`,
            scope: "project",
            configPath: `${args.cwd}/.cursor/mcp.json`,
            transport: "stdio",
          },
        ]
      : "",
  );
  await act(async () =>
    root.render(
      createElement(McpSettings, {
        cwd: "/repo",
        recents: [{ path: "/other", openedAt: 1 }],
      }),
    ),
  );
  expect(container.textContent).toContain("repo-server");
  await selectProject("/other");
  expect(container.textContent).toContain("other-server");
  expect(container.textContent).not.toContain("repo-server");
  expect(invoke).toHaveBeenCalledWith("mcp_discover", { cwd: "/other" });
  expect(invoke).not.toHaveBeenCalledWith("claude_mcp_list", { cwd: "/other" });
  expect(invoke).toHaveBeenCalledTimes(2);
  await selectProject("/repo");
  expect(container.textContent).toContain("repo-server");
  expect(container.textContent).not.toContain("Checking servers…");
  expect(invoke).toHaveBeenCalledTimes(2);
  await selectProject("/other");
  const refresh = [...container.querySelectorAll("button")].find(
    (button) => button.getAttribute("aria-label") === "Refresh",
  )!;
  await act(async () => refresh.click());
  expect(invoke).toHaveBeenCalledTimes(4);
  expect(invoke).toHaveBeenLastCalledWith("claude_mcp_list", { cwd: "/other" });
});

it("opens without starting Claude's health helper but reads Codex sign-in state", async () => {
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  expect(invoke.mock.calls.map(([command]) => command)).toEqual(["mcp_discover", "codex_mcp_list"]);
  expect(container.textContent).not.toContain("Ready");
});

it("dismisses the displayed login error without retrying or hiding a later failure", async () => {
  let attempt = 0;
  invoke.mockImplementation(async (command: string) => {
    if (command === "mcp_discover")
      return [
        {
          provider: "codex",
          name: "docs",
          scope: "user",
          configPath: "/config/codex",
          transport: "http",
        },
      ];
    if (command === "mcp_provider_login")
      throw new Error(`failure ${++attempt}: ${"long-server-name-".repeat(20)}`);
    return "";
  });
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  await act(async () => quickSignIn("docs")!.click());
  const alert = container.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("failure 1:");
  const dismiss = [...alert.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Dismiss",
  )!;
  expect(dismiss).toBeTruthy();
  await act(async () => dismiss.click());
  expect(invoke.mock.calls.filter(([command]) => command === "mcp_provider_login")).toHaveLength(1);
  await act(async () => quickSignIn("docs")!.click());
  expect(container.textContent).toContain("failure 2:");
  expect(invoke.mock.calls.filter(([command]) => command === "mcp_provider_login")).toHaveLength(2);
});

it("opens Global independently of ambiguous project settings", async () => {
  resetRetainedState();
  invoke.mockImplementation(async (command: string, args: { globalOnly?: boolean }) => {
    if (command === "mcp_discover") {
      if (!args.globalOnly)
        throw new Error(
          "Claude has ambiguous project settings; resolve duplicate project paths first",
        );
      return [
        {
          provider: "codex",
          name: "global-docs",
          scope: "user",
          configPath: "/config",
          transport: "stdio",
        },
      ];
    }
    return "";
  });
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  expect(invoke).toHaveBeenCalledWith("mcp_discover", { cwd: "~", globalOnly: true });
  expect(container.textContent).toContain("global-docs");
  expect(container.textContent).not.toContain("ambiguous project settings");
  const project = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (button) => button.textContent === "Project",
  )!;
  await act(async () => project.click());
  expect(container.textContent).toContain("ambiguous project settings");
  expect(container.textContent).not.toContain("No records");
  const global = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (button) => button.textContent === "Global",
  )!;
  await act(async () => global.click());
  expect(container.textContent).toContain("global-docs");
  expect(container.textContent).not.toContain("ambiguous project settings");
});

const configArea = () =>
  sheet()!.querySelector<HTMLTextAreaElement>('textarea[aria-label="Configuration for sentry"]')!;
async function type(area: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("reads the entry when JSON opens and saves with the loaded revision", async () => {
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  await openDetail("sentry");
  expect(invoke.mock.calls.some(([command]) => command === "mcp_server_config_read")).toBe(false);
  await openProviderJson();
  expect(invoke).toHaveBeenCalledWith("mcp_server_config_read", {
    cwd: "/repo",
    provider: "claude",
    scope: "user",
    configPath: "/home/.claude.json",
    name: "sentry",
  });
  expect(configArea().value).toBe("{}");
  const save = () => sheetButtons("Save")[0];
  expect(save().disabled).toBe(true);
  await type(configArea(), '{"url":"https://new.example"}');
  expect(save().disabled).toBe(false);
  const discovery = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command: string, args: unknown) =>
    command === "mcp_server_config_write"
      ? { config: '{\n  "url": "https://new.example"\n}', revision: "r2" }
      : discovery(command, args),
  );
  await act(async () => save().click());
  expect(invoke).toHaveBeenCalledWith("mcp_server_config_write", {
    cwd: "/repo",
    provider: "claude",
    scope: "user",
    configPath: "/home/.claude.json",
    name: "sentry",
    config: '{"url":"https://new.example"}',
    expectedRevision: "r1",
  });
  // The saved text replaces the draft and discovery is reread.
  expect(configArea().value).toBe('{\n  "url": "https://new.example"\n}');
  expect(invoke.mock.calls.filter(([command]) => command === "mcp_discover")).toHaveLength(2);
});

it("keeps the draft and shows the error when the file changed since it was read", async () => {
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  await openDetail("sentry");
  await openProviderJson();
  const draft = '{"url":"https://mine.example"}';
  await type(configArea(), draft);
  const discovers = invoke.mock.calls.filter(([command]) => command === "mcp_discover").length;
  invoke.mockImplementation(async (command: string) => {
    if (command === "mcp_server_config_write")
      throw new Error("The configuration changed on disk. Reload it before saving.");
    return "";
  });
  await act(async () => sheetButtons("Save")[0].click());
  expect(sheet()!.textContent).toContain("The configuration changed on disk");
  expect(configArea().value).toBe(draft);
  expect(sheetButtons("Save")[0].disabled).toBe(false);
  expect(invoke.mock.calls.filter(([command]) => command === "mcp_discover")).toHaveLength(
    discovers,
  );
});

it("rejects an invalid draft locally without writing", async () => {
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  await openDetail("sentry");
  await openProviderJson();
  await type(configArea(), "{ nope");
  await act(async () => sheetButtons("Save")[0].click());
  expect(invoke.mock.calls.some(([command]) => command === "mcp_server_config_write")).toBe(false);
  expect(sheet()!.querySelector('[role="alert"]')).not.toBeNull();
  // Revert is an icon-only button named by its accessible label.
  await act(async () =>
    sheet()!.querySelector<HTMLButtonElement>('button[aria-label="Revert"]')!.click(),
  );
  expect(configArea().value).toBe("{}");
});
