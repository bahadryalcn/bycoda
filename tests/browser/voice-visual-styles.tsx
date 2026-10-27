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
  busy: params.get("state") === "working" || params.has("working"),
} as unknown as Session;
createRoot(document.getElementById("root")!).render(
  <main style={{ padding: 24, maxInlineSize: 720 }}>
    <p>Fixture evidence · synthetic audio and session state</p>
    <VoiceSettings />
    <VoiceCompanion
      activeId={session.id}
      sessions={[session]}
      onSubmit={() => false}
      onStop={() => {}}
    />
  </main>,
);
Object.assign(window, { fixtureVoice });
