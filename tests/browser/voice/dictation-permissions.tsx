import { createRoot } from "react-dom/client";
import { useRef, useState } from "react";
import { Text } from "../../../src/shared/ui/Text";
import { surfaceAttributes } from "../../../src/shared/ui/Surface";
import { VoiceCompanionRecovery } from "../../../src/features/voice/ui/companion/VoiceCompanionRecovery";
import { VoiceCompanionView } from "../../../src/features/voice/ui/companion/VoiceCompanionView";
import voiceStyles from "../../../src/features/voice/ui/VoiceCompanion.module.css";
import { VoiceSettings } from "../../../src/features/voice/ui/VoiceSettings";
import { DictationButton } from "../../../src/features/voice/ui/DictationButton";
import { reportDictationLanguage } from "../../../src/features/voice/model/dictationActivity";
import { VoiceRecoveryAction } from "../../../src/features/voice/ui/MicrophoneRecoveryAction";
import { VoiceCompanion } from "../../../src/features/voice/ui/VoiceCompanion";
import { VoiceSetupSteps } from "../../../src/features/voice/ui/VoiceSetupSteps";
import type { Session } from "../../../src/features/sessions/model/session";
import {
  loadVoiceSettings,
  saveVoiceSettings,
} from "../../../src/features/voice/model/voiceSettings";
import { SettingsFeedback } from "../../../src/shared/ui/settings";
import { TextareaField } from "../../../src/shared/ui/TextareaField";
import { setLanguagePreference } from "../../../src/shared/i18n";
import { Segmented } from "../../../src/shared/ui/settings";
import { dictationDataOptions, dictationSettingsData } from "./dictation-settings-data";
import { fixtureDictation } from "./dictation-permissions-mocks";
import "../../../src/styles/index.css";

const params = new URLSearchParams(location.search);
if (params.has("detected-turkish")) reportDictationLanguage("tr-TR");
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
// The app shell fixes these roots; this standalone fixture uses ordinary document scrolling.
for (const element of [document.documentElement, document.body, document.getElementById("root")!]) {
  element.style.position = "static";
  element.style.height = "auto";
  element.style.overflow = "visible";
}
document.documentElement.dataset.canvasBackground = "pure";
await setLanguagePreference(params.get("lang") === "tr" ? "tr" : "en");
saveVoiceSettings({
  ...loadVoiceSettings(),
  enabled: params.get("companion") === "1",
  dictationEnabled: params.get("dictation") !== "0",
  ...(params.has("stress") ? dictationSettingsData(params.get("data") ?? "demo") : {}),
  ...(params.get("engine") === "local" ? { dictationEngine: "local" } : {}),
  // `?engine=openrouter` shows the OpenRouter key row; `?tts=elevenlabs` the ElevenLabs key row.
  ...(params.get("engine") === "openrouter" ? { dictationEngine: "openrouter" as const } : {}),
  ...(params.get("tts") === "elevenlabs"
    ? { mode: "local" as const, natural: true, engine: "elevenlabs" as const }
    : {}),
  ...(params.has("missing-device") ? { microphoneId: "disconnected-fixture-device" } : {}),
});
if (params.has("recording-fixture")) {
  fixtureDictation.microphoneResult = "allowed";
  class FixtureRecorder {
    state = "inactive";
    mimeType = "audio/webm";
    ondataavailable?: (event: { data: Blob }) => void;
    onstop?: () => void;
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({
        data: new Blob(["Synthetic fixture audio"], { type: this.mimeType }),
      });
      this.onstop?.();
    }
  }
  class FixtureAudio {
    play() {
      return Promise.resolve();
    }
    pause() {}
  }
  Object.assign(window, { MediaRecorder: FixtureRecorder, Audio: FixtureAudio });
}
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
    enumerateDevices: async () =>
      params.has("recording-fixture")
        ? [
            {
              deviceId: "fixture-microphone",
              kind: "audioinput",
              label: "International clinical research conference microphone",
            },
          ]
        : [],
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

/** `?surface=recovery`: the real recovery block with every notice and retry action present. */
function RecoveryFixture() {
  const notSaved = params.get("recovery") === "history";
  return (
    <section aria-label="Voice companion recovery fixture" className="grid max-w-sm gap-2">
      <VoiceCompanionRecovery
        error={notSaved ? "" : "Conversation was not saved. Retry."}
        shownError=""
        historyNotice={notSaved ? "Conversation history could not be loaded." : ""}
        ruleNotice="Rule was not saved. Retry to keep it."
        returnNotice="You missed a call from the assistant at 14:05."
        briefing={{ retryable: true, canRetry: true, retry: () => {} }}
        rulePending
        savingRule={false}
        onSaveConversation={() => {}}
        onRetryHistory={() => {}}
        onSaveRule={() => {}}
        onTalkNow={() => {}}
      />
    </section>
  );
}

/** `?surface=view`: the real VoiceCompanionView in its panel; `compact`, `error` and `chat` vary it. */
function ViewFixture() {
  const compact = params.has("compact");
  const [chatError] = useState(params.get("error") ?? "");
  const panelRef = useRef<HTMLElement | null>(null);
  const noop = () => {};
  const live = params.get("state") !== "idle";
  return (
    <Text
      as="section"
      size="caption"
      tone="neutral"
      leading="inherit"
      ref={panelRef}
      aria-label="Voice companion"
      {...surfaceAttributes(
        {
          variant: "floating",
          frame: chatError ? "danger" : "pane",
          radius: compact ? "pill" : "panel",
        },
        voiceStyles.panel,
      )}
      data-compact={compact || undefined}
      style={{ position: "relative", right: "auto", bottom: "auto", marginInline: "auto" }}
    >
      <VoiceCompanionView
        compact={compact}
        status={live ? "live" : "idle"}
        handle={<span className="icon-sm" aria-hidden />}
        visualState={live ? "listening" : "off"}
        working={false}
        audioLevel={{ current: 0.3 }}
        title="Voice companion"
        name="Arif"
        avatar={undefined}
        scopeTitle="Synthetic dictation session"
        targetTitle="Synthetic dictation session"
        summary="Reviewing the release notes with you"
        muted={false}
        speakerMuted={false}
        manual={false}
        statusText={live ? "Listening" : "Ready"}
        sessionStatusText="Idle"
        startDisabled={false}
        engine="This computer"
        privacy="Audio is processed on this computer."
        pushHint=""
        workspace
        globalScope={false}
        canDetach
        toolActivities={[]}
        chatTurns={
          params.has("chat")
            ? [
                { id: 1, role: "owner", text: "Summarize what changed in the last release." },
                {
                  id: 2,
                  role: "assistant",
                  text: "Three fixes shipped: voice setup, the model picker and Git filters.",
                },
              ]
            : []
        }
        error={chatError}
        onDismissError={noop}
        liveText=""
        toggleRef={{ current: null }}
        sessionPicker={null}
        choice={null}
        jobReview={null}
        recovery={null}
        panel={panelRef}
        onScopeChange={noop}
        onFloat={noop}
        onStopWaiting={noop}
        onStopWork={noop}
        onStart={noop}
        onClose={noop}
        onDismiss={noop}
        onToggleCompact={noop}
        onToggleMute={noop}
        onToggleSpeaker={noop}
        onSilence={noop}
        onFinish={noop}
        onManualChange={noop}
      />
    </Text>
  );
}

function Fixture() {
  const [data, setData] = useState(params.get("data") ?? "demo");
  const [draft, setDraft] = useState("Unsent draft remains here.");
  const [error, setError] = useState("");
  return (
    <main style={{ padding: 24, maxInlineSize: 960, marginInline: "auto" }}>
      <p>Fixture evidence · synthetic microphone and Host transport</p>
      {params.has("stress") ? (
        <div className="flex flex-wrap gap-2">
          {[dictationDataOptions.slice(0, 3), dictationDataOptions.slice(3)].map(
            (options, index) => (
              <Segmented
                key={index}
                label="Fixture data"
                value={data}
                options={options}
                onChange={(next) => {
                  setData(next);
                  params.set("data", next);
                  history.replaceState(null, "", `${location.pathname}?${params}`);
                  saveVoiceSettings({ ...loadVoiceSettings(), ...dictationSettingsData(next) });
                }}
              />
            ),
          )}
        </div>
      ) : null}
      {params.get("surface") === "recovery" ? (
        <RecoveryFixture />
      ) : params.get("surface") === "view" ? (
        <ViewFixture />
      ) : params.get("surface") === "setup" ? (
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
              <VoiceRecoveryAction message={error} />
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
