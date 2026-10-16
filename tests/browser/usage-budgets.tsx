import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { UsageBudgets } from "../../src/features/usage/ui/UsageBudgets";
import { resetSessionsStore } from "../../src/features/sessions/model/sessionsStore";
import { newSession } from "../../src/features/sessions/model/session";
import { idleRateLimits } from "../../src/features/providers/model/rateLimits";
import { setCachedRateLimits } from "../../src/features/providers/model/rateLimitsCache";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import { setLanguagePreference } from "../../src/shared/i18n";
import "../../src/styles/index.css";

// Isolated browser storage and synthetic IPC. This fixture cannot reach the owner host.
const cwd = "C:/fixture/app";
localStorage.setItem("bycoda.recentProjects", JSON.stringify([{ path: cwd, openedAt: 1 }]));
localStorage.setItem(
  "bycoda.projectGroups",
  JSON.stringify([{ id: "workspace", name: "Fixture workspace", collapsed: false }]),
);
localStorage.setItem(
  "bycoda.projectGroupAssignments",
  JSON.stringify({ "c:/fixture/app": "workspace" }),
);
localStorage.setItem(
  "bycoda.providerAccounts.v2",
  JSON.stringify({ codex: [{ id: "default", label: "Fixture account" }], claude: [] }),
);
const session = {
  ...newSession("codex"),
  id: "fixture-session",
  cwd,
  title: "Fixture session",
  blocks: [
    {
      id: "u",
      role: "user" as const,
      text: "Synthetic turn",
      startedAt: Date.now() - 60_000,
      turnMetrics: { inputTokens: 1000, outputTokens: 200 },
    },
  ],
};
resetSessionsStore([session]);
setCachedRateLimits("codex", "default", {
  ...idleRateLimits("codex"),
  status: "ok",
  updatedAt: Date.now(),
  session: { usedPercent: 32, windowMinutes: 300, resetsAt: Date.now() + 3_600_000 },
  weekly: { usedPercent: 60, windowMinutes: 10_080, resetsAt: Date.now() + 86_400_000 },
});
mockIPC((command) => {
  if (command === "provider_usage_report")
    return {
      rows: [
        {
          slot: Math.floor(Date.now() / 1000) - 60,
          model: "fixture",
          project: cwd,
          input: 1000,
          output: 200,
          cacheRead: 50,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
        },
      ],
      found: true,
      filesScanned: 1,
    };
  if (command === "session_get") throw new Error("Fixture session is already loaded");
  throw new Error(`Unsupported fixture command: ${command}`);
});
const params = new URLSearchParams(location.search);
applyThemePreference(params.get("theme") === "light" ? "light" : "dark");
await setLanguagePreference(params.get("lang") === "tr" ? "tr" : "en");
createRoot(document.getElementById("root")!).render(
  <main className="mx-auto max-w-4xl p-4">
    <UsageBudgets />
  </main>,
);
