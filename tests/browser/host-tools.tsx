import { applyThemePreference } from "../../src/features/settings/model/appearance";
import { createRoot } from "react-dom/client";
import { SessionHostTools } from "../../src/features/host-tools/SessionHostTools";
import { setLanguagePreference, setDomainLanguagePreference } from "../../src/shared/i18n";
import { calls } from "./host-tools-mocks";
import { registerLogsComposer } from "../../src/features/host-tools/logsComposer";
import "../../src/styles/index.css";
import { ToolsWorkspace } from "../../src/features/host-tools/ToolsWorkspace";
import HostToolsWindow from "../../src/features/host-tools/HostToolsWindow";
import { registerBrowserComposer } from "../../src/features/host-tools/browserComposer";
import { registerDeviceImageComposer } from "../../src/features/devices/deviceImageComposer";
import { requestToolsUi } from "../../src/features/host-tools/toolsUiControl";

const query = new URLSearchParams(location.search);
applyThemePreference(query.get("theme") === "light" ? "light" : "dark");
const locale = query.get("lang") === "tr" ? "tr" : "en";
await setLanguagePreference(locale);
await setDomainLanguagePreference("technical", locale);
Object.assign(window, { hostToolCalls: calls });
registerLogsComposer("G:/demo/example", "fixture-session", (text) => {
  Object.assign(window, { hostLogsDraft: text, hostToolDraft: text });
  return true;
});
registerBrowserComposer("G:/demo/example", "fixture-session", (file) => {
  Object.assign(window, { hostBrowserDraft: file });
  return true;
});
registerDeviceImageComposer("G:/demo/example", "fixture-session", (file, context) => {
  Object.assign(window, { hostDeviceImageDraft: { file, context } });
  return true;
});
const tools = {
  cwd: "G:/demo/example",
  sessionId: "fixture-session",
  title: locale === "tr" ? "Örnek konuşma" : "Example conversation",
};
Object.assign(window, {
  hostToolsUiApi: (action: string, input: Record<string, unknown>, context = tools) =>
    requestToolsUi(context, action, input),
});
createRoot(document.getElementById("root")!).render(
  query.get("detached") === "1" ? (
    <HostToolsWindow {...tools} />
  ) : (
    <ToolsWorkspace>
      <SessionHostTools {...tools} />
    </ToolsWorkspace>
  ),
);
