import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { Composer } from "../../src/features/sessions/ui/Composer";
import type { WorkspaceMode } from "../../src/features/sessions/model/session";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import { setDomainLanguagePreference, setLanguagePreference } from "../../src/shared/i18n";
import "../../src/styles/index.css";

// Isolated in-memory Host and Git responses. No provider or real filesystem is used.
mockWindows("main");
const query = new URLSearchParams(location.search);
const cwd = "/fixture/creation-project";
const machine = {
  id: "fixture",
  environmentId: "fixture-environment",
  localHost: true,
  name: "Fixture",
  endpoint: "http://127.0.0.1:1",
};
const policy = {
  defaultMode: query.has("worktree-policy") ? "worktree" : "current",
  integrationBranchRef: "refs/heads/main",
  root: null,
  pinned: false,
  retention: {
    active: "never",
    idle: 1209600000,
    finished: 604800000,
    merged: 86400000,
    abandoned: 604800000,
  },
  disk: { budgetBytes: 53687091200, warningRatio: 0.8, minimumFreeBytes: 21474836480 },
};
const head = "a1b2c3d4e5f67890123456789012345678901234";
mockIPC((command, payload) => {
  if (command.startsWith("plugin:event|")) return null;
  if (command === "local_host_connect") return machine;
  if (command === "remote_machines") return [machine];
  if (command === "remote_request") {
    if (payload.method === "environment.describe")
      return {
        capabilities: query.has("old-host")
          ? []
          : [
              "workspaces.managed.v1",
              "workspaces.policy.v1",
              "sessions.native-process-recovery.v1",
            ],
      };
    if (payload.method === "projects.list") return [{ id: "fixture-project", cwd }];
    if (payload.method === "projects.workspacePolicy.get")
      return { revision: 1, resolved: { policy, appliedScopes: ["host", "project"] } };
    throw new Error(`Unmocked Host method: ${payload.method}`);
  }
  if (command === "git_worktrees")
    return {
      defaultRoot: "/fixture/worktrees",
      worktrees: [
        {
          path: cwd,
          branch: "main",
          head,
          isMain: true,
          locked: false,
          missing: false,
          prunable: false,
          dirty: true,
          unpushed: 0,
          sessionIds: [],
        },
      ],
    };
  if (command === "git_branches")
    return {
      current: "main",
      detached: false,
      branches: [{ name: "main", current: true, remote: null }],
    };
  if (command === "git_diff_index")
    return {
      branch: "main",
      head,
      files: [{ relative: "src/owner-draft.ts" }, { relative: "notes.md" }],
      conflicts: [],
      repository: true,
    };
  if (command === "git_current_branch") return "main";
  if (
    command === "list_dir" ||
    command === "list_files" ||
    command === "list_skills" ||
    command === "mcp_servers" ||
    command === "list_claude_commands" ||
    command === "list_project_files"
  )
    return [];
  return null;
});
applyThemePreference(query.get("theme") === "light" ? "light" : "dark");

function Fixture() {
  const [mode, setMode] = useState<WorkspaceMode>(query.has("worktree") ? "worktree" : undefined);
  const [base, setBase] = useState<string>();
  const [sent, setSent] = useState(false);
  return (
    <main className="min-h-screen bg-(--ui-surface) p-6 text-content">
      <div className="grid gap-6">
        <h1 className="text-lg font-medium">New coding session</h1>
        <Composer
          sessionId="workspace-creation-fixture"
          cwd={cwd}
          executionCwd={cwd}
          focused={false}
          harness="claude"
          model="claude-sonnet-4-5"
          modelSettings={{}}
          runtimeMode="supervised"
          inputAriaLabel="Message"
          draftWorkspace
          workspaceMode={mode}
          worktreeBase={base}
          branch="main"
          initialDraft="Keep the owner's draft while preparing an isolated workspace."
          onWorkspaceModeChange={(next, nextBase) => {
            setMode(next);
            setBase(nextBase);
          }}
          onWorktreeBaseChange={setBase}
          onFocus={() => {}}
          onCwdChange={() => {}}
          onModelChange={() => {}}
          onRuntimeModeChange={() => {}}
          onSubmit={() => {
            setSent(true);
            return false;
          }}
        />
        {sent ? <p role="status">Fixture send accepted</p> : null}
      </div>
    </main>
  );
}
void Promise.all([setLanguagePreference("en"), setDomainLanguagePreference("git", "app")]).then(
  () => {
    createRoot(document.getElementById("root")!).render(
      <QueryClientProvider client={new QueryClient()}>
        <Fixture />
      </QueryClientProvider>,
    );
  },
);
