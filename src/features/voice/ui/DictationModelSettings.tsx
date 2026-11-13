import { VoicePreferenceRow as Row } from "./VoicePreferenceRow";
import { t } from "../../../shared/i18n";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import { modelDisplayName } from "../../sessions/public/modelDisplayName";
import { Select } from "../../settings/public/settingsControls";
import { DICTATION_MODELS, dictationModel } from "../model/dictationModels";
import { useTranscriptionModels } from "../hooks/useTranscriptionModels";
import type { VoiceSettings } from "../model/voiceSettings";

/** Cloud transcription choices. Discovery failures remain visible without changing the saved choice. */
export function DictationModelSettings({
  settings,
  change,
}: {
  settings: VoiceSettings;
  change: (patch: Partial<VoiceSettings>) => void;
}) {
  const engine = settings.dictationEngine;
  const catalog = useTranscriptionModels(engine === "openrouter");
  const models = catalog.data;
  const pending = catalog.isFetching;
  const error = catalog.isError;
  if (engine === "local") return null;
  const available = engine === "openrouter" ? (models ?? []) : DICTATION_MODELS[engine];
  const chosen = settings.dictationModels[engine];
  const value =
    chosen ?? (engine === "openrouter" ? (available[0]?.id ?? "") : dictationModel(engine, chosen));
  const options = [
    ...available.map((model) => ({
      value: model.id,
      label: model.label,
      icon: <ModelLabel model={model.id} iconOnly />,
    })),
    ...(chosen && !available.some((model) => model.id === chosen)
      ? [
          {
            value: chosen,
            label: modelDisplayName(chosen),
            icon: <ModelLabel model={chosen} iconOnly />,
            disabled: true,
          },
        ]
      : []),
  ];
  return (
    <Row id="dictation-model" label={t("Dictation model")}>
      <div className="flex min-w-0 flex-col gap-2">
        <Select
          hideLabel
          label={t("Dictation model")}
          value={value}
          options={options}
          disabled={engine === "openrouter" && (pending || error || !models)}
          onChange={(next) =>
            change({ dictationModels: { ...settings.dictationModels, [engine]: next } })
          }
        />
        {engine === "openrouter" && pending ? (
          <LoadingText>{t("Loading transcription models…")}</LoadingText>
        ) : null}
        {engine === "openrouter" && error ? (
          <InlineError
            retry={{
              onRetry: () => {
                void catalog.refetch();
              },
            }}
          >
            {t("Could not load transcription models. Retry to refresh the catalog.")}
          </InlineError>
        ) : null}
        {engine === "openrouter" &&
        models &&
        !pending &&
        !error &&
        chosen &&
        !models.some((model) => model.id === chosen) ? (
          <InlineError>
            {t("Saved transcription model is unavailable. Choose an available model.")}
          </InlineError>
        ) : null}
      </div>
    </Row>
  );
}
