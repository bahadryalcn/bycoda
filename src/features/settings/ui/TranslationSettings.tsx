import { lazy, Suspense } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { HARNESSES } from "../../sessions/model/session";
import {
  defaultSessionChoice,
  defaultModelSettings,
  resolveModel,
} from "../../sessions/model/models";
import { canRunHarnessTextPrompt } from "../../../integrations/harness";
import {
  defaultProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";
import {
  saveDefaultTranslationChoice,
  useDefaultTranslationChoice,
  type TranslationChoice,
} from "../../sessions/model/translationPreferences";
import { Group, Row } from "./settingsControls";

const ModelPicker = lazy(() =>
  import("../../sessions/ui/ModelPicker").then((module) => ({ default: module.ModelPicker })),
);

export function TranslationSettings() {
  const choice = useDefaultTranslationChoice();
  const selected: TranslationChoice = choice ?? defaultSessionChoice();
  return (
    <Group title={t("Translation")} persistence={{ mode: "automatic" }}>
      <Row
        id="translation-model-default"
        label={t("Default translation model")}
        description={t(
          "Used for text translations across conversations. Without a selection, uses the conversation model.",
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {!choice && (
            <span className="text-[var(--ui-text-secondary)]">{t("Use conversation model")}</span>
          )}
          <Suspense fallback={<span>{t("Loading…")}</span>}>
            <ModelPicker
              harness={selected.harness}
              model={selected.model}
              values={selected.modelSettings ?? {}}
              accountId={choice?.providerAccountId}
              accountChoices
              allowedHarnesses={HARNESSES.filter(canRunHarnessTextPrompt)}
              onChange={(harness, model, accountId) =>
                saveDefaultTranslationChoice({
                  harness,
                  model,
                  modelSettings: defaultModelSettings(resolveModel(harness, model)),
                  providerAccountId: supportsProviderAccounts(harness)
                    ? (accountId ?? defaultProviderAccountId(harness))
                    : undefined,
                })
              }
              onSettingsChange={(modelSettings) =>
                saveDefaultTranslationChoice({
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
            <Button variant="link" onClick={() => saveDefaultTranslationChoice(undefined)}>
              {t("Use conversation model")}
            </Button>
          )}
        </div>
      </Row>
    </Group>
  );
}
