import { useState } from "react";
import { UsageOverview } from "../../src/features/usage/ui/UsageOverview";
import { saveDecorativeMotionEnabled } from "../../src/features/settings/model/decorativeMotion";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { UsageBudgets } from "../../src/features/usage/ui/UsageBudgets";
import { UsagePage } from "../../src/features/usage/ui/UsagePage";
import { UsageFooter } from "../../src/app/shell/UsageFooter";
import { resetSessionsStore } from "../../src/features/sessions/model/sessionsStore";
import { newSession } from "../../src/features/sessions/model/session";
import { idleRateLimits } from "../../src/features/providers/model/rateLimits";
import { setCachedRateLimits } from "../../src/features/providers/model/rateLimitsCache";
import { setProviderAccountColor } from "../../src/features/providers/model/providerAccounts";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import { setLanguagePreference } from "../../src/shared/i18n";
import "../../src/styles/index.css";
import "../../src/features/settings/ui/BycodaSettings.css";

// Isolated browser storage and synthetic IPC. This fixture cannot reach the owner host.
const cwd = "C:/fixture/app";
const params = new URLSearchParams(location.search);
const stress = params.get("stress") === "1";
const quotaFetches: string[] = [];
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const grokLimits = {
  ...idleRateLimits("grok"),
  weekly: { usedPercent: 19, windowMinutes: 10_080, resetsAt: Date.now() + 86_400_000 },
  updatedAt: Date.now(),
  status: "ok" as const,
};
setCachedRateLimits("grok", "default", grokLimits);
queryClient.setQueryData(["rate-limits", "grok", "default"], grokLimits);
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
  JSON.stringify({
    codex: [{ id: "default", label: "Fixture account", color: "blue" }],
    claude:
      params.get("page") === "1"
        ? [
            { id: "default", label: "Personal", color: "orange" },
            { id: "work", label: "Work", color: "pink" },
            ...(stress
              ? [{ id: "shared", label: "Shared engineering account", color: "teal" }]
              : []),
          ]
        : [],
  }),
);
if (stress) {
  localStorage.setItem(
    "bycoda.quotaHistory.v1",
    JSON.stringify(
      ["codex:default", "claude:default", "claude:work", "claude:shared"].flatMap(
        (account, accountIndex) =>
          Array.from({ length: 21 }, (_, index) => ({
            account,
            at: Date.now() - (21 - index) * 8 * 3_600_000,
            kind: "session",
            used: (index * 7 + accountIndex * 19) % 100,
            minutes: 300,
            resetsAt: null,
          })),
      ),
    ),
  );
}
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
let usageMultiplier = 1;
if (params.get("page") === "1") {
  setCachedRateLimits("claude", "default", {
    ...idleRateLimits("claude"),
    status: "ok",
    updatedAt: Date.now(),
    session: { usedPercent: 9, windowMinutes: 300, resetsAt: Date.now() + 3_000_000 },
    weekly: { usedPercent: 82, windowMinutes: 10_080, resetsAt: Date.now() + 260_000_000 },
  });
  setCachedRateLimits("claude", "work", {
    ...idleRateLimits("claude"),
    status: "error",
    error: stress
      ? "Claude usage will update when this account is used again. Previous limits remain visible."
      : "Work: Claude sign-in expired",
    ...(stress
      ? {
          updatedAt: Date.now() - 54 * 60_000,
          session: { usedPercent: 61, windowMinutes: 300, resetsAt: Date.now() },
          weekly: { usedPercent: 15, windowMinutes: 10_080, resetsAt: Date.now() + 86_400_000 },
        }
      : {}),
  });
  if (stress)
    setCachedRateLimits("claude", "shared", {
      ...idleRateLimits("claude"),
      status: "ok",
      updatedAt: Date.now() - 27 * 60_000,
      weekly: { usedPercent: 100, windowMinutes: 10_080, resetsAt: Date.now() + 260_000_000 },
    });
}
mockIPC((command, args) => {
  if (command === "fetch_claude_usage") {
    quotaFetches.push((args as { accountId: string }).accountId);
    return {
      status: "unavailable",
      error: "Claude usage will update when this account is used again.",
    };
  }
  if (command === "session_usage_report") {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    date.setHours(14, 0, 0, 0);
    return {
      truncated: false,
      turns: [
        {
          sessionId: "fixture-session",
          title: "Fixture session",
          project: cwd,
          provider: "codex",
          accountId: "default",
          model: "gpt-5.5",
          startedAt: date.getTime(),
          durationMs: 3_600_000,
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 100,
          cacheWriteTokens: 0,
        },
      ],
    };
  }
  if (command === "provider_account_identity")
    return {
      email: stress
        ? "engineering.platform.with.a.long.account.name@example.com"
        : "fixture@example.com",
      plan: "Pro",
    };
  if (command === "provider_model_prices")
    return {
      models: [{ id: "fixture", input: 0.000001, output: 0.000002, cacheRead: 0.0000001 }],
      fetchedAt: Date.now() / 1000,
    };
  if (command === "provider_usage_report" && params.get("analytics") === "1") {
    const { provider, accountId } = args as { provider: string; accountId: string };
    return {
      found: true,
      filesScanned: 10,
      rows:
        accountId === "work"
          ? []
          : Array.from({ length: 21 }, (_, index) => {
              const date = new Date();
              date.setDate(date.getDate() - (Math.floor(index / 3) + 1));
              date.setHours([8, 14, 18][index % 3], 0, 0, 0);
              return {
                slot: date.getTime() / 1000,
                model: provider === "codex" ? "gpt-5.5" : "claude-sonnet-4-6",
                project: index % 3 === 0 ? "C:/fixture/portal" : cwd,
                input: 100000 + index * 3000,
                output: 20000 + index * 1000,
                cacheRead: 10000,
                cacheWrite5m: provider === "claude" ? 1000 : 0,
                cacheWrite1h: 0,
              };
            }),
    };
  }
  if (command === "provider_usage_report")
    return {
      rows: [
        {
          slot: Math.floor(Date.now() / 1000) - 60,
          model: "fixture",
          project: cwd,
          input: 1000 * usageMultiplier,
          output: 200 * usageMultiplier,
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
Object.assign(window, {
  usageQuotaFetches: quotaFetches,
  recolorUsageFixture: (color: "blue" | "pink") =>
    setProviderAccountColor("codex", "default", color),
});
applyThemePreference(params.get("theme") === "light" ? "light" : "dark");
await setLanguagePreference(params.get("lang") === "tr" ? "tr" : "en");
if (params.get("motion") === "off") saveDecorativeMotionEnabled(false);
function OverviewFixture() {
  const [refresh, setRefresh] = useState(0);
  Object.assign(window, {
    refreshUsageFixture: () => {
      usageMultiplier++;
      setRefresh((value) => value + 1);
    },
  });
  return <UsageOverview refresh={refresh} />;
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <main
      className={
        params.get("page") === "1" ? "bycoda-settings-workbench w-full" : "mx-auto max-w-4xl p-4"
      }
    >
      <div
        data-settings-scroller={params.get("page") === "1" ? "" : undefined}
        data-settings-width={params.get("page") === "1" ? "wide" : undefined}
      >
        <div
          data-settings-section={params.get("page") === "1" ? "usage" : undefined}
          className={
            params.get("page") === "1" ? "bycoda-settings-form @container/settings" : undefined
          }
        >
          {params.get("footer") === "1" ? (
            <UsageFooter providers={["grok"]} />
          ) : params.get("page") === "1" ? (
            <UsagePage limitsOnly={params.get("limits") === "1"} />
          ) : params.get("overview") === "1" ? (
            <OverviewFixture />
          ) : (
            <UsageBudgets />
          )}
        </div>
      </div>
    </main>
  </QueryClientProvider>,
);
