import { useContext } from "react";
import { Button } from "../../../shared/ui/Button";
import { RevealedSetting, settingDomId } from "../../settings/public/settingsControls";
import { VoicePreferenceRow as Row } from "./VoicePreferenceRow";
import { t, useFormat } from "../../../shared/i18n";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { AdvancedSettings, Group, Select, Toggle } from "../../settings/public/settingsControls";
import { DICTATION_LANGUAGES, DICTATION_PROVIDER_NAMES } from "../model/dictationModels";
import type { DictationEngine, VoiceSettings as Preferences } from "../model/voiceSettings";
import type { VoiceSetup } from "./useVoiceSetup";
import { LocalDictationModels } from "./LocalDictationModels";
import { DictationCleanupSettings } from "./DictationCleanupSettings";
import { DictationModelSettings } from "./DictationModelSettings";
import { VoiceCloudKey } from "./VoiceCloudKey";
import { DictationDictionarySettings } from "./DictationDictionarySettings";
import { ProcessingRow } from "./VoiceProcessingRow";

/** Recognition choices stay visible; dictionary and text options expand on demand. */
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
  const dictationTarget = revealed?.startsWith("dictation-") && revealed !== "dictation-enabled";
  const localTarget = revealed === "dictation-local-models" || revealed === "dictation-idle-unload";
  const cleanupTarget =
    revealed &&
    [
      "dictation-cleanup-model",
      "dictation-cleanup-instructions",
      "dictation-correction-cue",
      "dictation-translate",
    ].includes(revealed);
  const prerequisite =
    dictationTarget && !settings.dictationEnabled
      ? "dictation-enabled"
      : localTarget && settings.dictationEngine !== "local"
        ? "dictation-engine"
        : cleanupTarget && !settings.dictationCleanup.enabled
          ? "dictation-cleanup"
          : null;
  const focusPrerequisite = () =>
    document
      .getElementById(settingDomId(prerequisite!))
      ?.querySelector<HTMLElement>('[role="switch"], button[aria-haspopup="listbox"], input')
      ?.focus();
  const { formatNumber } = useFormat();
  return (
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
      {prerequisite && revealed ? (
        <Row
          id={revealed}
          label={t("Dictation setting unavailable")}
          description={
            prerequisite === "dictation-enabled"
              ? t("Enable dictation to use this setting. This does not start recording.")
              : prerequisite === "dictation-engine"
                ? t("Choose This computer in Dictation recognition to manage local models.")
                : t("Enable text cleanup to use this setting.")
          }
        >
          <Button variant="link" onClick={focusPrerequisite}>
            {prerequisite === "dictation-enabled"
              ? t("Go to Enable dictation")
              : prerequisite === "dictation-engine"
                ? t("Go to Dictation recognition")
                : t("Go to Clean up dictated text")}
          </Button>
        </Row>
      ) : null}
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
        <>
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
          {settings.dictationEngine === "local" ? (
            <LocalDictationModels settings={settings} change={change} />
          ) : (
            <DictationModelSettings settings={settings} change={change} />
          )}
          {settings.dictationEnabled && settings.dictationEngine === "openrouter" ? (
            <VoiceCloudKey provider="openrouter" />
          ) : null}
          <Row
            id="dictation-shortcut-mode"
            label={t("Dictation shortcut mode")}
            description={t(
              "Automatic supports a quick press to toggle and a longer press to hold.",
            )}
          >
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
          <DictationDictionarySettings settings={settings} change={change} />
          <DictationCleanupSettings settings={settings} change={change} />
          <AdvancedSettings
            title={t("Dictation options")}
            settingIds={[
              "dictation-remove-fillers",
              "dictation-silence-filter",
              "dictation-device",
              "dictation-idle-unload",
            ]}
            keepMounted
          >
            {settings.dictationEngine === "local" ? (
              <Row
                id="dictation-idle-unload"
                label={t("Unload idle model")}
                description={t(
                  "Release the local dictation model from memory after dictation stops.",
                )}
              >
                <Select
                  hideLabel
                  label={t("Unload idle model")}
                  value={String(settings.dictationIdleUnloadMinutes)}
                  options={[
                    { value: "0", label: t("Immediately") },
                    ...[1, 5, 15, 30, 60, 120].map((minutes) => ({
                      value: String(minutes),
                      label:
                        minutes === 1
                          ? t("After 1 minute")
                          : t("After {p1} minutes", { p1: formatNumber(minutes) }),
                    })),
                    ...(![0, 1, 5, 15, 30, 60, 120].includes(settings.dictationIdleUnloadMinutes)
                      ? [
                          {
                            value: String(settings.dictationIdleUnloadMinutes),
                            label: t("After {p1} minutes", {
                              p1: formatNumber(settings.dictationIdleUnloadMinutes),
                            }),
                          },
                        ]
                      : []),
                  ]}
                  onChange={(value) => change({ dictationIdleUnloadMinutes: Number(value) })}
                />
              </Row>
            ) : null}
            {speechEnabled && !settings.enabled ? (
              <ProcessingRow
                id="dictation-device"
                setup={setup}
                value={settings.device}
                change={change}
              />
            ) : null}
            <Row
              id="dictation-silence-filter"
              label={t("Filter silence and background noise")}
              description={t("Only transcribe chunks that contain detected speech.")}
            >
              <Toggle
                label={t("Filter silence and background noise")}
                on={settings.dictationSilenceFilter}
                onChange={(dictationSilenceFilter) => change({ dictationSilenceFilter })}
              />
            </Row>
            <Row
              id="dictation-remove-fillers"
              label={t("Remove filler words")}
              description={t("Remove hesitation sounds such as um and uh from dictated text.")}
            >
              <Toggle
                label={t("Remove filler words")}
                on={settings.dictationRemoveFillers}
                onChange={(dictationRemoveFillers) => change({ dictationRemoveFillers })}
              />
            </Row>
          </AdvancedSettings>
        </>
      )}
    </Group>
  );
}
