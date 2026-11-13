import { VoicePreferenceRow as Row } from "./VoicePreferenceRow";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { TextField } from "../../../shared/ui/TextField";
import { t, useLocale } from "../../../shared/i18n";
import { useAssistantSnapshot, assistantIdentity } from "../../assistant/model/assistantClient";
import {
  AdvancedSettings,
  Group,
  Segmented,
  Select,
  Toggle,
} from "../../settings/public/settingsControls";
import { ProcessingRow } from "./VoiceProcessingRow";
import { MicrophoneInputSettings } from "./MicrophoneInputSettings";
import { DictationSettings } from "./DictationSettings";
import { VoiceActivityRow } from "./VoiceActivityRow";
import { VoiceCloudKey } from "./VoiceCloudKey";
import { MicrophonePermissionSettings } from "./MicrophonePermissionSettings";
import { VoiceSetupRow } from "./VoiceSetupRow";
import { VoiceConversationStyle } from "./VoiceConversationStyle";
import { VoiceCompanionSettings } from "./VoiceCompanionSettings";
import { useVoiceSetup, type VoiceSetup } from "./useVoiceSetup";
import { speakerEngine, speakerOptions } from "../model/voiceSpeakers";
import {
  useVoiceSettings,
  type VoiceMode,
  type VoiceSettings as Preferences,
} from "../model/voiceSettings";

import { saveVoiceSettingsPatch } from "../model/voiceSettingsSave";

type Change = (patch: Partial<Preferences>) => void;

/** The Voice assistant settings page: dictation, companion, engine, conversation style and look. */
export function VoiceSettings() {
  const locale = useLocale();
  const { snapshot: assistant } = useAssistantSnapshot();
  const settings = useVoiceSettings();
  const change: Change = saveVoiceSettingsPatch;
  const setup = useVoiceSetup(settings, change);
  const { speechEnabled, installing } = setup;
  const companion = speechEnabled && settings.enabled;
  return (
    <>
      <Group title={t("Voice and dictation")} layout="full">
        <VoiceActivityRow />
        <Row
          id="voice-companion"
          label={t("Enable voice companion")}
          info={
            <InfoPopover label={`${t("Enable voice companion")}: ${t("Help")}`}>
              {settings.mode === "local"
                ? t(
                    "Talk to your session while the agent works. Audio is processed on this computer.",
                  )
                : t("Talk to your session while the agent works.")}
            </InfoPopover>
          }
        >
          <Toggle
            label={t("Enable voice companion")}
            on={settings.enabled}
            disabled={installing}
            onChange={(enabled) => change({ enabled })}
          />
        </Row>
        <MicrophonePermissionSettings />
        <MicrophoneInputSettings />
        {speechEnabled ? <VoiceSetupRow setup={setup} settings={settings} change={change} /> : null}
      </Group>
      {companion ? <VoiceEngine settings={settings} change={change} setup={setup} /> : null}
      <DictationSettings settings={settings} change={change} setup={setup} />
      {companion ? (
        <>
          <VoiceConversationStyle
            settings={settings}
            change={change}
            profile={assistant?.profile}
          />
          <VoiceCompanionSettings
            settings={settings}
            change={change}
            assistantName={
              assistant?.profile.name
                ? assistantIdentity(assistant.profile, locale).title
                : undefined
            }
            assistantMemoryCount={assistant?.memory.length}
          />
        </>
      ) : null}
    </>
  );
}

function VoiceEngine({
  settings,
  change,
  setup,
}: {
  settings: Preferences;
  change: Change;
  setup: VoiceSetup;
}) {
  const { installing } = setup;
  const local = settings.mode === "local";
  const engine = speakerEngine(settings);
  // Speaker voice for Supertonic and the cloud conversations.
  const speakerRow = engine ? (
    <Row id="voice-speaker" label={t("Speaker")}>
      <Select
        hideLabel
        label={t("Speaker")}
        value={settings.speakers[engine]}
        options={speakerOptions(engine)}
        onChange={(value) => change({ speakers: { ...settings.speakers, [engine]: value } })}
      />
    </Row>
  ) : null;
  return (
    <Group title={t("Voice engine")} layout="full">
      <Row
        id="voice-mode"
        label={t("Conversation")}
        stacked
        description={
          local
            ? t("Speech is recognized on this computer; the session's provider writes replies.")
            : t("Voice runs on {p1}. Audio is sent to the provider while voice is on.", {
                p1: settings.mode === "grok" ? "Grok Voice" : "OpenAI Realtime",
              })
        }
        disabled={installing}
      >
        <Segmented
          label={t("Conversation")}
          value={settings.mode}
          options={[
            { value: "local", label: t("Local") },
            // Signed in through Grok Build and Codex; no separate API key.
            { value: "grok", label: "Grok Voice" },
            { value: "openai", label: "OpenAI Realtime" },
          ]}
          onChange={(mode) => change({ mode: mode as VoiceMode })}
        />
      </Row>
      {local ? (
        <Row
          id="voice-engine"
          label={t("Reply voice")}
          description={
            !settings.natural
              ? t("An installed voice of this computer.")
              : settings.engine === "voxcpm2"
                ? t("High quality sounds richer but needs an NVIDIA GPU.")
                : settings.engine === "elevenlabs"
                  ? t("Natural cloud voice. Only the reply text leaves this computer.")
                  : t("Fast and private: runs on this computer's processor.")
          }
          disabled={installing}
        >
          <Select
            hideLabel
            label={t("Reply voice")}
            value={!settings.natural ? "system" : settings.engine}
            options={[
              { value: "supertonic", label: t("Natural (Supertonic)") },
              { value: "voxcpm2", label: t("High quality (VoxCPM2)") },
              { value: "elevenlabs", label: "ElevenLabs" },
              { value: "system", label: t("System voice") },
            ]}
            onChange={(value) => {
              setup.resetJob();
              change(
                value === "system"
                  ? { natural: false }
                  : { natural: true, engine: value as Preferences["engine"] },
              );
            }}
          />
        </Row>
      ) : null}
      {speakerRow}
      {local && settings.natural && settings.engine === "elevenlabs" ? (
        <>
          <VoiceCloudKey provider="elevenlabs" onSaved={() => setup.check()} />
          <Row
            id="voice-elevenlabs-voice"
            label={t("ElevenLabs voice ID")}
            description={t("Optional. Leave empty for a multilingual default voice.")}
          >
            <TextField
              label={t("ElevenLabs voice ID")}
              hideLabel
              value={settings.elevenVoice}
              placeholder="JBFqnCBsd6RMkjVDRZzb"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                const value = event.target.value.trim();
                if (/^[A-Za-z0-9]{0,64}$/.test(value)) change({ elevenVoice: value });
              }}
            />
          </Row>
        </>
      ) : null}
      {local ? (
        <AdvancedSettings title={t("Voice options")} settingIds={["voice-device"]} keepMounted>
          <ProcessingRow id="voice-device" setup={setup} value={settings.device} change={change} />
        </AdvancedSettings>
      ) : null}
    </Group>
  );
}
