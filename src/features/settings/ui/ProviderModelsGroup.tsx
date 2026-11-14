import { surfaceAttributes } from "../../../shared/ui/Surface";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import "./ProviderDefaults.css";
import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { isHarnessAvailable } from "../../../integrations/harness/core/availability";
import type { HarnessId } from "../../../shared/model/harnessIdentity";
import {
  CatalogReceiptStatus,
  CatalogRefreshButton,
} from "../../providers/public/CatalogReceiptStatus";
import {
  catalogModelsFor,
  defaultModelId,
  isModelEnabled,
  saveModelEnabled,
  type AgentModel,
} from "../../sessions/public/models";
import { Group, Row, Toggle } from "./settingsControls";

/** "200K context", with the upstream provider first for multi-provider harnesses. */
function modelMeta(model: AgentModel): string | undefined {
  const size = model.contextWindow;
  const context =
    size == null
      ? undefined
      : t("{p0} context", {
          p0:
            size >= 1_000_000
              ? `${+(size / 1_000_000).toFixed(1)}M`
              : `${Math.round(size / 1000)}K`,
        });
  const parts = [model.provider?.name, context].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** Per-model switches: a model turned off is never offered or picked by default. Saves at once. */
export function ProviderModelsGroup({ harness }: { harness: HarnessId }) {
  useLocale();
  const models = catalogModelsFor(harness);
  const enabledCount = models.filter((model) => isModelEnabled(model.id)).length;
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const filtered = models.filter((model) =>
    `${model.name} ${model.id}`.toLocaleLowerCase().includes(needle),
  );
  const defaultId = defaultModelId(harness);
  const keptModel = models.find((model) => model.id === defaultId) ?? models[0];
  const guard = t("Keep one model enabled. Hide the provider to remove it from the picker.");

  // Bulk actions keep at least one model on, the same guard each switch applies.
  const enableAll = () => {
    for (const model of models) if (!isModelEnabled(model.id)) saveModelEnabled(model.id, true);
  };
  const onlyDefault = () => {
    if (!keptModel) return;
    saveModelEnabled(keptModel.id, true);
    for (const model of models) {
      if (model.id !== keptModel.id && isModelEnabled(model.id)) saveModelEnabled(model.id, false);
    }
  };

  return (
    <Group
      id="enabled-models"
      layout="full"
      title={
        <span className="provider-cli-model-heading">
          {t("Models")}{" "}
          <Badge size="sm">
            {enabledCount} / {models.length}
          </Badge>
        </span>
      }
      description={t("Models turned off stay out of every model picker. Changes save at once.")}
      dependency={models.length > 0 && enabledCount <= 1 ? guard : undefined}
      action={
        <div className="provider-models-actions">
          <CatalogRefreshButton harness={harness} />
          {models.length > 1 ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={enableAll}
                disabled={enabledCount === models.length}
              >
                {t("Enable all")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onlyDefault}
                disabled={enabledCount === 1 && Boolean(keptModel && isModelEnabled(keptModel.id))}
              >
                {t("Only default")}
              </Button>
            </>
          ) : null}
        </div>
      }
    >
      {models.length > 5 || query.length > 0 ? (
        <div
          {...surfaceAttributes(
            { variant: "base", frame: "settings", edge: "block-end" },
            "provider-models-search",
          )}
        >
          <SearchInput
            aria-label={t("Search models…")}
            appearance="field"
            placeholder={t("Search models…")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      ) : null}
      <div {...surfaceAttributes({ frame: "settings", edge: "block" }, "provider-models-list")}>
        {models.length === 0 ? (
          <Row
            label={
              isHarnessAvailable(harness) ? t("Loading models…") : t("Available after CLI setup")
            }
          />
        ) : filtered.length === 0 ? (
          <Row label={t("No matching models")} />
        ) : (
          filtered.map((model) => {
            const on = isModelEnabled(model.id);
            const last = on && enabledCount <= 1;
            return (
              <Row
                key={model.id}
                label={
                  <span className="provider-model-name">
                    <ModelLabel model={model.id} harness={model.harness} name={model.name} />
                    {model.id === defaultId ? (
                      <Badge size="sm" className="shrink-0">
                        {t("Default")}
                      </Badge>
                    ) : null}
                  </span>
                }
                description={modelMeta(model)}
                descriptionVisible={false}
                disabled={last}
                disabledReason={guard}
              >
                <Toggle
                  label={t("Use {p0}", { p0: model.name })}
                  on={on}
                  onChange={(next) => saveModelEnabled(model.id, next)}
                  // The last model stays on so the provider keeps a default.
                  disabled={last}
                />
              </Row>
            );
          })
        )}
      </div>
      <div
        {...surfaceAttributes({ frame: "settings", edge: "block-start" }, "provider-models-source")}
      >
        <CatalogReceiptStatus harness={harness} available={isHarnessAvailable(harness)} />
      </div>
    </Group>
  );
}
