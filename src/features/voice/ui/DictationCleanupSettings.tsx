import { useContext } from "react";
import { VoicePreferenceRow as Row } from "./VoicePreferenceRow";
import { t } from "../../../shared/i18n";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import { modelDisplayName } from "../../sessions/public/modelDisplayName";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Group, RevealedSetting, Select, Toggle } from "../../../shared/ui/settings";
import { useModelCatalog } from "../../sessions/public/modelHooks";
import { loadVoiceSettings, type VoiceSettings } from "../model/voiceSettings";
import { DictationSettingsSuggestion } from "./DictationSettingsSuggestion";

/** Rows under the cleanup switch; Settings opens "More options" for any of them. */
export const CLEANUP_ROW_IDS = [
  "dictation-cleanup-model",
  "dictation-cleanup-instructions",
  "dictation-cleanup-suggest",
  "dictation-correction-cue",
  "dictation-translate",
];

/** The "Text cleanup" group: optional text cleanup has its own explicit cloud opt-in, independent of audio recognition. */
export function DictationCleanupSettings({
  settings,
  change,
}: {
  settings: VoiceSettings;
  change: (patch: Partial<VoiceSettings>) => void;
}) {
  const revealed = useContext(RevealedSetting);
  // A search result for a cleanup detail shows its row even while cleanup is off.
  const cleanupRevealed = !!revealed && CLEANUP_ROW_IDS.includes(revealed);
  const catalog = useModelCatalog("codex");
  const cleanup = settings.dictationCleanup;
  const update = (patch: Partial<VoiceSettings["dictationCleanup"]>) =>
    change({ dictationCleanup: { ...cleanup, ...patch } });
  const models = catalog.modelsFor("codex");
  const options = [
    { value: "", label: t("Codex default"), icon: <ModelLabel model="codex" iconOnly /> },
    ...models.map((model) => ({
      value: model.nativeId ?? model.id,
      label: model.name,
      icon: <ModelLabel model={model.id} iconOnly />,
    })),
    ...(cleanup.model && !models.some((model) => (model.nativeId ?? model.id) === cleanup.model)
      ? [
          {
            value: cleanup.model,
            label: modelDisplayName(cleanup.model, "codex"),
            icon: <ModelLabel model={cleanup.model} iconOnly />,
          },
        ]
      : []),
  ];
  const detailsShown = cleanup.enabled || cleanupRevealed;
  return (
    <Group title={t("Text cleanup")}>
      <Row
        id="dictation-cleanup"
        label={t("Clean up text with Codex")}
        description={t(
          "Sends dictated text and your instructions to Codex for cleanup. Surrounding drafts are not sent.",
        )}
        modified={cleanup.enabled}
        onReset={() => update({ enabled: false })}
      >
        <Toggle
          label={t("Clean up text with Codex")}
          on={cleanup.enabled}
          onChange={(enabled) => update({ enabled })}
        />
      </Row>
      {detailsShown ? (
        <>
          <Row id="dictation-cleanup-model" label={t("Model")}>
            <Select
              hideLabel
              label={t("Model")}
              value={cleanup.model}
              options={options}
              onChange={(model) => update({ model })}
            />
          </Row>
          <Row id="dictation-cleanup-instructions" label={t("Instructions")} stacked>
            <TextareaField
              hideLabel
              label={t("Instructions")}
              value={cleanup.instructions}
              maxLength={4000}
              minRows={3}
              maxRows={8}
              autosize
              placeholder={t("Fix punctuation and keep my wording.")}
              onChange={(event) => update({ instructions: event.target.value })}
            />
          </Row>
          <DictationSettingsSuggestion
            settings={settings}
            apply={(patch) => {
              change({
                dictationCleanup: {
                  ...loadVoiceSettings().dictationCleanup,
                  ...patch,
                },
              });
              const saved = loadVoiceSettings().dictationCleanup;
              return (
                saved.instructions === patch.instructions &&
                saved.correctionCue === patch.correctionCue
              );
            }}
          />
          <Row
            id="dictation-correction-cue"
            label={t("Correction phrase")}
            description={t("Optional spoken phrase that marks a correction, such as scratch that.")}
            stacked
          >
            <TextField
              hideLabel
              label={t("Correction phrase")}
              value={cleanup.correctionCue}
              maxLength={100}
              onChange={(event) => update({ correctionCue: event.target.value })}
            />
          </Row>
          <Row
            id="dictation-translate"
            label={t("Translate to English")}
            modified={cleanup.translateToEnglish}
            onReset={() => update({ translateToEnglish: false })}
          >
            <Toggle
              label={t("Translate to English")}
              on={cleanup.translateToEnglish}
              onChange={(translateToEnglish) => update({ translateToEnglish })}
            />
          </Row>
        </>
      ) : null}
    </Group>
  );
}
