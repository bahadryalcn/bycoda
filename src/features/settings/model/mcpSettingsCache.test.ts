import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { McpConnection } from "./mcp";
import {
  clearMcpSettingsCache,
  getCachedMcpSettings,
  invalidateMcpSettings,
  loadMcpSettings,
  MCP_LOCAL_ONLY_ERROR,
  subscribeMcpSettings,
} from "./mcpSettingsCache";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const configured: McpConnection[] = [
  {
    provider: "claude",
    name: "docs",
    scope: "project",
    configPath: "/repo/.mcp.json",
    transport: "stdio",
  },
];

beforeEach(() => {
  clearMcpSettingsCache();
  invoke.mockReset();
});
afterEach(clearMcpSettingsCache);

it("isolates global discovery from ambiguous project settings and project subscribers", async () => {
  const global = { ...configured[0], scope: "user" as const, configPath: "/home/.claude.json" };
  invoke.mockImplementation(async (command: string, args: { globalOnly?: boolean }) => {
    if (command === "mcp_discover" && args.globalOnly) return [global, ...configured];
    throw new Error("Claude has ambiguous project settings; resolve duplicate project paths first");
  });
  const projectChanged = vi.fn();
  const globalChanged = vi.fn();
  const stopProject = subscribeMcpSettings("/repo", projectChanged);
  const stopGlobal = subscribeMcpSettings("/repo", globalChanged, true);
  try {
    const project = await loadMcpSettings("/repo", false, { claudeHealth: false });
    const snapshot = await loadMcpSettings("/repo", false, { globalOnly: true });
    expect(project.error).toContain("ambiguous project settings");
    expect(snapshot).toEqual({
      servers: [{ ...global, status: "Configured" }],
      error: "",
      claudeError: "",
    });
    expect(getCachedMcpSettings("/repo")).toBe(project);
    expect(getCachedMcpSettings("/repo", true)).toBe(snapshot);
    expect(projectChanged).toHaveBeenCalledTimes(1);
    expect(globalChanged).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("mcp_discover", { cwd: "/repo", globalOnly: true });
    expect(invoke).not.toHaveBeenCalledWith("claude_mcp_list", expect.anything());
    await loadMcpSettings("/repo", false, { globalOnly: true });
    expect(invoke).toHaveBeenCalledTimes(2);
  } finally {
    stopProject();
    stopGlobal();
  }
});

it("never starts desktop discovery for a remote global view", async () => {
  const snapshot = await loadMcpSettings("remote://host/repo", true, { globalOnly: true });
  expect(snapshot.error).toBe(MCP_LOCAL_ONLY_ERROR);
  expect(invoke).not.toHaveBeenCalled();
});

it("publishes Codex authentication to its exact global or project snapshot", async () => {
  const auth: ((value: { name: string; authStatus: string }[]) => void)[] = [];
  invoke.mockImplementation((command: string, args: { globalOnly?: boolean }) => {
    if (command === "mcp_discover")
      return Promise.resolve([
        {
          ...configured[0],
          provider: "codex",
          scope: args.globalOnly ? "user" : "project",
        },
      ]);
    return new Promise((resolve) => auth.push(resolve));
  });
  await loadMcpSettings("/repo", false, { claudeHealth: false });
  await loadMcpSettings("/repo", false, { globalOnly: true });
  auth[1]([{ name: "docs", authStatus: "o_auth" }]);
  await vi.waitFor(() =>
    expect(getCachedMcpSettings("/repo", true)?.servers[0].auth).toBe("signed_in"),
  );
  expect(getCachedMcpSettings("/repo")?.servers[0].auth).toBeUndefined();
  auth[0]([{ name: "docs", authStatus: "not_logged_in" }]);
  await vi.waitFor(() => expect(getCachedMcpSettings("/repo")?.servers[0].auth).toBe("signed_out"));
  expect(getCachedMcpSettings("/repo", true)?.servers[0].auth).toBe("signed_in");
});

it("clears verified connection and sign-in after failed discovery without losing configuration", async () => {
  invoke.mockImplementation(async (command: string) =>
    command === "mcp_discover" ? configured : "docs: local - Connected",
  );
  await loadMcpSettings("/repo");
  await vi.waitFor(() =>
    expect(getCachedMcpSettings("/repo")?.servers[0].status).toBe("Connected"),
  );
  invoke.mockRejectedValue(new Error("Discovery unavailable"));
  const snapshot = await loadMcpSettings("/repo", true);
  expect(snapshot.servers).toEqual([{ ...configured[0], status: "Configured" }]);
  expect(snapshot.error).toContain("Discovery unavailable");
  expect(snapshot.claudeChecking).toBeUndefined();
});

it("never sends remote project paths to desktop discovery or health commands", async () => {
  const snapshot = await loadMcpSettings("remote://fixture-host/work/project", true);
  expect(snapshot).toEqual({ servers: [], error: MCP_LOCAL_ONLY_ERROR, claudeError: "" });
  expect(invoke).not.toHaveBeenCalled();
});

it("publishes discovery before slow health and shares both requests across consumers", async () => {
  let resolveHealth!: (output: string) => void;
  invoke.mockImplementation((command: string) =>
    command === "mcp_discover"
      ? Promise.resolve(configured)
      : new Promise((resolve) => {
          resolveHealth = resolve;
        }),
  );
  const onChange = vi.fn();
  const stop = subscribeMcpSettings("/repo", onChange);
  try {
    const [picker, settings] = await Promise.all([
      loadMcpSettings("/repo", false, { claudeHealth: false }),
      loadMcpSettings("/repo"),
    ]);
    expect(picker.servers[0].status).toBe("Configured");
    expect(settings.servers[0].name).toBe("docs");
    expect(invoke).toHaveBeenCalledTimes(2);
    await loadMcpSettings("/repo");
    expect(invoke).toHaveBeenCalledTimes(2);
    resolveHealth("docs: local - Connected\nremote: https://example.com - Needs authentication");
    await vi.waitFor(() => expect(getCachedMcpSettings("/repo")?.servers).toHaveLength(2));
    expect(onChange.mock.calls.at(-1)?.[0].servers[0].status).toBe("Connected");
  } finally {
    stop();
  }
});

it("loads non-Claude pickers without running Claude and lets a later Claude consumer request health", async () => {
  invoke.mockImplementation(async (command: string) =>
    command === "mcp_discover" ? configured : "docs: local - Connected",
  );
  await loadMcpSettings("/repo", false, { claudeHealth: false });
  await loadMcpSettings("/repo", false, { claudeHealth: false });
  expect(invoke).toHaveBeenCalledTimes(1);
  await loadMcpSettings("/repo");
  await vi.waitFor(() =>
    expect(getCachedMcpSettings("/repo")?.servers[0].status).toBe("Connected"),
  );
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("ignores health from a request superseded by refresh", async () => {
  const health: ((output: string) => void)[] = [];
  invoke.mockImplementation((command: string) =>
    command === "mcp_discover"
      ? Promise.resolve(configured)
      : new Promise((resolve) => {
          health.push(resolve);
        }),
  );
  await loadMcpSettings("/repo");
  await loadMcpSettings("/repo", true);
  health[1]("docs: local - Connected");
  await vi.waitFor(() =>
    expect(getCachedMcpSettings("/repo")?.servers[0].status).toBe("Connected"),
  );
  health[0]("docs: local - Failed\nstale: local - Connected");
  await Promise.resolve();
  expect(getCachedMcpSettings("/repo")?.servers.map((server) => server.name)).toEqual(["docs"]);
  expect(getCachedMcpSettings("/repo")?.servers[0].status).toBe("Connected");
});

it("keeps configured rows when health fails and preserves disabled status", async () => {
  invoke.mockImplementation((command: string) =>
    command === "mcp_discover"
      ? Promise.resolve([{ ...configured[0], enabled: false }])
      : Promise.reject(new Error("Health unavailable")),
  );
  await loadMcpSettings("/repo");
  await vi.waitFor(() =>
    expect(getCachedMcpSettings("/repo")?.claudeError).toContain("Health unavailable"),
  );
  expect(getCachedMcpSettings("/repo")?.servers[0].status).toBe("Disabled");
  expect(getCachedMcpSettings("/repo")?.error).toBe("");
});

it("reads Codex sign-in state when the list opens without Claude health", async () => {
  const codex: McpConnection[] = ["cloudflare", "mem0"].map((name) => ({
    provider: "codex",
    name,
    scope: "user",
    configPath: "",
    transport: "http",
  }));
  invoke.mockImplementation(async (command: string) => {
    if (command === "mcp_discover") return codex;
    if (command === "codex_mcp_list")
      return [
        { name: "cloudflare", authStatus: "o_auth" },
        { name: "mem0", authStatus: "unsupported" },
      ];
    throw new Error(`unexpected ${command}`);
  });
  await loadMcpSettings("/repo", false, { claudeHealth: false });
  await vi.waitFor(() =>
    expect(getCachedMcpSettings("/repo")?.servers.map((server) => server.auth)).toEqual([
      "signed_in",
      "none",
    ]),
  );
  expect(invoke).not.toHaveBeenCalledWith("claude_mcp_list", expect.anything());
});

it("rereads both views after mutation while retaining last-good rows", async () => {
  invoke.mockResolvedValue(configured);
  await loadMcpSettings("/repo", false, { claudeHealth: false });
  await loadMcpSettings("/repo", false, { globalOnly: true });
  invalidateMcpSettings("/repo");
  expect(getCachedMcpSettings("/repo")?.servers[0].name).toBe("docs");
  await loadMcpSettings("/repo", false, { claudeHealth: false });
  await loadMcpSettings("/repo", false, { globalOnly: true });
  expect(invoke.mock.calls.filter(([command]) => command === "mcp_discover")).toHaveLength(4);
});
