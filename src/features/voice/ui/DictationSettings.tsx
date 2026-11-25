import { useContext } from "react";
import { VoicePreferenceRow as Row } from "./VoicePreferenceRow";
import { t } from "../../../shared/i18n";
import { Group, RevealedSetting, Select, Toggle } from "../../../shared/ui/settings";
import { DICTATION_LANGUAGES, DICTATION_PROVIDER_NAMES } from "../model/dictationModels";
import type { DictationEngine, VoiceSettings as Preferences } from "../model/voiceSettings";
import type { VoiceSetup } from "./useVoiceSetup";
import { LocalDictationModels } from "./LocalDictationModels";
import { CLEANUP_ROW_IDS, DictationCleanupSettings } from "./DictationCleanupSettings";
import { DictationModelSettings } from "./DictationModelSettings";
import { VoiceCloudKey } from "./VoiceCloudKey";
import { DictationDictionarySettings } from "./DictationDictionarySettings";
import { VoiceSetupRow } from "./VoiceSetupRow";

/** Dictation detail rows; a settings search for one of them shows them while dictation is off. */
const DETAIL_ROW_IDS = [
  "dictation-language",
  "dictation-shortcut-mode",
  "dictation-local-models",
  "dictation-dictionary",
  "dictation-cleanup",
  ...CLEANUP_ROW_IDS,
  "dictation-silence-filter",
  "dictation-remove-fillers",
];

/** Dictation on/off, its engine and model, and every detail row while dictation is on. */
export function DictationSettings({
  settings,
  change,
  setup,
}: {
  settings: Preferences;
  change: (patch: Partial<Preferences>) => void;
  setup: VoiceSetup;
}) {
  const { speechEnabled } = setup;
  const revealed = useContext(RevealedSetting);
  // A settings search for a dictation detail shows it even while dictation is off.
  const detailRevealed =
    !!revealed && revealed !== "dictation-enabled" && DETAIL_ROW_IDS.includes(revealed);
  const showDetails = settings.dictationEnabled || detailRevealed;
  return (
    <Group title={t("Dictation")}>
      <Row id="dictation-enabled" label={t("Enable dictation")}>
        <Toggle
          label={t("Enable dictation")}
          on={settings.dictationEnabled}
          onChange={(dictationEnabled) => change({ dictationEnabled })}
        />
      </Row>
      {settings.dictationEnabled && (
        <>
          <Row
            id="dictation-engine"
            label={t("Dictation recognition")}
            description={
              settings.dictationEngine === "local"
                ? undefined
                : t("Dictation audio is sent to {p1}.", {
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
          {speechEnabled &&
          !settings.enabled &&
          !/(?:^|[/\\])gguf-/i.test(settings.dictationLocalModelPath) ? (
            <VoiceSetupRow setup={setup} settings={settings} change={change} />
          ) : null}
          <DictationModelSettings settings={settings} change={change} />
          {settings.dictationEngine === "openrouter" ? (
            <VoiceCloudKey provider="openrouter" />
          ) : null}
        </>
      )}
      {showDetails ? (
        <>
          <Row id="dictation-language" label={t("Dictation language")}>
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
          <Row id="dictation-shortcut-mode" label={t("Dictation shortcut mode")}>
            <Select
              hideLabel
              label={t("Dictation shortcut mode")}
              value={settings.dictationShortcutMode}
              options={[
                { value: "auto", label: t("Automatic") },
                { value: "hold", label: t("Hold to talk") },
                { value: "toggle", label: t("Press to toggle") },
              ]}
              onChange={(value) =>
                change({ dictationShortcutMode: value as Preferences["dictationShortcutMode"] })
              }
            />
          </Row>
          {settings.dictationEngine === "local" || revealed === "dictation-local-models" ? (
            <LocalDictationModels settings={settings} change={change} />
          ) : null}
          <DictationDictionarySettings settings={settings} change={change} />
          <DictationCleanupSettings settings={settings} change={change} />
          <Row id="dictation-silence-filter" label={t("Filter silence and background noise")}>
            <Toggle
              label={t("Filter silence and background noise")}
              on={settings.dictationSilenceFilter}
              onChange={(dictationSilenceFilter) => change({ dictationSilenceFilter })}
            />
          </Row>
          <Row id="dictation-remove-fillers" label={t("Remove filler words in dictation")}>
            <Toggle
              label={t("Remove filler words in dictation")}
              on={settings.dictationRemoveFillers}
              onChange={(dictationRemoveFillers) => change({ dictationRemoveFillers })}
            />
          </Row>
        </>
      ) : null}
    </Group>
  );
}
