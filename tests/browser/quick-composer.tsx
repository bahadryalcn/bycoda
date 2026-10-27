import { emit, listen } from "@tauri-apps/api/event";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { QuickComposer } from "../../src/features/quick-composer/ui/QuickComposer";
import { setHarnessModels, saveLastModelChoice } from "../../src/features/sessions/model/models";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import { languageReady } from "../../src/shared/i18n";
import "./w7-shell.css";
// Synthetic storage, catalogs and native IPC only; no owner host/session/provider is contacted.
localStorage.setItem("bycoda.language", "en");
localStorage.setItem(
  "bycoda.recentProjects",
  JSON.stringify([
    { path: "C:/fixture/alpha", openedAt: 2 },
    { path: "C:/fixture/beta", openedAt: 1 },
  ]),
);
setHarnessModels(
  "codex",
  Array.from({ length: 48 }, (_, i) => ({
    id: `fixture-${i}`,
    nativeId: `fixture-${i}`,
    name: `Fixture model ${i}`,
    harness: "codex" as const,
    settings: [
      {
        id: "effort",
        label: "Effort",
        kind: "select" as const,
        value: "low",
        options: [
          { label: "Low", value: "low" },
          { label: "High", value: "high" },
        ],
      },
    ],
  })),
);
saveLastModelChoice("codex", "fixture-0");
mockWindows("quick-fixture");
Object.assign((window as any).__TAURI_INTERNALS__.metadata, {
  currentWebview: { label: "quick-fixture" },
});
const calls: Array<{ command: string; args: unknown }> = [];
const params = new URLSearchParams(location.search);
const machine = {
  id: "quick-fixture-host",
  environmentId: "quick-fixture-env",
  localHost: true,
  name: "Fixture",
  endpoint: "http://127.0.0.1:1",
};
const controls = {
  hold: false,
  fail: false,
  finish: () => {},
  pickWorkspace: async (mode: "current" | "worktree") => {
    const call = calls.filter((entry) => entry.command === "quick_git_open").at(-1);
    const request = (call?.args as { request: { id: string; choice: { cwd: string } } }).request;
    await emit("quick_git_result", {
      id: request.id,
      choice: { cwd: request.choice.cwd, mode },
      restoreFocus: true,
    });
  },
};
Object.assign(window, { quickFixtureCalls: calls, quickFixture: controls });
mockIPC(
  async (command, args) => {
    calls.push({ command, args });
    if (command === "plugin:event|listen") return 1;
    if (command === "local_host_connect") return machine;
    if (command === "remote_machines") return [machine];
    if (command === "git_branches")
      return {
        current: "main",
        detached: false,
        branches: [{ name: "main", current: true, remote: null }],
      };
    if (command === "git_worktrees")
      return {
        defaultRoot: "C:/fixture/worktrees",
        worktrees: [
          { path: "C:/fixture/alpha", branch: "main", head: "a1b2c3d4e5f", isMain: true },
        ],
      };
    if (command === "git_diff_index")
      return { branch: "main", head: "a1b2c3d4e5f", files: [], conflicts: [], repository: true };
    if (command === "remote_request") {
      if (args.method === "environment.describe")
        return {
          capabilities: params.has("worktree-policy")
            ? [
                "workspaces.policy.v1",
                "workspaces.managed.v1",
                "sessions.native-process-recovery.v1",
              ]
            : [],
        };
      if (args.method === "projects.list")
        return [
          { id: "quick-alpha", cwd: "C:/fixture/alpha" },
          { id: "quick-beta", cwd: "C:/fixture/beta" },
        ];
      if (args.method === "projects.workspacePolicy.get")
        return {
          revision: 1,
          resolved: {
            policy: { defaultMode: "worktree", integrationBranchRef: "refs/heads/main" },
            appliedScopes: ["project"],
          },
        };
    }
    if (command === "quick_composer_submit") {
      if (controls.hold)
        await new Promise<void>((resolve) => {
          controls.finish = resolve;
        });
      else await new Promise((resolve) => setTimeout(resolve, 150));
      if (controls.fail)
        throw new Error(
          "The owning computer is unavailable. Reconnect it and retry this draft without losing the selected model, permissions or attachments. " +
            "Diagnostic context ".repeat(12),
        );
      return null;
    }
    return null;
  },
  { shouldMockEvents: true },
);
await listen(
  "quick_composer_catalog_request",
  () => void emit("quick_composer_catalog", { models: {}, availableHarnesses: ["codex"] }),
);
applyThemePreference(params.get("theme") === "light" ? "light" : "dark");
await languageReady;
createRoot(document.getElementById("root")!).render(
  <main className="mx-auto max-w-2xl p-3">
    <QuickComposer onShown={() => {}} />
  </main>,
);
