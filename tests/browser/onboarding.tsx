import { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import OnboardingDialog from "../../src/features/onboarding/ui/OnboardingDialog";
import { WorkspaceFeatureGate } from "../../src/features/settings/ui/WorkspaceFeatureGate";
import { WORKSPACE_FEATURE_CHOICES } from "../../src/features/settings/ui/WorkspaceFeatureSettings";
import {
  applyThemePreference,
  loadThemePreference,
} from "../../src/features/settings/model/appearance";
import { setLanguagePreference, t } from "../../src/shared/i18n";
import "../../src/styles/index.css";

// Isolated browser storage and memory-only IPC. Never connects to the owner's host.
mockWindows("main");
mockIPC(
  (command) => {
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
applyThemePreference(loadThemePreference());

function Fixture() {
  const [open, setOpen] = useState(true);
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
