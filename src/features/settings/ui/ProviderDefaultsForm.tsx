import {
  CROSS_SUBAGENTS_KEY,
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENT_MAX_EFFORT_KEY,
} from "../../../shared/model/host-contracts/delegation";
import { IMAGE_MODELS_KEY } from "../../../shared/model/host-contracts/image-models";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import { EffortScale } from "../../../shared/ui/EffortScale";
import { RUNTIME_MODE_ICONS } from "../../sessions/public/runtimeModeOptions";
import { WandSparkles } from "../../../shared/ui/icons";
import { missingProviderWideSettings, providerWideSetting } from "../model/providerWideSetting";
import { Text } from "../../../shared/ui/Text";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { isHarnessAvailable } from "../../../integrations/harness/core/availability";
import { HARNESS_TITLE, type HarnessId } from "../../../shared/model/harnessIdentity";
import { refreshProviderCatalog } from "../../providers/public/catalogReceipts";
import {
  defaultProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/public/providerAccounts";
import { getAllRateLimits, subscribeRateLimits } from "../../providers/public/rateLimitsCache";
import { HARNESSES } from "../../sessions";
import { offeredDelegationSetting } from "../../sessions/public/claudeAdvisor";
import {
  ascendingEffortOptions,
  menuSettings,
  signedOutAccountKeys,
} from "../../sessions/public/modelPickerData";
import {
  defaultModelId,
  hasLiveCatalog,
  isEnabledChoice,
  modelEffortSetting,
  modelsFor,
  resolveModel,
  type AgentModel,
  type ModelSetting,
} from "../../sessions/public/models";
import type { ProviderSessionDefaults } from "../../sessions/public/projectProviders";
import { mergeProviderExtras } from "../../sessions/public/providerSessionDefaults";
import {
  RUNTIME_MODES,
  runtimeModeUnavailableReason,
  type RuntimeMode,
} from "../../sessions/public/session";
import { modelSettingText } from "../model/modelSettingText";
import { ProviderDefaultExtras, inheritedChoiceLabel } from "./ProviderDefaultExtras";
import { Group, Row, Select, Toggle } from "../../../shared/ui/settings";

/**
 * Rows that choose the advisor, image models, subagents and their limit, shown together in this
 * order: the single helpers first, then the subagent rows.
 */
const DELEGATION_ORDER: readonly string[] = [
  CROSS_ADVISOR_KEY,
  IMAGE_MODELS_KEY,
  CROSS_SUBAGENTS_KEY,
  CROSS_SUBAGENT_MAX_EFFORT_KEY,
];
const isDelegationSetting = (setting: { id: string }) => DELEGATION_ORDER.includes(setting.id);
const delegationRows = (settings: readonly ModelSetting[]) =>
  settings
    .filter(isDelegationSetting)
    .sort((a, b) => DELEGATION_ORDER.indexOf(a.id) - DELEGATION_ORDER.indexOf(b.id));

function modelDisplayName(harness: HarnessId, id: string | undefined): string {
  if (!id) return t("Automatic");
  return resolveModel(harness, id).name;
}

/**
 * One provider's new-conversation defaults. Every change is reported to the page, which keeps
 * it as a pending change until Save; nothing here writes storage.
 */
/** The permission-mode names, one literal per mode. */
function runtimeModeLabelMap(): Record<RuntimeMode, string> {
  return {
    supervised: t("Supervised"),
    "auto-accept-edits": t("Auto-accept edits"),
    auto: t("Auto"),
    "full-access": t("Full access"),
  };
}

export function ProviderDefaultsForm({
  harness,
  selectedModel,
  inheritedDefaults,
  scopeDefaults = {},
  onSessionDefaultsChange,
  inherits = false,
  modelOverride,
  globalModel,
  onModelChange,
  onModelReset,
  accountId,
  projectAccountId,
  scopeControl,
  picker,
  section,
  providerControl,
  helpers,
}: {
  section?: "chat" | "delegation";
  providerControl?: ReactNode;
  /**
   * Global target: the helper rows (advisor, image models, subagents, their effort ceiling) edit
   * the All providers layer or this provider's own values, chosen by `control`.
   */
  helpers?: {
    control: ReactNode;
    scopeDefaults: ProviderSessionDefaults;
    inheritedDefaults: ProviderSessionDefaults;
    onChange: (next: ProviderSessionDefaults) => void;
    resetLabel: string;
  };
  harness: HarnessId;
  selectedModel: string;
  inheritedDefaults?: ProviderSessionDefaults;
  scopeDefaults?: ProviderSessionDefaults;
  onSessionDefaultsChange: (next: ProviderSessionDefaults) => void;
  /** Project, group or account target: unset fields follow Global. */
  inherits?: boolean;
  /** The model this target stores for the provider, if any. */
  modelOverride?: string;
  /** The global model the provider falls back to. */
  globalModel?: string;
  onModelChange: (model: string) => void;
  /** Drop the override and follow the global model again. */
  onModelReset?: () => void;
  /** Account scope: the account whose own defaults these rows edit. */
  accountId?: string;
  /** Project and group targets: the account their chats start on, for account-bound options. */
  projectAccountId?: string;
  /** Picks which account's defaults the rows below edit. */
  scopeControl?: ReactNode;
  /** Project and group targets: keep the provider out of their picker. */
  picker?: {
    inPicker: boolean;
    locked: boolean;
    onChange: (visible: boolean) => void;
  };
}) {
  useLocale();
  const runtimeModeLabels = runtimeModeLabelMap();
  const delegationUsage = useSyncExternalStore(
    subscribeRateLimits,
    getAllRateLimits,
    getAllRateLimits,
  );
  const models = modelsFor(harness);
  const available = isHarnessAvailable(harness);
  const current =
    models.length > 0
      ? resolveModel(
          harness,
          isEnabledChoice(harness, selectedModel) ? selectedModel : defaultModelId(harness),
        )
      : null;
  const effort = current ? modelEffortSetting(current) : undefined;
  const validEffort = effort?.options.some((option) => option.value === scopeDefaults.effort);
  const validInheritedEffort = effort?.options.some(
    (option) => option.value === inheritedDefaults?.effort,
  );
  const inheritedRuntimeMode = inheritedDefaults?.runtimeMode;
  const validInheritedRuntimeMode =
    inheritedRuntimeMode != null && !runtimeModeUnavailableReason(harness, inheritedRuntimeMode);
  // Other model controls can also get defaults for new conversations.
  const extrasFor = (model: AgentModel): ModelSetting[] =>
    menuSettings({
      current: model,
      harnesses: HARNESSES.filter(isHarnessAvailable),
      source: { modelsFor },
      accountChoices: true,
      currentAccountId: supportsProviderAccounts(harness)
        ? (accountId ?? projectAccountId ?? defaultProviderAccountId(harness))
        : undefined,
      signedOutAccounts: signedOutAccountKeys(delegationUsage),
      signedOutLabel: t("Not signed in"),
      values: {
        ...mergeProviderExtras(harness, inheritedDefaults?.extras, scopeDefaults.extras),
        ...(helpers
          ? mergeProviderExtras(
              harness,
              helpers.inheritedDefaults.extras,
              helpers.scopeDefaults.extras,
            )
          : {}),
      },
      unavailable: (name) => t("Unavailable: {p0}", { p0: name }),
    });
  const extras = current
    ? (() => {
        const own = extrasFor(current);
        return [...own, ...missingProviderWideSettings(own, models, extrasFor)]
          .filter((setting) => setting.id !== effort?.id)
          .map((setting) =>
            providerWideSetting(
              offeredDelegationSetting(
                setting,
                models,
                scopeDefaults.extras?.[setting.id] ?? inheritedDefaults?.extras?.[setting.id],
                current,
              ),
              models,
            ),
          );
      })()
    : [];
  // Inheritance is shown per row: a row that holds its own value offers a way back.
  // A project inherits from All projects; an account inherits from the provider's own defaults.
  const inheritLabel = accountId ? t("Use Bycoda defaults") : t("Use the All projects value");
  const resetLabel = inherits ? inheritLabel : t("Reset to automatic");

  useEffect(() => {
    if (!available || hasLiveCatalog(harness)) return;
    refreshProviderCatalog(harness).catch(() => undefined);
  }, [available, harness]);

  // The helper rows edit their own layer when the page offers one, else this target's values.
  const helperRows = {
    harness,
    inheritedDefaults: helpers ? helpers.inheritedDefaults : inheritedDefaults,
    scopeDefaults: helpers ? helpers.scopeDefaults : scopeDefaults,
    onSessionDefaultsChange: helpers ? helpers.onChange : onSessionDefaultsChange,
    resetLabel: helpers ? helpers.resetLabel : resetLabel,
  };
  const effortOptions = effort
    ? ascendingEffortOptions(effort.options).map((option) => ({
        value: option.value,
        label: modelSettingText(option.label),
      }))
    : [];
  // Automatic (nothing saved) runs the level above: the inherited default, else the model's own.
  const automaticEffort = validInheritedEffort ? inheritedDefaults?.effort : effort?.value;
  const unavailableEffort = scopeDefaults.effort && !validEffort ? scopeDefaults.effort : undefined;
  const main = (
    <Group
      id={section === "delegation" ? "models-delegation" : "agent-clis"}
      layout="full"
      title={section === "delegation" ? null : t("New conversation defaults")}
    >
      {providerControl}
      {scopeControl}
      {section !== "delegation" ? (
        <>
          {picker && available ? (
            <Row label={picker.locked ? t("Hidden globally") : t("Show in picker")}>
              <Toggle
                label={t("Show {p0} in the project model picker", { p0: HARNESS_TITLE[harness] })}
                on={picker.inPicker}
                onChange={picker.onChange}
                disabled={picker.locked}
              />
            </Row>
          ) : null}
          {current ? (
            <Row
              controlWidth="wide"
              label={t("Model")}
              modified={inherits && Boolean(modelOverride)}
              onReset={onModelReset}
              resetLabel={inheritLabel}
            >
              <SearchableSelect
                hideLabel
                label={t("{p0} model", { p0: HARNESS_TITLE[harness] })}
                triggerProps={{
                  onClick: (event) => {
                    if (event.currentTarget.getAttribute("aria-expanded") !== "true")
                      refreshProviderCatalog(harness, { force: true }).catch(() => undefined);
                  },
                }}
                value={current.id}
                onChange={onModelChange}
                options={models.map((item) => ({
                  value: item.id,
                  label: item.name,
                  keywords: item.id,
                  description:
                    inherits && item.id === current.id && modelOverride
                      ? t("Bycoda default ({p0})", { p0: modelDisplayName(harness, globalModel) })
                      : undefined,
                  icon: <ModelLabel model={item.id} harness={harness} iconOnly />,
                }))}
              />
            </Row>
          ) : (
            <Row label={t("Model")}>
              <Text size="caption" tone="muted">
                {available ? t("Loading models…") : t("Available after CLI setup")}
              </Text>
            </Row>
          )}
          {effort ? (
            <Row
              controlWidth="wide"
              label={t("Effort")}
              description={
                unavailableEffort
                  ? t("Saved level {p0} is unavailable for this model.", { p0: unavailableEffort })
                  : undefined
              }
              descriptionVisible={Boolean(unavailableEffort)}
              modified={Boolean(scopeDefaults.effort)}
              onReset={() => onSessionDefaultsChange({ ...scopeDefaults, effort: undefined })}
              resetLabel={resetLabel}
            >
              <div className="provider-effort">
                <EffortScale
                  label={t("{p0} default effort", { p0: HARNESS_TITLE[harness] })}
                  showLabel={false}
                  value={validEffort ? scopeDefaults.effort! : ""}
                  inheritedValue={automaticEffort}
                  automatic={{
                    on: !scopeDefaults.effort,
                    onChange: (on) => {
                      if (on) onSessionDefaultsChange({ ...scopeDefaults, effort: undefined });
                    },
                  }}
                  options={effortOptions}
                  onValueChange={(next) =>
                    onSessionDefaultsChange({ ...scopeDefaults, effort: next || undefined })
                  }
                />
              </div>
            </Row>
          ) : null}
          <Row
            controlWidth="wide"
            label={t("Permissions")}
            modified={Boolean(scopeDefaults.runtimeMode)}
            onReset={() => onSessionDefaultsChange({ ...scopeDefaults, runtimeMode: undefined })}
            resetLabel={resetLabel}
          >
            <Select
              hideLabel
              label={t("{p0} default permissions", { p0: HARNESS_TITLE[harness] })}
              value={scopeDefaults.runtimeMode ?? ""}
              options={[
                {
                  value: "",
                  label: inheritedChoiceLabel(
                    inheritedRuntimeMode ? runtimeModeLabels[inheritedRuntimeMode] : undefined,
                    validInheritedRuntimeMode,
                  ),
                  icon: <WandSparkles className="icon-sm" />,
                },
                ...(scopeDefaults.runtimeMode &&
                runtimeModeUnavailableReason(harness, scopeDefaults.runtimeMode)
                  ? [
                      {
                        value: scopeDefaults.runtimeMode,
                        label: `${runtimeModeLabels[scopeDefaults.runtimeMode]} (${t("Unavailable")})`,
                      },
                    ]
                  : []),
                ...RUNTIME_MODES.filter((mode) => !runtimeModeUnavailableReason(harness, mode)).map(
                  (mode) => {
                    const Icon = RUNTIME_MODE_ICONS[mode];
                    return {
                      value: mode,
                      label: runtimeModeLabels[mode],
                      icon: (
                        <Icon
                          className="icon-sm"
                          tone={mode === "full-access" ? "warning" : "secondary"}
                        />
                      ),
                    };
                  },
                ),
              ]}
              onChange={(next) =>
                onSessionDefaultsChange({
                  ...scopeDefaults,
                  runtimeMode: (next || undefined) as RuntimeMode | undefined,
                })
              }
            />
          </Row>
        </>
      ) : null}
      {section === "delegation" ? (
        <>
          {helpers?.control}
          <ProviderDefaultExtras extras={delegationRows(extras)} {...helperRows} />
        </>
      ) : (
        <ProviderDefaultExtras
          extras={extras.filter((setting) => !isDelegationSetting(setting))}
          harness={harness}
          inheritedDefaults={inheritedDefaults}
          scopeDefaults={scopeDefaults}
          onSessionDefaultsChange={onSessionDefaultsChange}
          resetLabel={resetLabel}
        />
      )}
    </Group>
  );
  if (section) return main;
  // Both together: conversation defaults, then who the agent delegates to, as its own section
  // for the same provider and account.
  const delegation = delegationRows(extras);
  return (
    <>
      {main}
      {delegation.length ? (
        <Group id="models-delegation" layout="full" title={t("Helpers and delegation")}>
          {helpers?.control}
          <ProviderDefaultExtras extras={delegation} {...helperRows} />
        </Group>
      ) : null}
    </>
  );
}
