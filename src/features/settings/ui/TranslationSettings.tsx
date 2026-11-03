import { lazy, Suspense, useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { HARNESSES } from "../../sessions/model/session";
import { defaultModelSettings, resolveModel } from "../../sessions/model/models";
import { canRunHarnessTextPrompt } from "../../../integrations/harness";
import {
  defaultProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";
import {
  saveDefaultTranslationChoice,
  useDefaultTranslationChoice,
  saveDefaultRepromptChoice,
  useDefaultRepromptChoice,
  defaultTextActionChoice,
  type TranslationChoice,
} from "../../sessions/model/translationPreferences";
import { Group, Row, SettingsFeedback } from "./settingsControls";

const ModelPicker = lazy(() =>
  import("../../sessions/ui/ModelPicker").then((module) => ({ default: module.ModelPicker })),
);

export function TranslationSettings({
  embedded = false,
  action = "translation",
}: {
  embedded?: boolean;
  action?: "translation" | "reprompt";
}) {
  const translationChoice = useDefaultTranslationChoice();
  const repromptChoice = useDefaultRepromptChoice();
  const reprompt = action === "reprompt";
  const choice = reprompt ? repromptChoice : translationChoice;
  const saveChoice = reprompt ? saveDefaultRepromptChoice : saveDefaultTranslationChoice;
  const selected: TranslationChoice = choice ?? defaultTextActionChoice();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [failedChoice, setFailedChoice] = useState<{
    choice: TranslationChoice | undefined;
  } | null>(null);
  const commit = (next: TranslationChoice | undefined) => {
    try {
      saveChoice(next);
      // The public writer currently swallows storage failures. Verify its exact
      // serialized receipt without treating a failed read as an inherited value.
      const raw = localStorage.getItem(
        reprompt ? "bycoda.reprompt.default.v1" : "bycoda.translation.default.v1",
      );
      if (raw !== JSON.stringify(next ?? null)) throw new Error(t("Could not save changes"));
      setSaveError(null);
      setFailedChoice(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
      setFailedChoice({ choice: next });
    }
  };
  const control = (
    <Row
      id={reprompt ? "reprompt-model-default" : "translation-model-default"}
      label={reprompt ? t("Default reprompt model") : t("Default translation model")}
      feedback={
        saveError ? (
          <SettingsFeedback
            state="error"
            action={
              failedChoice ? (
                <Button onClick={() => commit(failedChoice.choice)}>{t("Retry")}</Button>
              ) : undefined
            }
          >
            {saveError}
          </SettingsFeedback>
        ) : !canRunHarnessTextPrompt(selected.harness) ? (
          <SettingsFeedback state="warning">
            {t("Selected model does not support text actions. Choose a supported model.")}
          </SettingsFeedback>
        ) : undefined
      }
      description={t("Uses the default model from Settings until you choose one.")}
      info={
        <InfoPopover className="shrink-0">
          <p>
            {reprompt
              ? t("Used to clarify prompts across conversations.")
              : t("Used for text translations across conversations.")}
          </p>
        </InfoPopover>
      }
      modified={Boolean(choice)}
      onReset={() => commit(undefined)}
      resetLabel={t("Restore default")}
    >
      <div className="flex min-w-0 flex-nowrap items-center justify-end">
        <Suspense fallback={<span>{t("Loading…")}</span>}>
          <ModelPicker
            harness={selected.harness}
            model={selected.model}
            values={selected.modelSettings ?? {}}
            accountId={selected.providerAccountId}
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
            onSettingsChange={(modelSettings) =>
              commit({
                ...selected,
                providerAccountId:
                  choice?.providerAccountId ??
                  (supportsProviderAccounts(selected.harness)
                    ? defaultProviderAccountId(selected.harness)
                    : undefined),
                modelSettings,
              })
            }
          />
        </Suspense>
      </div>
    </Row>
  );
  return embedded ? (
    control
  ) : (
    <Group title={reprompt ? t("Reprompt") : t("Translation")} persistence={{ mode: "automatic" }}>
      {control}
    </Group>
  );
}
