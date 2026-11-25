import { surfaceAttributes } from "../../../shared/ui/Surface";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import "./ProviderDefaults.css";
import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { InfoTooltip } from "../../../shared/ui/InfoPopover";
import { Check } from "../../../shared/ui/icons";
import { isHarnessAvailable } from "../../../integrations/harness/core/availability";
import type { HarnessId } from "../../../shared/model/harnessIdentity";
import {
  CatalogReceiptStatus,
  CatalogRefreshButton,
} from "../../providers/public/CatalogReceiptStatus";
import { refreshProviderCatalog } from "../../providers/public/catalogReceipts";
import {
  catalogModelsFor,
  defaultModelId,
  isModelEnabled,
  saveModelEnabled,
  type AgentModel,
} from "../../sessions/public/models";
import { Group, Row, Toggle } from "../../../shared/ui/settings";

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
  const available = isHarnessAvailable(harness);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Load the native OpenCode catalog when its mounted panel becomes available, independently of conversations.
  useEffect(() => {
    if (harness === "opencode" && available) {
      refreshProviderCatalog(harness).catch(() => undefined);
    }
  }, [harness, available]);
  const models = catalogModelsFor(harness);
  const enabledCount = models.filter((model) => isModelEnabled(model.id)).length;
  const [query, setQuery] = useState("");
  const [freeOnly, setFreeOnly] = useState(false);
  const needle = query.trim().toLocaleLowerCase();
  const freeLabel = t("Free");
  const typedFree =
    harness === "opencode" && (needle === "free" || needle === freeLabel.toLocaleLowerCase());
  const freeModels = models.filter((model) => model.free === true);
  const filterFree = harness === "opencode" && (freeOnly || typedFree);
  const bulkModels = filterFree ? freeModels : models;
  const filtered = bulkModels.filter(
    (model) => typedFree || `${model.name} ${model.id}`.toLocaleLowerCase().includes(needle),
  );
  const defaultId = defaultModelId(harness);
  const keptModel = models.find((model) => model.id === defaultId) ?? models[0];
  const guard = t("Keep one model enabled. Hide the provider to remove it from the picker.");

  // Bulk actions keep at least one model on, the same guard each switch applies.
  const enableAll = () => {
    for (const model of bulkModels) if (!isModelEnabled(model.id)) saveModelEnabled(model.id, true);
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
          {harness === "opencode" && (freeModels.length > 0 || filterFree) ? (
            <Button
              size="sm"
              variant="ghost"
              pressed={filterFree}
              onClick={() => {
                if (typedFree) setQuery("");
                setFreeOnly(!filterFree);
              }}
            >
              {freeLabel}
            </Button>
          ) : null}
          {models.length > 1 || filterFree ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={enableAll}
              disabled={bulkModels.every((model) => isModelEnabled(model.id))}
              disabledReason={t("Every model is already enabled.")}
            >
              {filterFree ? t("Enable all free") : t("Enable all")}
            </Button>
          ) : null}
          {models.length > 1 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onlyDefault}
              disabled={enabledCount === 1 && Boolean(keptModel && isModelEnabled(keptModel.id))}
              disabledReason={t("Only the default model is enabled.")}
            >
              {t("Only default")}
            </Button>
          ) : null}
        </div>
      }
    >
      {models.length > 5 || freeModels.length > 0 || query.length > 0 ? (
        <div
          {...surfaceAttributes(
            { variant: "canvas", frame: "pane", edge: "block-end" },
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
      <div {...surfaceAttributes({ frame: "pane", edge: "block" }, "provider-models-list")}>
        {models.length === 0 ? (
          <Row label={available ? t("Loading models…") : t("Available after CLI setup")} />
        ) : filtered.length === 0 ? (
          <Row label={t("No matching models")} />
        ) : (
          filtered.map((model) => {
            const on = isModelEnabled(model.id);
            const last = on && enabledCount <= 1;
            return (
              <Row
                key={model.id}
                density="compact"
                label={
                  <span className="provider-model-name">
                    <ModelLabel model={model.id} harness={model.harness} name={model.name} />
                    {model.id === defaultId ? (
                      <InfoTooltip
                        label={t("Default")}
                        className="shrink-0"
                        icon={<Check aria-hidden className="icon-sm" />}
                      >
                        {t("Default")}
                      </InfoTooltip>
                    ) : null}
                    {model.free ? (
                      <Badge size="sm" tone="success" className="shrink-0">
                        {freeLabel}
                      </Badge>
                    ) : null}
                  </span>
                }
                description={modelMeta(model)}
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
      <div {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "provider-models-source")}>
        <CatalogReceiptStatus harness={harness} available={available} />
      </div>
    </Group>
  );
}
