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
} from "../../sessions/public/models";
import type { ProviderSessionDefaults } from "../../sessions/public/projectProviders";
import { mergeProviderExtras } from "../../sessions/public/providerSessionDefaults";
import {
  RUNTIME_MODES,
  RUNTIME_MODE_LABEL,
  runtimeModeUnavailableReason,
  type RuntimeMode,
} from "../../sessions/public/session";
import { ProviderDefaultExtras, inheritedChoiceLabel } from "./ProviderDefaultExtras";
import { Group, Row, Select, Toggle } from "./settingsControls";

function modelDisplayName(harness: HarnessId, id: string | undefined): string {
  if (!id) return t("Automatic");
  return resolveModel(harness, id).name;
}

/**
 * One provider's new-conversation defaults. Every change is reported to the page, which keeps
 * it as a pending change until Save; nothing here writes storage.
 */
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
  scopeControl,
  picker,
  section,
  providerControl,
}: {
  section?: "chat" | "delegation";
  providerControl?: ReactNode;
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
  /** Picks which account's defaults the rows below edit. */
  scopeControl?: ReactNode;
  /** Project and group targets: keep the provider out of their picker. */
  picker?: { inPicker: boolean; locked: boolean; onChange: (visible: boolean) => void };
}) {
  useLocale();
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
  const extras = current
    ? menuSettings({
        current,
        harnesses: HARNESSES.filter(isHarnessAvailable),
        source: { modelsFor },
        accountChoices: true,
        currentAccountId: supportsProviderAccounts(harness)
          ? (accountId ?? defaultProviderAccountId(harness))
          : undefined,
        signedOutAccounts: signedOutAccountKeys(delegationUsage),
        signedOutLabel: t("Not signed in"),
        values: mergeProviderExtras(harness, inheritedDefaults?.extras, scopeDefaults.extras),
        unavailable: (name) => t("Unavailable: {p0}", { p0: name }),
      })
        .filter((setting) => setting.id !== effort?.id)
        .map((setting) =>
          offeredDelegationSetting(
            setting,
            models,
            scopeDefaults.extras?.[setting.id] ?? inheritedDefaults?.extras?.[setting.id],
            current,
          ),
        )
    : [];
  // Inheritance is shown per row: a row that holds its own value offers a way back.
  const resetLabel = inherits ? t("Use Bycoda defaults") : t("Reset to automatic");

  useEffect(() => {
    if (!available || hasLiveCatalog(harness)) return;
    refreshProviderCatalog(harness).catch(() => undefined);
  }, [available, harness]);

  const effortOptions = effort
    ? [
        {
          value: "",
          icon: <WandSparkles className="icon-sm" />,
          label: inheritedChoiceLabel(
            inheritedDefaults?.effort
              ? t(
                  effort.options.find((option) => option.value === inheritedDefaults.effort)
                    ?.label ?? inheritedDefaults.effort,
                )
              : undefined,
            Boolean(validInheritedEffort),
          ),
        },
        ...(scopeDefaults.effort && !validEffort
          ? [
              {
                value: scopeDefaults.effort,
                label: `${scopeDefaults.effort} (${t("Unavailable")})`,
              },
            ]
          : []),
        ...ascendingEffortOptions(effort.options).map((option) => ({
          ...option,
          label: t(option.label),
        })),
      ]
    : [];
  return (
    <Group
      id={section === "delegation" ? "models-delegation" : "agent-clis"}
      layout="full"
      title={section === "delegation" ? null : t("New conversation defaults")}
      description={
        section === "delegation"
          ? t(
              "Global settings apply to chats and unattended work. Project, group and workspace settings apply to chats only.",
            )
          : inherits
            ? t("Unset fields use Bycoda defaults. Existing conversations keep their settings.")
            : t("Applies to new conversations. Existing conversations keep their settings.")
      }
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
              label={t("Model")}
              description={
                inherits
                  ? modelOverride
                    ? accountId
                      ? t("Account override. Bycoda default: {p0}", {
                          p0: modelDisplayName(harness, globalModel),
                        })
                      : t("Project override. Bycoda default: {p0}", {
                          p0: modelDisplayName(harness, globalModel),
                        })
                    : t("Uses Bycoda defaults")
                  : undefined
              }
              modified={inherits && Boolean(modelOverride)}
              onReset={onModelReset}
              resetLabel={t("Use Bycoda defaults")}
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
              label={t("Effort")}
              modified={Boolean(scopeDefaults.effort)}
              onReset={() => onSessionDefaultsChange({ ...scopeDefaults, effort: undefined })}
              resetLabel={resetLabel}
            >
              <div className="provider-effort">
                <EffortScale
                  label={t("{p0} default effort", { p0: HARNESS_TITLE[harness] })}
                  showLabel={false}
                  value={scopeDefaults.effort ?? ""}
                  options={effortOptions}
                  onValueChange={(next) =>
                    onSessionDefaultsChange({ ...scopeDefaults, effort: next || undefined })
                  }
                />
              </div>
            </Row>
          ) : null}
          <Row
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
                    inheritedRuntimeMode ? t(RUNTIME_MODE_LABEL[inheritedRuntimeMode]) : undefined,
                    validInheritedRuntimeMode,
                  ),
                  icon: <WandSparkles className="icon-sm" />,
                },
                ...(scopeDefaults.runtimeMode &&
                runtimeModeUnavailableReason(harness, scopeDefaults.runtimeMode)
                  ? [
                      {
                        value: scopeDefaults.runtimeMode,
                        label: `${t(RUNTIME_MODE_LABEL[scopeDefaults.runtimeMode])} (${t("Unavailable")})`,
                      },
                    ]
                  : []),
                ...RUNTIME_MODES.filter((mode) => !runtimeModeUnavailableReason(harness, mode)).map(
                  (mode) => {
                    const Icon = RUNTIME_MODE_ICONS[mode];
                    return {
                      value: mode,
                      label: t(RUNTIME_MODE_LABEL[mode]),
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
      <ProviderDefaultExtras
        extras={extras.filter((setting) => {
          const delegation = [
            CROSS_SUBAGENTS_KEY,
            CROSS_ADVISOR_KEY,
            CROSS_SUBAGENT_MAX_EFFORT_KEY,
            IMAGE_MODELS_KEY,
          ].includes(setting.id);
          return !section || (section === "delegation" ? delegation : !delegation);
        })}
        harness={harness}
        inheritedDefaults={inheritedDefaults}
        scopeDefaults={scopeDefaults}
        onSessionDefaultsChange={onSessionDefaultsChange}
        projectScope={inherits}
        resetLabel={resetLabel}
      />
    </Group>
  );
}
