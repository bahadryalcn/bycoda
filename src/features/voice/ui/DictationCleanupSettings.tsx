import { VoicePreferenceRow as Row } from "./VoicePreferenceRow";
import { t } from "../../../shared/i18n";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import { modelDisplayName } from "../../sessions/public/modelDisplayName";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { AdvancedSettings, Select, Toggle } from "../../settings/public/settingsControls";
import { useModelCatalog } from "../../sessions/public/modelHooks";
import type { VoiceSettings } from "../model/voiceSettings";

/** Optional text cleanup has its own explicit cloud opt-in, independent of audio recognition. */
export function DictationCleanupSettings({
  settings,
  change,
}: {
  settings: VoiceSettings;
  change: (patch: Partial<VoiceSettings>) => void;
}) {
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
  return (
    <>
      <Row
        id="dictation-cleanup"
        label={t("Clean up dictated text")}
        description={t(
          "Sends dictated text and your instructions to Codex for cleanup. Surrounding drafts are not sent.",
        )}
      >
        <Toggle
          label={t("Clean up dictated text")}
          on={cleanup.enabled}
          onChange={(enabled) => update({ enabled })}
        />
      </Row>
      {cleanup.enabled ? (
        <AdvancedSettings
          title={t("Text cleanup options")}
          settingIds={[
            "dictation-cleanup-model",
            "dictation-cleanup-instructions",
            "dictation-correction-cue",
            "dictation-translate",
          ]}
          keepMounted
        >
          <Row id="dictation-cleanup-model" label={t("Cleanup model")}>
            <Select
              hideLabel
              label={t("Cleanup model")}
              value={cleanup.model}
              options={options}
              onChange={(model) => update({ model })}
            />
          </Row>
          <Row id="dictation-cleanup-instructions" label={t("Cleanup instructions")} stacked>
            <TextareaField
              hideLabel
              label={t("Cleanup instructions")}
              value={cleanup.instructions}
              maxLength={4000}
              minRows={3}
              maxRows={8}
              autosize
              placeholder={t("Fix punctuation and keep my wording.")}
              onChange={(event) => update({ instructions: event.target.value })}
            />
          </Row>
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
          <Row id="dictation-translate" label={t("Translate to English")}>
            <Toggle
              label={t("Translate to English")}
              on={cleanup.translateToEnglish}
              onChange={(translateToEnglish) => update({ translateToEnglish })}
            />
          </Row>
        </AdvancedSettings>
      ) : null}
    </>
  );
}
