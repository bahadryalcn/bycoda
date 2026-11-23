import { useContext } from "react";
import { VoicePreferenceRow as Row } from "./VoicePreferenceRow";
import { TextField } from "../../../shared/ui/TextField";
import { t } from "../../../shared/i18n";
import { useAssistantSnapshot } from "../../assistant/model/assistantClient";
import {
  AdvancedSettings,
  Group,
  RevealedSetting,
  Segmented,
  Select,
  Toggle,
} from "../../../shared/ui/settings";
import { ProcessingRow } from "./VoiceProcessingRow";
import { MicrophoneInputSettings } from "./MicrophoneInputSettings";
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
  return (
    <>
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
  // Processing is shared by local voice replies and local dictation, so it has one owner here.
  const processing =
    (companion && local) || (settings.dictationEnabled && settings.dictationEngine === "local");
  const processingRow = processing ? (
    <ProcessingRow setup={setup} value={settings.device} change={change} />
  ) : null;
  return (
    <Group title={t("Assistant")} layout="full">
      <Row id="voice-companion" label={t("Enable voice companion")}>
        <Toggle
          label={t("Enable voice companion")}
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
          stacked
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
      <MicrophoneInputSettings />
      {companion ? (
        <AdvancedSettings
          title={t("More options")}
          settingIds={[
            "voice-speaker",
            "voice-elevenlabs-voice",
            "voice-device",
            "voice-visual-style",
            "voice-wake",
            "voice-wake-phrase",
            "voice-sleep-phrase",
          ]}
          keepMounted
        >
          {engine ? (
            <Row id="voice-speaker" label={t("Speaker")}>
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
          {processingRow}
          <VoiceVisualStyleRow settings={settings} change={change} />
          <VoiceWakeRows settings={settings} change={change} profile={profile} />
        </AdvancedSettings>
      ) : (
        <>
          {processingRow}
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
