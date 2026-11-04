import { lazy, Suspense, useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { canRunHarnessTextPrompt } from "../../../integrations/harness";
import {
  defaultProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";
import { HARNESSES } from "../../sessions/model/session";
import { defaultModelSettings, resolveModel } from "../../sessions/model/models";
import { defaultTextActionChoice } from "../../sessions/model/translationPreferences";
import {
  defaultTitleChoice,
  saveDefaultTitleChoice,
  useDefaultTitleChoice,
  type TitleGenerationChoice,
} from "../../sessions/model/titlePreferences";
import { Group, Row, Segmented, SettingsFeedback } from "./settingsControls";

const ModelPicker = lazy(() =>
  import("../../sessions/ui/ModelPicker").then((module) => ({ default: module.ModelPicker })),
);

export function TitleGenerationSettings() {
  const choice = useDefaultTitleChoice();
  const [failure, setFailure] = useState<{ choice: TitleGenerationChoice | undefined } | null>(
    null,
  );
  const commit = (next: TitleGenerationChoice | undefined) => {
    try {
      saveDefaultTitleChoice(next);
      setFailure(null);
    } catch {
      setFailure({ choice: next });
    }
  };
  return (
    <Group title={t("Conversation titles")} layout="full" persistence={{ mode: "automatic" }}>
      <Row
        id="title-model-default"
        label={t("Default title model")}
        description={t(
          "Regenerate titles with your chosen model. Automatic uses Haiku, Terra or Flash from the conversation provider when available.",
        )}
        modified={Boolean(choice)}
        onReset={() => commit(undefined)}
        resetLabel={t("Restore default")}
        feedback={
          failure ? (
            <SettingsFeedback
              state="error"
              action={<Button onClick={() => commit(failure.choice)}>{t("Retry")}</Button>}
            >
              {t("Could not save changes")}
            </SettingsFeedback>
          ) : choice && !canRunHarnessTextPrompt(choice.harness) ? (
            <SettingsFeedback state="warning">
              {t("Selected model does not support text actions. Choose a supported model.")}
            </SettingsFeedback>
          ) : undefined
        }
      >
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <Segmented
            label={t("Default title model")}
            value={choice ? "custom" : "automatic"}
            options={[
              { value: "automatic", label: t("Automatic") },
              { value: "custom", label: t("Choose model") },
            ]}
            onChange={(value) =>
              commit(
                value === "automatic"
                  ? undefined
                  : (defaultTitleChoice() ?? defaultTextActionChoice()),
              )
            }
          />
          {choice ? (
            <Suspense fallback={<span>{t("Loading…")}</span>}>
              <ModelPicker
                harness={choice.harness}
                model={choice.model}
                values={choice.modelSettings ?? {}}
                accountId={choice.providerAccountId}
                accountChoices
                allowedHarnesses={HARNESSES.filter(canRunHarnessTextPrompt)}
                onChange={(harness, model, accountId) =>
                  commit({
                    harness,
                    model,
                    modelSettings: defaultModelSettings(resolveModel(harness, model)),
                    providerAccountId: supportsProviderAccounts(harness)
                      ? (accountId ?? defaultProviderAccountId(harness))
                      : undefined,
                  })
                }
                onSettingsChange={(modelSettings) => commit({ ...choice, modelSettings })}
              />
            </Suspense>
          ) : null}
        </div>
      </Row>
    </Group>
  );
}
