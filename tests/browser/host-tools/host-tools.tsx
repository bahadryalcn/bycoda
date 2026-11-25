import { applyThemePreference } from "../../../src/features/settings/model/appearance";
import { createRoot } from "react-dom/client";
import { SessionHostTools } from "../../../src/features/host-tools/SessionHostTools";
import { setLanguagePreference, setDomainLanguagePreference } from "../../../src/shared/i18n";
import { calls } from "./host-tools-mocks";
import { registerLogsComposer } from "../../../src/features/host-tools/logsComposer";
import "../../../src/styles/index.css";
import { ToolsWorkspace } from "../../../src/features/host-tools/ToolsWorkspace";
import { DesktopControlSettings } from "../../../src/features/host-tools/DesktopControlSettings";
import HostToolsWindow from "../../../src/features/host-tools/HostToolsWindow";
import {
  DesktopControlStripView,
  type DesktopIndicatorStatus,
} from "../../../src/features/host-tools/DesktopControlStripView";
import { AgentTabView } from "../../../src/features/sessions/ui/AgentTabView";
import { ToolInspectionPanel } from "../../../src/features/sessions/ui/ToolInspectionPanel";
import type { Block } from "../../../src/features/sessions/model/session";
import { registerBrowserComposer } from "../../../src/features/host-tools/browserComposer";
import { registerDeviceImageComposer } from "../../../src/features/devices/deviceImageComposer";
import { requestToolsUi } from "../../../src/features/host-tools/toolsUiControl";
import {
  readToolsDraftTransfer,
  restoreToolsDraftTransfer,
} from "../../../src/features/host-tools/toolsDraftTransfer";

const query = new URLSearchParams(location.search);
applyThemePreference(query.get("theme") === "light" ? "light" : "dark");
const locale = query.get("lang") === "tr" ? "tr" : "en";
await setLanguagePreference(locale);
await setDomainLanguagePreference("technical", locale);
Object.assign(window, { hostToolCalls: calls });
Object.assign(window, {
  hostDeviceFixtureRestoreUnknown: () => {
    const current = readToolsDraftTransfer("G:/demo/example", "fixture-session", "project");
    if (!current?.device) throw new Error("Device fixture draft is not ready");
    const draft = current.device.annotations[current.device.selected];
    if (!draft) throw new Error("Mark the fixture frame before restoring uncertainty");
    draft.transferOperation = {
      id: "fixture-unknown-attachment",
      sourceWindow: "local",
      destinationWindow: "local",
      cwd: "G:/demo/example",
      sessionId: "fixture-session",
      fingerprint: "0".repeat(64),
    };
    restoreToolsDraftTransfer("G:/demo/example", "fixture-session", "project", current);
  },
});
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
// `?hub=owner-gone|pending|no-tools` stubs the native window bridge so the detached hub's
// owner/return/empty states render; without it the fixture keeps its browser-only behavior.
const hub = query.get("hub");
const owner = "session-main";
if (hub) {
  const { mockIPC, mockWindows } = await import("@tauri-apps/api/mocks");
  mockWindows("tools-hub");
  mockIPC(
    (command) => {
      if (command === "plugin:window|get_all_windows")
        return hub === "owner-gone" ? ["tools-hub"] : ["tools-hub", owner];
      if (command === "plugin:window|available_monitors") return [];
      return null;
    },
    { shouldMockEvents: true },
  );
}
const tools = {
  cwd: query.has("remote-machine-picker") ? "remote://fixture-mac-env/repo" : "G:/demo/example",
  sessionId: "fixture-session",
  title: locale === "tr" ? "Örnek konuşma" : "Example conversation",
  ...(hub ? { composerWindow: owner } : {}),
};
if (hub === "no-tools") {
  // The owner reports a different active conversation that has no tools open.
  const { emit } = await import("@tauri-apps/api/event");
  setTimeout(() => {
    void emit("bycoda:tools-hub", {
      kind: "snapshot",
      snapshot: {
        sourceWindow: owner,
        revision: 1,
        selectionRevision: 1,
        active: {
          cwd: "G:/demo/release",
          sessionId: "release-notes",
          title: "Release notes",
          composerWindow: owner,
        },
        panes: [],
      },
    });
  }, 700);
}
const inspectedBlock: Block = {
  id: "inspect",
  role: "tool",
  text: "",
  tool: {
    callId: "call-1",
    title: "pnpm test",
    kind: "shell",
    status: "completed",
    preview: { kind: "shell", title: "pnpm test" },
    output: "RUN v3.2.0\n ✓ src/a.test.ts (4)\n ✗ src/b.test.ts (1)\n   Expected 2 received 3",
    outputTruncated: true,
  },
};
Object.assign(window, {
  hostToolsUiApi: (action: string, input: Record<string, unknown>, context = tools) =>
    requestToolsUi(context, action, input),
});
const strips: [string, DesktopIndicatorStatus, Record<string, unknown>][] = [
  ["Ready", { enabled: true, active: false, stopped: false }, {}],
  [
    "Working",
    {
      enabled: true,
      active: true,
      stopped: false,
      currentAction: { app: "Notes", action: "type" },
    },
    {},
  ],
  ["Stopped", { enabled: true, active: false, stopped: true }, {}],
  ["Stopping", { enabled: true, active: true, stopped: false }, { stopping: true }],
  ["Unknown", { enabled: true, active: false, stopped: false }, { unknown: true }],
  [
    "Error",
    { enabled: true, active: false, stopped: false },
    { error: "The desktop helper stopped answering. Stop may not have reached it." },
  ],
  [
    "Off, forced visible",
    { enabled: false, active: false, stopped: false },
    { forceVisible: true },
  ],
  ["Floating", { enabled: true, active: true, stopped: false }, { floating: true }],
];
createRoot(document.getElementById("root")!).render(
  query.has("desktop-strip") ? (
    <main className="flex flex-col gap-3 p-4">
      {strips.map(([label, status, extra]) => (
        <section key={label} aria-label={label}>
          <DesktopControlStripView
            name="Demo computer"
            status={status}
            onStop={() => {}}
            onDismiss={() => {}}
            {...extra}
          />
        </section>
      ))}
    </main>
  ) : query.has("agent-tab") ? (
    // A worker that already finished has no live session; a live one needs hydrated session-owner storage.
    <div style={{ height: "100dvh" }}>
      <AgentTabView title="Worker" visible />
    </div>
  ) : query.has("tool-inspection") ? (
    <main className="max-w-2xl p-4">
      <ToolInspectionPanel block={inspectedBlock} />
    </main>
  ) : query.has("desktop-standalone") ? (
    <main className="p-4">
      <DesktopControlSettings />
    </main>
  ) : query.get("detached") === "1" ? (
    <HostToolsWindow {...tools} />
  ) : (
    <ToolsWorkspace>
      <SessionHostTools {...tools} />
    </ToolsWorkspace>
  ),
);
