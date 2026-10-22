import { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import OnboardingDialog from "../../src/features/onboarding/ui/OnboardingDialog";
import UsageGuideDialog from "../../src/features/onboarding/ui/UsageGuideDialog";
import { WorkspaceFeatureGate } from "../../src/features/settings/ui/WorkspaceFeatureGate";
import { WORKSPACE_FEATURE_CHOICES } from "../../src/features/settings/ui/WorkspaceFeatureSettings";
import {
  applyThemePreference,
  loadThemePreference,
} from "../../src/features/settings/model/appearance";
import { setLanguagePreference, t } from "../../src/shared/i18n";
import { registerBuiltinHarnesses } from "../../src/integrations/harness/core/register";
import "../../src/styles/index.css";

// Isolated browser storage and memory-only IPC. Never connects to the owner's host.
mockWindows("main");
mockIPC(
  (command, args) => {
    if (command === "provider_terminal_profiles") {
      return [
        {
          id: "terminal-work",
          provider: args?.provider,
          label: "Work",
          path: `D:/profiles/${args?.provider}`,
        },
      ];
    }
    if (command === "provider_terminal_profile_connect") {
      return { id: "terminal-work", provider: args?.provider, label: "Work", path: args?.path };
    }
    if (new URLSearchParams(location.search).has("providers")) {
      if (command === "harness_resolve_claude" || command === "harness_resolve_codex")
        return { path: `C:/fixture/${command.slice(16)}.exe` };
      if (command === "harness_resolve_configured") return { path: args?.binaryPath };
      if (command === "harness_auth_status")
        return args?.provider === "claude" ? "signedIn" : "signedOut";
      if (command === "harness_exec") return "codex-cli 1.0.0";
      if (command === "plugin:dialog|open") return "D:/custom/codex.exe";
    }
    if (
      command === "remote_machines" ||
      command === "session_import_keys" ||
      command === "generic_acp_list"
    )
      return [];
    if (command === "import_discover") return { candidates: [], warnings: [], truncated: false };
    if (command.startsWith("resolve_")) throw new Error("Not installed in the browser fixture");
    if (command.startsWith("plugin:")) return null;
    throw new Error(`Unexpected fixture command: ${command}`);
  },
  { shouldMockEvents: true },
);
registerBuiltinHarnesses();
applyThemePreference(loadThemePreference());

function Fixture() {
  const [open, setOpen] = useState(true);
  if (new URLSearchParams(location.search).has("guide")) {
    return (
      <main className="min-h-screen bg-background-base p-5 text-content">
        <button onClick={() => setOpen(true)}>Reopen guide</button>
        <div data-usage-guide="project-navigation">Projects</div>
        <div data-usage-guide="changes">Changes</div>
        <div
          data-usage-guide="composer"
          style={{
            position: "fixed",
            insetBlockEnd: 24,
            insetInlineStart: "10%",
            inlineSize: "80%",
          }}
        >
          <textarea aria-label="Fixture composer" />
        </div>
        {open && <UsageGuideDialog onClose={() => setOpen(false)} />}
      </main>
    );
  }
  return (
    <main className="min-h-screen bg-background-base p-5 text-content">
      <button onClick={() => setOpen(true)}>Reopen setup</button>
      <nav aria-label="Fixture tools" className="flex gap-4">
        {WORKSPACE_FEATURE_CHOICES.map(({ id, label }) => (
          <WorkspaceFeatureGate key={id} id={id}>
            <button>{t(label)}</button>
          </WorkspaceFeatureGate>
        ))}
      </nav>
      {open ? (
        <OnboardingDialog
          onFinish={() => setOpen(false)}
          onImported={() => undefined}
          onOpenProject={() => undefined}
          onStartGuide={() => setOpen(false)}
        />
      ) : (
        <p>Workspace ready</p>
      )}
    </main>
  );
}
void setLanguagePreference(
  new URLSearchParams(location.search).get("lang") === "tr" ? "tr" : "en",
).then(() => createRoot(document.getElementById("root")!).render(<Fixture />));
