import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { McpSettings } from "../../../src/features/settings/ui/McpSettings";
import { setLanguagePreference } from "../../../src/shared/i18n";
import {
  applyThemePreference,
  saveThemePreference,
} from "../../../src/features/settings/model/appearance";
import "../../../src/styles/index.css";

// Synthetic MCP inventory: provider config rows, Host hub inventory and Host-held sign-ins.
const row = (provider: string, name: string, transport: string, enabled = true) => ({
  provider,
  name,
  scope: "user",
  configPath:
    provider === "codex" ? "C:/Users/fixture/.codex/config.toml" : "C:/Users/fixture/.claude.json",
  transport,
  enabled,
});
const discovered = [
  row("claude", "blender", "stdio", false),
  row("claude", "firebase", "stdio"),
  row("claude", "mem0-local", "http"),
  row("codex", "blender", "stdio"),
  row("codex", "dokploy", "stdio"),
  row("codex", "firebase", "stdio"),
  row("codex", "linear", "http"),
];
const hubServer = (
  name: string,
  kind: "stdio" | "http",
  sources: string[],
  aliases: [string, string][],
  signedIn = false,
) => ({
  name,
  kind,
  source: sources[0],
  sources,
  aliases: aliases.map(([provider, alias]) => ({ provider, name: alias })),
  signedIn,
});
const inventory = [
  hubServer(
    "blender",
    "stdio",
    ["claude", "codex"],
    [
      ["claude", "blender"],
      ["codex", "blender"],
    ],
  ),
  hubServer("dokploy", "stdio", ["codex"], [["codex", "dokploy"]]),
  hubServer(
    "firebase",
    "stdio",
    ["claude", "codex"],
    [
      ["claude", "firebase"],
      ["codex", "firebase"],
    ],
  ),
  hubServer("linear", "http", ["codex"], [["codex", "linear"]], true),
  hubServer("mem0-local", "http", ["claude"], [["claude", "mem0-local"]]),
  hubServer("stripe", "http", ["claude-plugin"], [["claude", "stripe"]]),
  hubServer("notion", "http", ["claude-plugin"], [["claude", "notion"]]),
];
let policy = { version: 1, mode: "onDemand", direct: ["firebase"] };
const oauth = [
  { name: "linear", state: "signed-in" },
  { name: "mem0-local", state: "none" },
  { name: "stripe", state: "expired" },
  { name: "notion", state: "none" },
];
const configs = new Map<string, string>();
const configKey = (args: Record<string, unknown>) =>
  `${args.provider}:${args.scope}:${args.configPath}:${args.name}`;

mockWindows("main");
mockIPC(
  async (command, args) => {
    const params = (args ?? {}) as Record<string, unknown>;
    if (command.startsWith("plugin:event|")) return;
    if (command === "plugin:opener|open_url") return;
    if (command === "mcp_discover") return discovered;
    if (command === "claude_mcp_list")
      return {
        output:
          "firebase: npx firebase - ✓ Connected\nmem0-local: http://localhost - ! Needs authentication",
        timedOut: false,
      };
    if (command === "codex_mcp_list") return [{ name: "linear", authStatus: "o_auth" }];
    if (command === "mcp_server_config_read" || command === "mcp_server_config_write") {
      const key = configKey(params);
      if (command === "mcp_server_config_write") configs.set(key, String(params.config));
      const config =
        configs.get(key) ??
        JSON.stringify({ command: "npx", args: ["-y", `${params.name}-mcp`] }, null, 2);
      return { config, revision: String(config.length) };
    }
    if (command === "remote_machines")
      return [
        {
          id: "local",
          name: "Local",
          localHost: true,
          endpoint: "http://127.0.0.1:47321",
          environmentId: "local",
        },
      ];
    if (command !== "remote_request") throw new Error(`Unsupported fixture command: ${command}`);
    const method = params.method;
    const body = (params.params ?? {}) as Record<string, unknown>;
    if (method === "mcp.hub.loading.get")
      return {
        policy,
        corrupt: false,
        servers: ["blender", "dokploy", "firebase", "linear"],
        inventory,
      };
    if (method === "mcp.hub.loading.set") {
      policy = { version: 1, mode: String(body.mode), direct: body.direct as string[] };
      return { policy, corrupt: false };
    }
    if (method === "mcp.oauth.status") return { servers: oauth };
    if (method === "mcp.oauth.start")
      return { authorizationUrl: "https://auth.example/authorize?state=fixture-state-123456" };
    if (method === "mcp.oauth.cancel") return { cancelled: true };
    if (method === "mcp.oauth.signOut") {
      const entry = oauth.find((item) => item.name === body.name);
      if (entry) entry.state = "none";
      return { signedOut: true };
    }
    if (method === "mcp.tokens.list") return { tokens: [] };
    if (method === "projects.list") return [{ id: "project", name: "fixture", cwd: "C:/fixture" }];
    throw new Error(`Unsupported fixture method: ${String(method)}`);
  },
  { shouldMockEvents: true },
);
const search = new URLSearchParams(location.search);
const theme = search.get("theme") === "light" ? "light" : "dark";
saveThemePreference(theme);
applyThemePreference(theme);
await setLanguagePreference(search.get("lang") === "tr" ? "tr" : "en");
createRoot(document.getElementById("root")!).render(
  <main style={{ padding: 16, maxWidth: 1080, marginInline: "auto" }}>
    <McpSettings cwd="C:/fixture" />
  </main>,
);
