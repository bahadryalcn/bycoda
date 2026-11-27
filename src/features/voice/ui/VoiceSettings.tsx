import { useContext } from "react";
import { VoicePreferenceRow as Row } from "./VoicePreferenceRow";
import { TextField } from "../../../shared/ui/TextField";
import { t } from "../../../shared/i18n";
import { useAssistantSnapshot } from "../../assistant/model/assistantClient";
import { Group, RevealedSetting, Segmented, Select, Toggle } from "../../../shared/ui/settings";
import { ProcessingRow } from "./VoiceProcessingRow";
import { MicrophoneInputSettings } from "./MicrophoneInputSettings";
import { audioDeviceChoices, useAudioDevices } from "./useAudioDevices";
import { DictationSettings } from "./DictationSettings";
import { VoiceCloudKey } from "./VoiceCloudKey";
import { VoiceSetupRow } from "./VoiceSetupRow";
import { VoiceConversationStyle } from "./VoiceConversationStyle";
import { VoiceVisualStyleRow } from "./VoiceCompanionSettings";
import { VoiceWakeRows } from "./VoiceWakeSettings";
import { useVoiceSetup, type VoiceSetup } from "./useVoiceSetup";
import { speakerEngine, speakerOptions } from "../model/voiceSpeakers";
import { voiceProviderLabel, voiceProviderOptions } from "../model/voiceProviders";
import {
  VOICE_SETTINGS_DEFAULTS as DEFAULTS,
  useVoiceSettings,
  type VoiceMode,
  type VoiceSettings as Preferences,
} from "../model/voiceSettings";

import { saveVoiceSettingsPatch } from "../model/voiceSettingsSave";

type Change = (patch: Partial<Preferences>) => void;

/** The Voice assistant settings page: the assistant, its conversation, then dictation. */
export function VoiceSettings() {
  const { snapshot: assistant } = useAssistantSnapshot();
  const settings = useVoiceSettings();
  const change: Change = saveVoiceSettingsPatch;
  const setup = useVoiceSetup(settings, change);
  const companion = setup.speechEnabled && settings.enabled;
  // Processing is shared by local voice replies and local dictation, so it sits with the audio input.
  const processing =
    (companion && settings.mode === "local") ||
    (settings.dictationEnabled && settings.dictationEngine === "local");
  return (
    <>
      <Group title={t("Audio input")} layout="full">
        <MicrophoneInputSettings />
        {processing ? (
          <ProcessingRow setup={setup} value={settings.device} change={change} />
        ) : null}
      </Group>
      <VoiceAssistantGroup
        settings={settings}
        change={change}
        setup={setup}
        companion={companion}
        profile={assistant?.profile}
      />
      {companion ? (
        <VoiceConversationStyle
          settings={settings}
          change={change}
          assistantMemoryCount={assistant?.memory.length}
        />
      ) : null}
      <DictationSettings settings={settings} change={change} setup={setup} />
    </>
  );
}

function VoiceAssistantGroup({
  settings,
  change,
  setup,
  companion,
  profile,
}: {
  settings: Preferences;
  change: Change;
  setup: VoiceSetup;
  companion: boolean;
  profile?: { name: string; language: string };
}) {
  const { installing } = setup;
  const revealed = useContext(RevealedSetting);
  const local = settings.mode === "local";
  const engine = speakerEngine(settings);
  const elevenLabs = local && settings.natural && settings.engine === "elevenlabs";
  return (
    <Group title={t("Assistant")} layout="full">
      <Row
        id="voice-companion"
        label={t("Voice assistant")}
        modified={!installing && settings.enabled !== DEFAULTS.enabled}
        onReset={() => change({ enabled: DEFAULTS.enabled })}
      >
        <Toggle
          label={t("Voice assistant")}
          on={settings.enabled}
          disabled={installing}
          onChange={(enabled) => change({ enabled })}
        />
      </Row>
      {companion ? <VoiceSetupRow setup={setup} settings={settings} change={change} /> : null}
      {companion ? (
        <Row
          id="voice-mode"
          label={t("Voice provider")}
          controlWidth="wide"
          // Only a cloud provider changes where audio goes, and the owner must see that.
          description={
            local
              ? undefined
              : t("Voice runs on {p1}. Audio is sent to the provider while voice is on.", {
                  p1: voiceProviderLabel(settings.mode),
                })
          }
          descriptionVisible={!local}
          disabled={installing}
          modified={!installing && settings.mode !== DEFAULTS.mode}
          onReset={() => change({ mode: DEFAULTS.mode })}
        >
          <Segmented
            label={t("Voice provider")}
            value={settings.mode}
            options={voiceProviderOptions()}
            onChange={(mode) => change({ mode: mode as VoiceMode })}
          />
        </Row>
      ) : null}
      {companion && local ? (
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
          modified={
            !installing &&
            (settings.natural !== DEFAULTS.natural || settings.engine !== DEFAULTS.engine)
          }
          onReset={() => {
            setup.resetJob();
            change({ natural: DEFAULTS.natural, engine: DEFAULTS.engine });
          }}
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
      {companion && elevenLabs ? (
        <VoiceCloudKey provider="elevenlabs" onSaved={() => setup.check()} />
      ) : null}
      {companion ? (
        <>
          {engine ? (
            <Row
              id="voice-speaker"
              label={t("Speaker")}
              modified={settings.speakers[engine] !== DEFAULTS.speakers[engine]}
              onReset={() =>
                change({
                  speakers: {
                    ...settings.speakers,
                    [engine]: DEFAULTS.speakers[engine],
                  },
                })
              }
            >
              <Select
                hideLabel
                label={t("Speaker")}
                value={settings.speakers[engine]}
                options={speakerOptions(engine)}
                onChange={(value) =>
                  change({ speakers: { ...settings.speakers, [engine]: value } })
                }
              />
            </Row>
          ) : null}
          {elevenLabs ? (
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
          ) : null}
          <AudioOutputSettings />
          <VoiceVisualStyleRow settings={settings} change={change} />
          <VoiceWakeRows settings={settings} change={change} profile={profile} />
        </>
      ) : (
        <>
          {/* Settings search can land here while voice is off; say what the row needs. */}
          {revealed === "voice-wake" ? (
            <Row
              id="voice-wake"
              label={t("Wake and sleep phrases")}
              disabled
              disabledReason={t("Turn on voice to use wake and sleep phrases.")}
            />
          ) : null}
        </>
      )}
    </Group>
  );
}

/** Where spoken replies play; the companion's speaker button offers the same choice on right-click. */
function AudioOutputSettings() {
  const settings = useVoiceSettings();
  const { devices, unidentified } = useAudioDevices("audiooutput");
  return (
    <Row id="voice-speaker-output" label={t("Audio output")}>
      <Select
        hideLabel
        label={t("Audio output")}
        value={settings.speakerOutputId ?? ""}
        options={audioDeviceChoices("audiooutput", devices, unidentified, settings.speakerOutputId)}
        onChange={(speakerOutputId) => saveVoiceSettingsPatch({ speakerOutputId })}
      />
    </Row>
  );
}
