import { Badge } from "../../../shared/ui/Badge";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { TextField } from "../../../shared/ui/TextField";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import { t, useLocale } from "../../../shared/i18n";
import { useAssistantSnapshot, assistantIdentity } from "../../assistant/model/assistantClient";
import {
  AdvancedSettings,
  Group,
  Row,
  Segmented,
  Select,
  Toggle,
} from "../../settings/public/settingsControls";
import { VoiceActivityRow } from "./VoiceActivityRow";
import {
  DICTATION_LANGUAGES,
  DICTATION_MODELS,
  DICTATION_PROVIDER_NAMES,
  dictationModel,
} from "../model/dictationModels";
import { VoiceCloudKey } from "./VoiceCloudKey";
import { MicrophonePermissionSettings } from "./MicrophonePermissionSettings";
import { VoiceSetupRow } from "./VoiceSetupRow";
import { VoiceConversationStyle } from "./VoiceConversationStyle";
import { VoiceCompanionSettings } from "./VoiceCompanionSettings";
import { useVoiceSetup, type VoiceSetup } from "./useVoiceSetup";
import { speakerEngine, speakerOptions } from "../model/voiceSpeakers";
import type { VoiceDevice } from "../model/localVoiceClient";
import {
  loadVoiceSettings,
  saveVoiceSettings,
  useVoiceSettings,
  type DictationEngine,
  type VoiceMode,
  type VoiceSettings as Preferences,
} from "../model/voiceSettings";

type Change = (patch: Partial<Preferences>) => void;

/** The Voice assistant settings page: dictation, companion, engine, conversation style and look. */
export function VoiceSettings() {
  const locale = useLocale();
  const { snapshot: assistant } = useAssistantSnapshot();
  const settings = useVoiceSettings();
  const change: Change = (patch) => saveVoiceSettings({ ...loadVoiceSettings(), ...patch });
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
        {speechEnabled ? <VoiceSetupRow setup={setup} settings={settings} change={change} /> : null}
      </Group>
      {companion ? <VoiceEngine settings={settings} change={change} setup={setup} /> : null}
      <Group title={t("Dictation")}>
        <Row
          id="dictation-enabled"
          label={t("Enable dictation")}
          info={
            <InfoPopover label={`${t("Enable dictation")}: ${t("Help")}`}>
              {t(
                "Speak to insert text in the message box. Works independently of voice companion; nothing is sent automatically.",
              )}
            </InfoPopover>
          }
        >
          <Toggle
            label={t("Enable dictation")}
            on={settings.dictationEnabled}
            onChange={(dictationEnabled) => change({ dictationEnabled })}
          />
        </Row>
        {settings.dictationEnabled ? (
          <Row
            id="dictation-language"
            label={t("Dictation language")}
            info={
              <InfoPopover label={`${t("Dictation language")}: ${t("Help")}`}>
                {t(
                  "Automatic detects the language you speak. Choose one if dictation translates your speech.",
                )}
              </InfoPopover>
            }
          >
            <Select
              hideLabel
              label={t("Dictation language")}
              value={settings.dictationLanguage}
              options={[
                { value: "auto", label: t("Automatic") },
                ...DICTATION_LANGUAGES.map(([value, label]) => ({ value, label })),
              ]}
              onChange={(value) =>
                change({ dictationLanguage: value as Preferences["dictationLanguage"] })
              }
            />
          </Row>
        ) : null}
        {settings.dictationEnabled && (
          <AdvancedSettings
            title={
              <>
                {t("Dictation options")}{" "}
                <Badge size="xs">
                  {settings.dictationEngine === "local"
                    ? t("This computer")
                    : DICTATION_PROVIDER_NAMES[settings.dictationEngine]}
                </Badge>
              </>
            }
            settingIds={[
              "dictation-engine",
              "dictation-model",
              "voice-openrouter-key",
              "dictation-device",
            ]}
            keepMounted
          >
            {settings.dictationEnabled ? (
              <Row
                id="dictation-engine"
                label={t("Dictation recognition")}
                description={
                  settings.dictationEngine === "local"
                    ? t("Speech is recognized on this computer.")
                    : t("Dictation audio is sent to {p1}. No transcription model is installed.", {
                        p1: DICTATION_PROVIDER_NAMES[settings.dictationEngine],
                      })
                }
              >
                <Select
                  hideLabel
                  label={t("Dictation recognition")}
                  value={settings.dictationEngine}
                  options={[
                    { value: "local", label: t("This computer") },
                    // OpenAI and Grok use the Codex / Grok Build sign-in, like voice.
                    { value: "openai", label: DICTATION_PROVIDER_NAMES.openai },
                    { value: "xai", label: DICTATION_PROVIDER_NAMES.xai },
                    { value: "openrouter", label: DICTATION_PROVIDER_NAMES.openrouter },
                  ]}
                  onChange={(value) => change({ dictationEngine: value as DictationEngine })}
                />
              </Row>
            ) : null}
            {settings.dictationEnabled && settings.dictationEngine !== "local" ? (
              <Row id="dictation-model" label={t("Dictation model")}>
                <Select
                  hideLabel
                  label={t("Dictation model")}
                  value={dictationModel(
                    settings.dictationEngine,
                    settings.dictationModels[settings.dictationEngine],
                  )}
                  options={DICTATION_MODELS[settings.dictationEngine].map((model) => ({
                    value: model.id,
                    label: model.label,
                    icon: <ModelLabel model={model.id} iconOnly />,
                  }))}
                  onChange={(value) =>
                    change({
                      dictationModels: {
                        ...settings.dictationModels,
                        [settings.dictationEngine]: value,
                      },
                    })
                  }
                />
              </Row>
            ) : null}
            {settings.dictationEnabled && settings.dictationEngine === "openrouter" ? (
              <VoiceCloudKey provider="openrouter" />
            ) : null}
            {speechEnabled && !settings.enabled ? (
              <ProcessingRow
                id="dictation-device"
                setup={setup}
                value={settings.device}
                change={change}
              />
            ) : null}
          </AdvancedSettings>
        )}
      </Group>
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

function ProcessingRow({
  id,
  setup,
  value,
  change,
}: {
  id: string;
  setup: VoiceSetup;
  value: VoiceDevice;
  change: Change;
}) {
  return (
    <Row
      id={id}
      label={t("Processing")}
      info={
        <InfoPopover label={`${t("Processing")}: ${t("Help")}`}>
          {t("Automatic uses a supported NVIDIA GPU when available.")}
        </InfoPopover>
      }
      disabled={setup.installing}
    >
      <Segmented
        label={t("Processing")}
        value={value}
        options={[
          { value: "auto", label: t("Automatic") },
          { value: "gpu", label: t("GPU") },
          { value: "cpu", label: t("CPU") },
        ]}
        onChange={(next) => {
          setup.resetJob();
          change({ device: next as VoiceDevice });
        }}
      />
    </Row>
  );
}
