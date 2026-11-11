import { emit, listen } from "@tauri-apps/api/event";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { QuickComposer } from "../../../src/features/quick-composer/ui/QuickComposer";
import { quickNativeReply } from "../../../src/features/quick-composer/model/nativeQuickLaunch.fixture";
import { setHarnessModels, saveLastModelChoice } from "../../../src/features/sessions/model/models";
import { applyThemePreference } from "../../../src/features/settings/model/appearance";
import { languageReady } from "../../../src/shared/i18n";
import "../support/w7-shell.css";
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
    if (!call?.args) throw new Error("Fixture workspace picker was not opened");
    const request = (call.args as { request: { id: string; choice: { cwd: string } } }).request;
    await emit("quick_git_result", {
      id: request.id,
      choice: { cwd: request.choice.cwd, mode },
      restoreFocus: true,
    });
  },
};
// `quickFixtureEmit` lets a spec deliver synthesized tauri://drag-* events through the mocked event bus.
Object.assign(window, { quickFixtureCalls: calls, quickFixture: controls, quickFixtureEmit: emit });
let nextSequence = 1;
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
            ? ["workspaces.policy.v1", "workspaces.managed.v1"]
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
    if (command === "quick_composer_launch_scope")
      return { ...quickNativeReply(command, args), nextSequence };
    if (command === "quick_composer_submit_status") return quickNativeReply(command, args);
    if (command === "quick_composer_submit_intent") {
      nextSequence = Math.max(nextSequence, Number(args.submission.sequence) + 1);
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
      return quickNativeReply(command, args);
    }
    return null;
  },
  { shouldMockEvents: true },
);
// Answer like a current workspace: echo the request identity so the catalog is
// accepted at once instead of through the delayed fallback for older workspaces.
await listen("quick_composer_catalog_request", (event) => {
  const catalog = { models: {}, availableHarnesses: ["codex"] };
  const request = event.payload as { requestId?: unknown; generation?: unknown } | null;
  void emit(
    "quick_composer_catalog",
    request && typeof request === "object" && typeof request.requestId === "string"
      ? { requestId: request.requestId, generation: request.generation, catalog }
      : catalog,
  );
});
applyThemePreference(params.get("theme") === "light" ? "light" : "dark");
await languageReady;
createRoot(document.getElementById("root")!).render(
  <main className="mx-auto max-w-2xl p-3">
    <QuickComposer onShown={() => {}} />
  </main>,
);
