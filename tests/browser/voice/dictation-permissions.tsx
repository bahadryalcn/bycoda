import { createRoot } from "react-dom/client";
import { useState } from "react";
import { VoiceSettings } from "../../../src/features/voice/ui/VoiceSettings";
import { DictationButton } from "../../../src/features/voice/ui/DictationButton";
import { MicrophoneRecoveryAction } from "../../../src/features/voice/ui/MicrophoneRecoveryAction";
import { VoiceCompanion } from "../../../src/features/voice/ui/VoiceCompanion";
import { VoiceSetupSteps } from "../../../src/features/voice/ui/VoiceSetupSteps";
import type { Session } from "../../../src/features/sessions/model/session";
import {
  loadVoiceSettings,
  saveVoiceSettings,
} from "../../../src/features/voice/model/voiceSettings";
import { SettingsFeedback } from "../../../src/features/settings/ui/settingsControls";
import { TextareaField } from "../../../src/shared/ui/TextareaField";
import { setLanguagePreference } from "../../../src/shared/i18n";
import { fixtureDictation } from "./dictation-permissions-mocks";
import "../../../src/styles/index.css";

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
await setLanguagePreference(params.get("lang") === "tr" ? "tr" : "en");
saveVoiceSettings({
  ...loadVoiceSettings(),
  enabled: params.get("companion") === "1",
  dictationEnabled: params.get("dictation") !== "0",
});
Object.defineProperty(navigator, "mediaDevices", {
  configurable: true,
  value: {
    getUserMedia: async () => {
      fixtureDictation.microphoneRequests++;
      const result = fixtureDictation.microphoneResult;
      if (result !== "allowed")
        throw new DOMException(
          "Synthetic microphone result",
          result === "missing"
            ? "NotFoundError"
            : result === "busy"
              ? "NotReadableError"
              : "NotAllowedError",
        );
      return {
        getTracks: () => [
          {
            stop: () => {
              fixtureDictation.microphoneStops++;
            },
          },
        ],
      } as unknown as MediaStream;
    },
    enumerateDevices: async () => [],
  },
});
const fixturePermissionStatus = Object.assign(new EventTarget(), {
  state: "prompt" as PermissionState,
});
Object.defineProperty(navigator, "permissions", {
  configurable: true,
  value: {
    query: async () => fixturePermissionStatus,
  },
});
Object.assign(window, {
  fixtureDictation,
  fixturePermissionStatus,
  loadVoiceSettings,
  saveVoiceSettings,
});
localStorage.setItem("bycoda.voice.persona", JSON.stringify({ status: "skipped" }));
const session = {
  id: "fixture",
  title: "Synthetic dictation session",
  cwd: "/fixture",
  blocks: [],
  harness: "codex",
  model: "fixture-model",
  busy: false,
} as unknown as Session;

function Fixture() {
  const [draft, setDraft] = useState("Unsent draft remains here.");
  const [error, setError] = useState("");
  return (
    <main style={{ padding: 24, maxInlineSize: 960, marginInline: "auto" }}>
      <p>Fixture evidence · synthetic microphone and Host transport</p>
      {params.get("surface") === "setup" ? (
        <VoiceSetupSteps step="microphone" onValidChange={() => {}} />
      ) : params.get("surface") === "companion" ? (
        <VoiceCompanion
          activeId={session.id}
          sessions={[session]}
          onSubmit={() => false}
          onStop={() => {}}
        />
      ) : (
        <VoiceSettings />
      )}
      {!params.has("surface") ? (
        <section aria-label="Message box fixture" style={{ marginBlockStart: 24 }}>
          <TextareaField
            label="Message draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginBlockStart: 8 }}>
            <DictationButton
              onText={(text) => setDraft((value) => `${value} ${text}`)}
              onError={setError}
            />
          </div>
          {error ? (
            <>
              <SettingsFeedback state="error">{error}</SettingsFeedback>
              <MicrophoneRecoveryAction message={error} />
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
