import { createRoot } from "react-dom/client";
import { mockConvertFileSrc, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { HtmlPreview } from "../../src/features/files/ui/HtmlPreview";
import { ChatFolderBrowser } from "../../src/features/files/ui/ChatFolderBrowser";
import { FilePicker } from "../../src/features/files/ui/FilePicker";
import { MediaView } from "../../src/features/files/ui/MediaView";
import { BinaryFileView } from "../../src/features/files/ui/BinaryFileView";
import { SearchView } from "../../src/features/search/ui/SearchView";
import { ProjectNotificationSettings } from "../../src/features/notifications/ui/ProjectNotificationSettings";
import { VoiceSettings } from "../../src/features/voice/ui/VoiceSettings";
import { localVoiceBackend } from "../../src/features/voice/model/localVoiceClient";
import { loadVoiceSettings, saveVoiceSettings } from "../../src/features/voice/model/voiceSettings";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import { languageReady } from "../../src/shared/i18n";
import "../../src/styles/index.css";

// Synthetic native and voice operations only. No owner host, microphone, file or provider access.
const params = new URLSearchParams(location.search);
localStorage.setItem("bycoda.language", "en");
applyThemePreference(params.get("theme") === "light" ? "light" : "dark");
mockWindows("utilities-fixture");
mockConvertFileSrc("windows");
const calls: string[] = [];
const controls = {
  fail: params.has("error"),
  hold: params.has("hold"),
  finish: () => {},
  calls,
};
Object.assign(window, { utilitiesFixture: controls });
const operation = async (name: string) => {
  calls.push(name);
  if (controls.hold)
    await new Promise<void>((resolve) => {
      controls.finish = resolve;
    });
  if (controls.fail)
    throw new Error(
      "The connected computer is unavailable. Reconnect and retry this operation. " +
        "Long diagnostic detail. ".repeat(8),
    );
};
mockIPC(
  async (command) => {
    if (command === "read_binary_file")
      return params.has("unsupported")
        ? new Uint8Array([1, 2, 3]).buffer
        : (await fetch("/brand/bycoda-tasks.png")).arrayBuffer();
    if (command === "copy_file_to_clipboard" || command === "reveal_path") {
      await operation(command);
      return;
    }
    if (command === "create_html_preview") {
      await operation(command);
      return "fixture-preview";
    }
    if (command === "list_project_files") {
      if (params.get("view") === "picker") await operation(command);
      return [{ name: "report.md", relative: "notes/report.md", path: "/fixture/notes/report.md" }];
    }
    if (command === "search_project") {
      await operation(command);
      return {
        matches: [
          {
            path: "/fixture/notes/report.md",
            relative: "notes/report.md",
            line: 12,
            column: 1,
            preview: "The report keeps complete search context.",
          },
        ],
        truncated: false,
      };
    }
    if (command === "session_search_content") return { sessions: [], pending: 0, truncated: false };
    if (command === "inspect_paths") return [{ isDir: true }];
    if (command === "plugin:dialog|open") {
      await operation(command);
      return "C:/Shared";
    }
    if (command === "list_dir")
      return ["Reports", "A long filename with useful project context.md"].map((name, index) => ({
        name,
        path: `/fixture/${name}`,
        isDir: index === 0,
        ignored: false,
      }));
    if (command === "git_worktrees") return { worktrees: [], defaultRoot: "/worktrees" };
    if (command === "remote_open_live_folder" || command === "open_path_with_default_app") {
      await operation(command);
      return null;
    }
    return [];
  },
  { shouldMockEvents: true },
);
localVoiceBackend.inspect = async () => {
  await operation("inspect");
  return { ready: true, missing: [] };
};
localVoiceBackend.setupStatus = async () => ({ state: "idle" });
localVoiceBackend.setup = async () => {
  await operation("setup");
  return { state: "idle" };
};
if (params.get("view") === "voice") saveVoiceSettings({ ...loadVoiceSettings(), enabled: true });
await languageReady;
const noop = () => {};
const view = params.get("view");
const audioBytes = async () => {
  const bytes = new Uint8Array(844);
  const data = new DataView(bytes.buffer);
  for (const [offset, text] of [
    [0, "RIFF"],
    [8, "WAVEfmt "],
    [36, "data"],
  ] as const)
    [...text].forEach((letter, index) => {
      bytes[offset + index] = letter.charCodeAt(0);
    });
  data.setUint32(4, 836, true);
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, 8000, true);
  data.setUint32(28, 8000, true);
  data.setUint16(32, 1, true);
  data.setUint16(34, 8, true);
  data.setUint32(40, 800, true);
  bytes.fill(128, 44);
  return bytes;
};
createRoot(document.getElementById("root")!).render(
  <main className="flex h-dvh min-w-0 flex-col bg-(--ui-surface) text-content">
    {view === "binary" ? (
      <BinaryFileView cwd="/fixture" path="/fixture/preview.png" />
    ) : view === "picker" ? (
      <FilePicker cwd="/fixture" open onClose={noop} onOpenFile={noop} onRunAction={noop} />
    ) : view === "media" ? (
      <MediaView path="/fixture/sample.wav" readBytes={audioBytes} mimeType="audio/wav" />
    ) : view === "html" ? (
      <HtmlPreview path="/fixture/report.html" source="<p>Preview content</p>" active />
    ) : view === "folder" ? (
      <ChatFolderBrowser path="/fixture" onOpenFile={noop} onClose={noop} />
    ) : view === "voice" ? (
      <div className="overflow-auto p-4">
        <VoiceSettings />
      </div>
    ) : view === "notifications" ? (
      <div className="overflow-auto p-4">
        <ProjectNotificationSettings
          cwd="/fixture"
          recents={[
            { path: "/fixture/Long project name for notification preferences", openedAt: 1 },
          ]}
        />
      </div>
    ) : (
      <SearchView
        cwd="/fixture"
        open
        presentation="dialog"
        recents={[]}
        history={[]}
        sessions={[]}
        onClose={noop}
        onOpenFile={noop}
        onOpenSession={noop}
        onOpenProject={noop}
      />
    )}
  </main>,
);
