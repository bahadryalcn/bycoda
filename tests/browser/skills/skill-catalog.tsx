import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { SkillsPage } from "../../../src/features/skills/ui/SkillsPage";
import { applyThemePreference } from "../../../src/features/settings/model/appearance";
import { setLanguagePreference } from "../../../src/shared/i18n";
import { initAppearancePreferences } from "../../../src/features/settings/model/appearancePreferences";
import "../../../src/styles/index.css";

const params = new URLSearchParams(location.search);
const attempts = new Map<string, Record<string, unknown>>();
const document =
  "---\nname: project-guide\ndescription: Project conventions.\n---\n\n# Project guide\n\nPreserve existing drafts and source ownership.\n";
const calls: Record<string, unknown>[] = [];
Object.assign(window, { skillCatalogFixtureCalls: calls });
mockWindows("main");
mockIPC((command, args = {}) => {
  if (command === "local_host_connect")
    return {
      id: "fixture-local",
      name: "This computer",
      localHost: true,
      environmentId: "fixture-local",
    };
  if (command === "remote_request") {
    const request = args as Record<string, unknown>;
    const payload = (request.params ?? {}) as Record<string, unknown>;
    const input = (payload.args ?? {}) as Record<string, unknown>;
    calls.push({ ...payload });
    if (payload.command === "skill_catalog_install") {
      const result = {
        requestId: input.requestId,
        skillId: input.skillId,
        status:
          params.get("result") === "unknown"
            ? "unknown"
            : params.get("result") === "failed"
              ? "failed"
              : "installed",
        ...(params.get("result") === "failed"
          ? { error: "Could not download skill source (HTTP 503)." }
          : {}),
        path: `/fixture/.agents/skills/${input.skillId}/SKILL.md`,
      };
      attempts.set(String(input.requestId), result);
      return result;
    }
    if (payload.command === "skill_catalog_install_status")
      return { ...attempts.get(String(input.requestId)), status: "installed" };
    return [];
  }
  if (command === "list_skills")
    return [
      {
        name: "project-guide",
        description: "Project conventions",
        scope: "project",
        source: "agents",
        path: "/fixture/.agents/skills/project-guide/SKILL.md",
      },
    ];
  if (command === "skill_policy_get") return { disabledNames: [], disabledPaths: [] };
  if (command === "read_text_file") return document;
  if (command === "remote_machines") return [];
  if (command.startsWith("plugin:event|")) return null;
  return null;
});
applyThemePreference(params.get("theme") === "light" ? "light" : "dark");
initAppearancePreferences();
void setLanguagePreference(params.get("lang") === "tr" ? "tr" : "en").then(() => {
  createRoot(window.document.getElementById("root")!).render(
    <main style={{ display: "flex", height: "100dvh" }}>
      <SkillsPage cwd="/fixture" />
    </main>,
  );
});
