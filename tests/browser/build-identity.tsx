import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { UpdateRow } from "../../src/features/settings/ui/GeneralSettings";
import { LocalHostUpdateNotice } from "../../src/features/connections/ui/LocalHostUpdateNotice";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import { setLanguagePreference } from "../../src/shared/i18n";
import type { BuildIdentity } from "../../src/features/workspaces/model/contracts";
import "../../src/styles/index.css";
import "../../src/features/settings/ui/BycodaSettings.css";

const query = new URLSearchParams(location.search);
const identity: BuildIdentity = {
  schemaVersion: 1,
  buildId: "fixture-i2a",
  version: "0.6.78",
  channel: "development",
  mode: "debug",
  repositoryId: "fixture",
  branch: "bycoda/wt-model/i2-app",
  head: "b".repeat(40),
  sourceFingerprint: "fixture-source",
  dirtyPaths: [],
  capturedAt: 1,
  components: { web: "web-fixture", native: "native-fixture", host: "host-fixture" },
  includedSources: [],
};
mockWindows("main");
mockIPC((command, args) => {
  if (command.startsWith("plugin:event|")) return null;
  if (command === "plugin:app|version") return "0.6.78";
  if (command === "build_identity") return query.has("unknown") ? null : identity;
  if (command === "local_host_bundle_status") return { state: "current" };
  if (command === "remote_machines")
    return [
      {
        id: "fixture",
        environmentId: "fixture",
        endpoint: "http://fixture.invalid",
        localHost: true,
      },
    ];
  if (command === "remote_request" && args.method === "environment.describe")
    return { capabilities: [] };
  if (command === "copy_text_to_clipboard") {
    Object.assign(window, { copiedBuildDetails: args.text });
    return null;
  }
  return null;
});
setLanguagePreference("en");
applyThemePreference(query.get("theme") === "dark" ? "dark" : "light");
createRoot(document.getElementById("root")!).render(
  <main className="bycoda-settings-workbench bycoda-arc min-h-screen p-6">
    <div className="bycoda-settings-form general-settings">
      <h1 className="text-ui-title">General</h1>
      <UpdateRow onOpenWhatsNew={() => {}} />
      <LocalHostUpdateNotice />
    </div>
  </main>,
);
