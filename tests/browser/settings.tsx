import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { initAppearancePreferences } from "../../src/features/settings/model/appearancePreferences";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { SettingsView } from "../../src/features/settings/ui/SettingsView";
import { WorkspaceSettingsSurface } from "../../src/app/workspace/layout/WorkspaceSettingsSurface";
import {
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "../../src/features/settings/model/settings";
import {
  applyThemePreference,
  saveThemePreference,
} from "../../src/features/settings/model/appearance";
import {
  isLocale,
  setLanguagePreference,
  setDomainLanguagePreference,
  t,
} from "../../src/shared/i18n";
import { t as gitText } from "../../src/shared/i18n/git";
import "../../src/styles/index.css";

// Memory-only desktop transport. Unknown commands fail closed; no owner host,
// accounts, filesystem, credential store or native deletion can be reached.
mockWindows("main");
// Synthetic canonical authority for this UI fixture only. No Native durability or
// cross-process retirement is claimed. Keep CAS, receipts and page identity real.
type FixtureEntry = { key: string; version: number; value: unknown };
const canonicalPage = crypto.randomUUID();
const canonicalScopes = new Map<string, { revision: number; entries: Map<string, FixtureEntry> }>();
const canonicalReceipts = new Map<string, { request: string; result: unknown }>();
function canonicalFixture(command: string, args: Record<string, unknown>): unknown {
  if (command === "canonical_store_page_token") return canonicalPage;
  if (command === "canonical_store_session_guard_ready") return true;
  const scope = String(args.scope);
  const store = canonicalScopes.get(scope) ?? {
    revision: 0,
    entries: new Map<string, FixtureEntry>(),
  };
  canonicalScopes.set(scope, store);
  const entry = (key: string) => store.entries.get(key) ?? null;
  if (command === "canonical_store_get") return structuredClone(entry(String(args.key)));
  if (command === "canonical_store_read")
    return structuredClone({
      revision: store.revision,
      entries: (args.keys as string[]).flatMap((key) => (entry(key) ? [entry(key)] : [])),
    });
  if (command === "canonical_store_list") {
    if (args.expectedRevision != null && args.expectedRevision !== store.revision)
      throw new Error("Fixture canonical snapshot changed");
    return structuredClone({
      revision: store.revision,
      entries: [...store.entries.values()]
        .filter((value) => args.after == null || value.key > String(args.after))
        .sort((a, b) => a.key.localeCompare(b.key))
        .slice(0, Number(args.limit ?? 128)),
    });
  }
  const receiptKey = JSON.stringify([scope, args.operationId]);
  if (command === "canonical_store_receipt")
    return structuredClone(canonicalReceipts.get(receiptKey)?.result ?? null);
  if (command === "canonical_store_transaction") {
    if (args.pageToken !== canonicalPage) throw new Error("Fixture canonical page changed");
    if (args.claim != null) throw new Error("Claimed effects unavailable in Settings fixture");
    const request = JSON.stringify(args);
    const previous = canonicalReceipts.get(receiptKey);
    if (previous) {
      if (previous.request !== request) throw new Error("Fixture canonical operation reused");
      return structuredClone(previous.result);
    }
    const checks = (args.checks ?? []) as Array<{ key: string; version: number | null }>;
    const writes = (args.writes ?? []) as Array<{ key: string; value: unknown }>;
    const applied =
      (args.expectedRevision == null || args.expectedRevision === store.revision) &&
      checks.every((check) => (entry(check.key)?.version ?? null) === check.version);
    if (applied && writes.length) {
      store.revision++;
      for (const write of writes)
        store.entries.set(write.key, {
          key: write.key,
          version: (entry(write.key)?.version ?? 0) + 1,
          value: structuredClone(write.value),
        });
    }
    const result = {
      applied,
      revision: store.revision,
      compacted: false,
      entries: writes.flatMap((write) => (entry(write.key) ? [entry(write.key)] : [])),
    };
    canonicalReceipts.set(receiptKey, { request, result: structuredClone(result) });
    return structuredClone(result);
  }
  throw new Error(`Unsupported canonical Settings fixture command: ${command}`);
}
const skillDocuments = new Map(
  Array.from({ length: 35 }, (_, index) => [
    `/fixture/settings-project/.agents/skills/${index === 0 ? "arc" : `skill-${index}`}/SKILL.md`,
    `---\nname: ${index === 0 ? "arc" : `skill-${index}`}\ndescription: Build and review interfaces using the shared component library.\n---\n\n# Instructions\n\nUse the existing components and preserve project conventions.\n\n${"## Workflow\n\n1. Inspect the page.\n2. Make the change.\n3. Verify the result.\n\n".repeat(12)}`,
  ]),
);
const mcpConnections = Array.from({ length: 25 }, (_, index) => ({
  name: index === 0 ? "arc" : `server-${String(index).padStart(2, "0")}`,
  provider: index % 2 === 0 ? "claude" : "codex",
  scope: "user",
  transport: "http",
  configPath: `/fixture/${"long-project-directory/".repeat(8)}config-${index}.json`,
  enabled: index !== 1,
}));
mockIPC(
  (command, args) => {
    if (command.startsWith("canonical_store_")) return canonicalFixture(command, args);
    // Voice setup is entirely synthetic. It never reaches the owner's host or installs files.
    const voiceFixture = new URLSearchParams(location.search).get("voice");
    if (voiceFixture) {
      const machine = {
        id: "fixture-voice-local",
        name: "This computer",
        localHost: true,
        endpoint: "http://127.0.0.1:9999",
        environmentId: "fixture-voice-local",
      };
      if (command === "local_host_connect") return voiceFixture === "error" ? null : machine;
      if (command === "remote_machines") return [machine];
      if (command === "plugin:dialog|open") return "/fixture/voice/existing-model";
      if (command === "remote_request") {
        const config = (args.params as { config?: Record<string, unknown> })?.config ?? {};
        const installed =
          voiceFixture === "ready" ||
          voiceFixture === "cpu-only" ||
          sessionStorage.getItem("fixture-voice-installed") === "1";
        const installedConfig = {
          natural: config.natural !== false,
          python: "/fixture/voice/bin/python",
          whisperPath: "/fixture/voice/models/whisper",
          ttsPath: "/fixture/voice/models/natural",
        };
        if (args.method === "environment.describe")
          return {
            environmentId: machine.environmentId,
            capabilities: ["voice.local.v1", "voice.local.setup.v1"],
          };
        if (args.method === "voice.local.inspect" && voiceFixture === "stalled")
          return new Promise(() => {});
        if (args.method === "voice.local.inspect")
          return installed
            ? {
                ready: true,
                missing: [],
                ...installedConfig,
                ...(voiceFixture === "cpu-only"
                  ? { gpu: "NVIDIA GeForce RTX 4070", accelerated: false }
                  : {}),
              }
            : {
                ready: false,
                missing: ["faster-whisper", "Whisper model", "voxcpm", "VoxCPM2 model"],
                python: "/fixture/python3",
              };
        if (args.method === "voice.local.setup") {
          sessionStorage.setItem("fixture-voice-install-request", JSON.stringify(config));
          sessionStorage.setItem("fixture-voice-install-polls", "0");
          return { state: "installing", stage: "environment", requestedConfig: config };
        }
        if (args.method === "voice.local.setupStatus") {
          const requested = sessionStorage.getItem("fixture-voice-install-request");
          if (!requested && voiceFixture !== "installing") return { state: "idle" };
          const requestedConfig = requested ? JSON.parse(requested) : { natural: true };
          const polls = Number(sessionStorage.getItem("fixture-voice-install-polls") ?? "0") + 1;
          sessionStorage.setItem("fixture-voice-install-polls", String(polls));
          if (voiceFixture === "installing" || polls < 2)
            return { state: "installing", stage: "models", requestedConfig };
          sessionStorage.setItem("fixture-voice-installed", "1");
          return { state: "ready", config: installedConfig, requestedConfig };
        }
      }
    }
    // Synthetic terminal preferences, isolated from the owner's hosts.
    const shellFixture = new URLSearchParams(location.search).get("terminal");
    if (shellFixture) {
      const profiles = [
        {
          id: "pwsh",
          name: "PowerShell 7",
          path: "C:/Program Files/PowerShell/7/pwsh.exe",
          kind: "powershell",
        },
        { id: "bash", name: "Git Bash", path: "C:/Program Files/Git/bin/bash.exe", kind: "bash" },
        { id: "cmd", name: "Command Prompt", path: "C:/Windows/System32/cmd.exe", kind: "cmd" },
        { id: "wsl", name: "WSL", path: "C:/Windows/System32/wsl.exe", kind: "wsl" },
      ];
      if (command === "terminal_profiles") {
        const scans = Number(sessionStorage.getItem("fixture-shell-scans") ?? 0) + 1;
        sessionStorage.setItem("fixture-shell-scans", String(scans));
        if (shellFixture === "discovery-error" && scans === 1)
          throw new Error("Fixture discovery failed");
        return {
          profiles: shellFixture === "empty" ? [] : profiles,
          defaultId: "pwsh",
          chosenId:
            shellFixture === "missing"
              ? "removed-shell"
              : sessionStorage.getItem("fixture-shell-local"),
        };
      }
      if (command === "set_terminal_profile") {
        sessionStorage.setItem("fixture-shell-local", (args.id as string) ?? "");
        return;
      }
      if (command === "remote_machines")
        return shellFixture === "empty"
          ? []
          : [
              {
                id: "fixture-local",
                name: "This computer (local sync)",
                localHost: true,
                endpoint: "http://127.0.0.1:9999",
                environmentId: "fixture-local",
              },
              {
                id: "fixture-remote",
                name: "Development server with a long descriptive name",
                endpoint: "http://192.0.2.1:9999",
                environmentId: "fixture-remote",
              },
            ];
      if (
        command === "remote_request" &&
        (args.method === "shell.profiles" || args.method === "shell.setProfile")
      ) {
        const key = `fixture-shell-${args.machineId}`;
        if (
          shellFixture === "host-error" &&
          args.machineId === "fixture-remote" &&
          !sessionStorage.getItem("fixture-host-retried")
        ) {
          sessionStorage.setItem("fixture-host-retried", "1");
          throw new Error("Fixture host unavailable");
        }
        if (args.method === "shell.setProfile") {
          if (shellFixture === "save-error") throw new Error("Fixture shell save failed");
          sessionStorage.setItem(key, (args.params as { profile: string | null }).profile ?? "");
        }
        return { profiles, defaultId: "pwsh", chosenId: sessionStorage.getItem(key) };
      }
    }
    if (new URLSearchParams(location.search).get("connections") === "1") {
      const machines = [
        {
          id: "fixture-local",
          name: "This computer",
          localHost: true,
          environmentId: "fixture-local-env",
          endpoint: "http://127.0.0.1:3776",
        },
        {
          id: "fixture-remote",
          name: "Studio Mac",
          environmentId: "fixture-remote-env",
          endpoint: "ssh://owner@studio.local",
          ssh: {
            target: "owner@studio.local",
            alternate: "owner@studio-tailnet",
            remotePort: 3776,
          },
        },
      ];
      if (command === "remote_machines") return machines;
      if (command === "local_host_bundle_status") return { state: "current" };
      if (command === "remote_request") {
        const machine = machines.find((entry) => entry.id === args.machineId)!;
        if (args.method === "mobile.access.status") {
          const mode = (args.params as { mode?: string })?.mode ?? "lan";
          return mode === "lan"
            ? {
                mode,
                state: "ready",
                endpoint: "http://192.168.1.20:3777",
                lanKey: "ab".repeat(32),
                addresses: ["192.168.1.20"],
              }
            : { state: "ready", endpoint: "https://fixture.tail123.ts.net" };
        }
        if (args.method === "mobile.pairing.create")
          return {
            pairingId: "fixture-pair",
            ticket: "a".repeat(43),
            expiresAt: new Date(Date.now() + 120_000).toISOString(),
            environmentId: machine.environmentId,
          };
        if (args.method === "mobile.pairing.status") return { state: "pending" };
        if (args.method === "mobile.pairing.cancel") return {};
        if (args.method === "environment.describe")
          return {
            environmentId: machine.environmentId,
            providers: ["codex", "claude"],
            capabilities: ["workspace.run", "git.worktreeCreate", "tunnels.manage"],
          };
        if (args.method === "tunnels.status")
          return {
            environmentId: machine.environmentId,
            hostLocalUrl: "http://127.0.0.1:3776",
            publicReachability: "unverified",
            providers: [
              { provider: "cloudflare", installed: true, credential: "not-required" },
              { provider: "ngrok", installed: true, credential: "missing" },
            ],
            tunnels: [],
          };
      }
    }
    if (
      new URLSearchParams(location.search).get("mcpError") === "1" &&
      command === "mcp_provider_login"
    ) {
      throw new Error(
        `Fixture login failed for ${String(args.name)}: ${"unreachable-server-".repeat(12)}`,
      );
    }
    if (new URLSearchParams(location.search).get("mcp") === "1") {
      if (command === "mcp_discover") return structuredClone(mcpConnections);
      if (command === "mcp_set_enabled") {
        const server = mcpConnections.find(
          (entry) =>
            entry.provider === args.provider &&
            entry.scope === args.scope &&
            entry.name === args.name &&
            entry.configPath === args.configPath,
        );
        if (!server || server.enabled !== args.expectedEnabled)
          throw new Error("Fixture MCP configuration changed");
        if (new URLSearchParams(location.search).get("mcpToggleError") === "1")
          throw new Error("Fixture MCP write rejected");
        server.enabled = Boolean(args.enabled);
        sessionStorage.setItem("fixture-mcp-toggle", JSON.stringify(args));
        return;
      }
    }
    if (new URLSearchParams(location.search).get("skills") === "1") {
      if (command === "skill_policy_get") return { disabledNames: [], disabledPaths: [] };
      if (command === "list_skills")
        return [...skillDocuments.keys()].map((path, index) => ({
          name: index === 0 ? "arc" : `skill-${index}`,
          path,
          scope: index < 20 ? "user" : "project",
          source: "agents",
          description: "Build and review interfaces using the shared component library.",
        }));
      if (command === "read_text_file") return skillDocuments.get(args.path as string);
      if (command === "write_text_file") {
        skillDocuments.set(args.path as string, args.content as string);
        return;
      }
    }
    if (command.startsWith("plugin:event|")) return null;
    if (command === "plugin:app|version") return "0.5.70-fixture";
    if (
      [
        "remote_machines",
        "generic_acp_list",
        "mcp_discover",
        "skills_list",
        "provider_accounts",
        "provider_account_list",
        "provider_binaries",
        "terminal_profiles",
        "list_skills",
        "session_list_by_project",
        "jira_list_projects",
        "jira_list_boards",
        "linear_list_teams",
        "git_branches",
      ].includes(command)
    )
      return [];
    if (command === "git_worktrees")
      return { worktrees: [], branches: [], defaultRoot: "/fixture/worktrees" };
    if (command === "claude_mcp_list") return "";
    if (
      [
        "git_github_status",
        "gitlab_status",
        "azure_devops_status",
        "jira_status",
        "linear_status",
      ].includes(command)
    )
      return { connected: false, installed: false, url: "", organization: "", site: "", email: "" };
    throw new Error(`Unavailable in isolated Settings fixture: ${command}`);
  },
  { shouldMockEvents: true },
);

const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "light" ? "light" : "dark";
saveThemePreference(theme);
applyThemePreference(theme);
initAppearancePreferences();
const language = params.get("lang");
const initial = params.get("section");
function Fixture() {
  const [section, setSection] = useState<SettingsSectionId>(
    SETTINGS_SECTIONS.find((entry) => entry.id === initial)?.id ?? "general",
  );
  const [open, setOpen] = useState(true);
  const [deletions, setDeletions] = useState(0);
  return (
    <main
      style={{ blockSize: "100dvh" }}
      className="flex h-screen min-w-0 flex-col bg-background-base text-content"
      data-fixture-deletions={deletions}
      data-fixture-labels={JSON.stringify({
        mcp: t("Add MCP server"),
        worktrees: gitText("Create worktree"),
        password: t("Set lock password…"),
        account: t("Add account"),
        skill: t("Add skill"),
        skillName: t("Skill name"),
        cancel: t("Cancel"),
        delete: t("Delete"),
        theme: t(theme === "light" ? "Light" : "Dark"),
        surfaceColors: t("Custom surface colors"),
      })}
    >
      {open ? (
        <SettingsView
          section={section}
          cwd="/fixture/settings-project"
          sessions={[]}
          recents={[{ path: "/fixture/settings-project", openedAt: 1 }]}
          onSelectSection={setSection}
          onClose={() => setOpen(false)}
          onOpenSession={() => {}}
          onArchiveSession={() => {}}
          onDeleteSession={() => {}}
          onRestoreProject={() => {}}
          onDeleteProject={() => setDeletions((count) => count + 1)}
          onOpenWhatsNew={() => {}}
        />
      ) : (
        <button onClick={() => setOpen(true)}>Reopen settings</button>
      )}
    </main>
  );
}
// `?dialog=1` mounts Settings the way App does: a dialog over a workspace that stays mounted.
function DialogFixture() {
  const [section, setSection] = useState<SettingsSectionId>(
    SETTINGS_SECTIONS.find((entry) => entry.id === initial)?.id ?? "general",
  );
  const [open, setOpen] = useState(false);
  const [retries, setRetries] = useState(0);
  const [draft, setDraft] = useState("");
  const history = params.get("history");
  return (
    <main
      className="flex h-screen min-w-0 bg-background-base text-content"
      data-fixture-retries={retries}
    >
      <nav aria-label="Project rail" className="w-56 shrink-0 border-e border-stroke p-3">
        <button type="button" data-testid="open-settings" onClick={() => setOpen(true)}>
          Settings
        </button>
      </nav>
      <section data-workspace-chrome aria-label="Workspace" className="min-w-0 flex-1 p-4">
        <label>
          Workspace draft
          <input value={draft} onChange={(event) => setDraft(event.target.value)} />
        </label>
      </section>
      <WorkspaceSettingsSurface
        presentation="dialog"
        worktreeManagementRequest={null}
        worktreeManagementRevision={0}
        setWorktreeManagementRequest={() => {}}
        onRemoveWorktree={async () => {}}
        settingsOpen={open}
        settingsSection={section}
        settingsAnchor={null}
        notificationProjectPath={null}
        notificationSettingsRequest={0}
        visibleRecents={[{ path: "/fixture/settings-project", openedAt: 1 }]}
        sidebarCwd="/fixture/settings-project"
        sidebarHistory={[]}
        historyFailed={history === "failed"}
        historyPending={history === "pending"}
        onRetryHistory={() => setRetries((count) => count + 1)}
        sessions={[]}
        onCheckWorktreeRemoval={async () => ({ safe: true }) as never}
        onDeleteWorktreeSessions={async () => {}}
        onCloseSettings={() => setOpen(false)}
        onSelectSettingsSection={setSection}
        onOpenArchivedSession={() => {}}
        onArchiveHistorySession={() => {}}
        onDeleteHistorySession={() => {}}
        onRestoreProject={() => {}}
        onRemoveProject={async () => {}}
        onOpenWhatsNew={() => {}}
        collapsedProjectRailMode="compact"
        setCollapsedProjectRailMode={() => {}}
      />
    </main>
  );
}
void Promise.all([
  setLanguagePreference(isLocale(language) ? language : "en"),
  setDomainLanguagePreference("git", "app"),
  setDomainLanguagePreference("technical", "app"),
]).then(() =>
  createRoot(document.getElementById("root")!).render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {params.get("dialog") === "1" ? <DialogFixture /> : <Fixture />}
    </QueryClientProvider>,
  ),
);
