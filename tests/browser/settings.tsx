import { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { SettingsView } from "../../src/features/settings/ui/SettingsView";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "../../src/features/settings/model/settings";
import { applyThemePreference, saveThemePreference } from "../../src/features/settings/model/appearance";
import { isLocale, setLanguagePreference, setDomainLanguagePreference, t } from "../../src/shared/i18n";
import { t as gitText } from "../../src/shared/i18n/git";
import "../../src/styles/index.css";

// Memory-only desktop transport. Unknown commands fail closed; no owner host,
// accounts, filesystem, credential store or native deletion can be reached.
mockWindows("main");
mockIPC((command) => {
  if (command.startsWith("plugin:event|")) return null;
  if (command === "plugin:app|version") return "0.5.70-fixture";
  if (["remote_machines", "generic_acp_list", "mcp_discover", "skills_list",
    "provider_accounts", "provider_account_list", "provider_binaries", "terminal_profiles", "list_skills", "session_list_by_project",
    "jira_list_projects", "jira_list_boards", "linear_list_teams", "git_branches"].includes(command)) return [];
  if (command === "git_worktrees") return { worktrees: [], branches: [], defaultRoot: "/fixture/worktrees" };
  if (command === "claude_mcp_list") return "";
  if (["git_github_status", "gitlab_status", "azure_devops_status", "jira_status", "linear_status"].includes(command))
    return { connected: false, installed: false, url: "", organization: "", site: "", email: "" };
  throw new Error(`Unavailable in isolated Settings fixture: ${command}`);
}, { shouldMockEvents: true });

const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "light" ? "light" : "dark";
saveThemePreference(theme);
applyThemePreference(theme);
const language = params.get("lang");
const initial = params.get("section");
function Fixture() {
  const [section, setSection] = useState<SettingsSectionId>(
    SETTINGS_SECTIONS.find((entry) => entry.id === initial)?.id ?? "general",
  );
  const [open, setOpen] = useState(true);
  const [deletions, setDeletions] = useState(0);
  return (
    <main className="flex h-screen min-w-0 flex-col bg-background-base text-content"
      data-fixture-deletions={deletions}
      data-fixture-labels={JSON.stringify({ mcp: t("Add MCP server"), worktrees: gitText("Create worktree"), password: t("Set lock password…"), account: t("Add account"), skill: t("Add skill"), skillName: t("Skill name"), cancel: t("Cancel"), delete: t("Delete"), theme: t(theme === "light" ? "Light" : "Dark") })}>
      {open ? <SettingsView section={section} cwd="/fixture/settings-project" sessions={[]}
        recents={[{ path: "/fixture/settings-project", openedAt: 1 }]}
        onSelectSection={setSection} onClose={() => setOpen(false)}
        onOpenSession={() => {}} onArchiveSession={() => {}} onDeleteSession={() => {}}
        onRestoreProject={() => {}} onDeleteProject={() => setDeletions((count) => count + 1)}
        onOpenWhatsNew={() => {}} />
        : <button onClick={() => setOpen(true)}>Reopen settings</button>}
    </main>
  );
}
void Promise.all([setLanguagePreference(isLocale(language) ? language : "en"),
  setDomainLanguagePreference("git", "app"), setDomainLanguagePreference("technical", "app")])
  .then(() => createRoot(document.getElementById("root")!).render(<Fixture />));
