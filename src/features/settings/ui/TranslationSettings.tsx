import { lazy, Suspense } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
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
import { Group, Row } from "./settingsControls";

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
  const control = (
    <Row
      id={reprompt ? "reprompt-model-default" : "translation-model-default"}
      label={reprompt ? t("Default reprompt model") : t("Default translation model")}
      description={
        reprompt
          ? t(
              "Used to clarify prompts across conversations. Without a selection, uses the default model from Settings.",
            )
          : t(
              "Used for text translations across conversations. Without a selection, uses the default model from Settings.",
            )
      }
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {!choice && (
          <span className="text-[var(--ui-text-secondary)]">{t("Use default model")}</span>
        )}
        <Suspense fallback={<span>{t("Loading…")}</span>}>
          <ModelPicker
            harness={selected.harness}
            model={selected.model}
            values={selected.modelSettings ?? {}}
            accountId={selected.providerAccountId}
            accountChoices
            allowedHarnesses={HARNESSES.filter(canRunHarnessTextPrompt)}
            onChange={(harness, model, accountId) =>
              saveChoice({
                harness,
                model,
                modelSettings: defaultModelSettings(resolveModel(harness, model)),
                providerAccountId: supportsProviderAccounts(harness)
                  ? (accountId ?? defaultProviderAccountId(harness))
                  : undefined,
              })
            }
            onSettingsChange={(modelSettings) =>
              saveChoice({
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
        {choice && (
          <Button variant="link" onClick={() => saveChoice(undefined)}>
            {t("Use default model")}
          </Button>
        )}
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
