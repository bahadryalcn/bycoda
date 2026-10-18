import { useState } from "react";
import { initAppearancePreferences } from "../../src/features/settings/model/appearancePreferences";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { SettingsView } from "../../src/features/settings/ui/SettingsView";
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
const skillDocuments = new Map(
  Array.from({ length: 35 }, (_, index) => [
    `/fixture/settings-project/.agents/skills/${index === 0 ? "arc" : `skill-${index}`}/SKILL.md`,
    `---\nname: ${index === 0 ? "arc" : `skill-${index}`}\ndescription: Build and review interfaces using the shared component library.\n---\n\n# Instructions\n\nUse the existing components and preserve project conventions.\n\n${"## Workflow\n\n1. Inspect the page.\n2. Make the change.\n3. Verify the result.\n\n".repeat(12)}`,
  ]),
);
mockIPC(
  (command, args) => {
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
    if (new URLSearchParams(location.search).get("mcp") === "1" && command === "mcp_discover") {
      return Array.from({ length: 25 }, (_, index) => ({
        name: index === 0 ? "arc" : `server-${String(index).padStart(2, "0")}`,
        provider: index % 2 === 0 ? "claude" : "codex",
        scope: "user",
        transport: "http",
        configPath: `/fixture/${"long-project-directory/".repeat(8)}config-${index}.json`,
      }));
    }
    if (new URLSearchParams(location.search).get("skills") === "1") {
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
void Promise.all([
  setLanguagePreference(isLocale(language) ? language : "en"),
  setDomainLanguagePreference("git", "app"),
  setDomainLanguagePreference("technical", "app"),
]).then(() => createRoot(document.getElementById("root")!).render(<Fixture />));
