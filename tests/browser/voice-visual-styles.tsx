import { createRoot } from "react-dom/client";
import { VoiceCompanion } from "../../src/features/voice/ui/VoiceCompanion";
import { VoiceSettings } from "../../src/features/voice/ui/VoiceSettings";
import {
  loadVoiceSettings,
  saveVoiceSettings,
  type VoiceVisual,
} from "../../src/features/voice/model/voiceSettings";
import { fixtureVoice } from "./voice-visual-styles-mocks";
import { setLanguagePreference } from "../../src/shared/i18n";
import type { Session } from "../../src/features/sessions/model/session";
import { registerVoiceDraftReader } from "../../src/features/voice/model/voiceDraftContext";
import "../../src/styles/index.css";
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
await setLanguagePreference(params.get("lang") === "tr" ? "tr" : "en");
saveVoiceSettings({
  ...loadVoiceSettings(),
  enabled: true,
  visual: (params.get("visual") || "mark") as VoiceVisual,
  compact: false,
});
const session = {
  id: "fixture",
  title: "Voice visual styles · a long session title to verify truncation",
  cwd: "/fixture",
  blocks: [],
  harness: "codex",
  model: "fixture-model",
  busy: params.get("state") === "working" || params.has("working"),
} as unknown as Session;
const global = params.has("global");
if (global)
  registerVoiceDraftReader(session.id, () => ({
    text: "Please review this unsent request before I send it.",
    attachments: [
      {
        id: "fixture-text",
        name: "review.txt",
        kind: "file",
        mimeType: "text/plain",
        size: 26,
        data: btoa("Unsent attachment contents"),
      },
    ],
  }));
const workspace = global
  ? {
      tools: [
        {
          name: "workspace.projects.list",
          description: "List fixture projects.",
          parameters: { type: "object", properties: {} },
        },
      ],
      execute: async (action: string) => {
        fixtureVoice.actions.push(action);
        return { status: "completed", projects: [{ path: session.cwd, name: "Fixture project" }] };
      },
    }
  : undefined;
createRoot(document.getElementById("root")!).render(
  <main style={{ padding: 24, maxInlineSize: 720 }}>
    <p>Fixture evidence · synthetic audio and session state</p>
    <VoiceSettings />
    <VoiceCompanion
      activeId={params.has("no-active") ? undefined : session.id}
      sessions={[session]}
      onSubmit={() => {
        fixtureVoice.submits++;
        return false;
      }}
      onStop={() => {
        fixtureVoice.stops++;
      }}
      workspace={workspace}
      projects={global ? [{ path: session.cwd, name: "Fixture project" }] : undefined}
      projectPath={global ? session.cwd : undefined}
      assistantSession={global ? session : undefined}
    />
  </main>,
);
Object.assign(window, { fixtureVoice });
