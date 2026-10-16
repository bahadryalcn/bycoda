import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { ExternalMcpAccess } from "../../src/features/settings/ui/ExternalMcpAccess";
import { setLanguagePreference } from "../../src/shared/i18n";
import {
  applyThemePreference,
  saveThemePreference,
} from "../../src/features/settings/model/appearance";
import "../../src/styles/index.css";

// Isolated owner transport. These grants and secrets are synthetic fixture data.
const tokens = [
  {
    id: "old",
    name: "Previously revoked",
    projectId: "project",
    scopes: { conversation: ["read"] },
    createdAt: 1,
    expiresAt: 1,
    revokedAt: 1,
  },
];
let creates = 0;
let revokes = 0;
mockWindows("main");
mockIPC(
  async (command, args) => {
    if (command.startsWith("plugin:event|")) return;
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
    if (command === "plugin:dialog|message") {
      document.body.dataset.confirmations = String(
        Number(document.body.dataset.confirmations ?? 0) + 1,
      );
      return document.body.dataset.confirm === "yes" ? "Yes" : "No";
    }
    if (command !== "remote_request") throw new Error(`Unsupported fixture command: ${command}`);
    if (args.method === "projects.list")
      return [{ id: "project", name: "Local project", cwd: "/fixture" }];
    if (args.method === "mcp.tokens.list") return { tokens };
    const params = args.params as Record<string, unknown>;
    if (args.method === "mcp.tokens.create") {
      creates++;
      document.body.dataset.creates = String(creates);
      document.body.dataset.grant = JSON.stringify(params);
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (document.body.dataset.fail === "create")
        throw new Error("synthetic-secret-do-not-render");
      const grant = { ...params, id: `token-${creates}`, createdAt: Date.now() };
      tokens.unshift(grant as (typeof tokens)[number]);
      return { ...grant, token: "synthetic-secret-do-not-render" };
    }
    if (args.method === "mcp.tokens.revoke") {
      revokes++;
      document.body.dataset.revokes = String(revokes);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const grant = tokens.find((token) => token.id === params.id);
      if (grant) grant.revokedAt = Date.now();
      return { revoked: !!grant };
    }
    throw new Error("Unsupported fixture method");
  },
  { shouldMockEvents: true },
);
const theme = new URLSearchParams(location.search).get("theme") === "light" ? "light" : "dark";
saveThemePreference(theme);
applyThemePreference(theme);
await setLanguagePreference(
  new URLSearchParams(location.search).get("lang") === "tr" ? "tr" : "en",
);
createRoot(document.getElementById("root")!).render(
  <main style={{ padding: 16, maxWidth: 720, marginInline: "auto" }}>
    <ExternalMcpAccess cwd="/fixture" />
  </main>,
);
