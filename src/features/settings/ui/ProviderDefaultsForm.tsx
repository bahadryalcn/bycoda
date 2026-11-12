import { HarnessIcon } from "../../sessions/public/HarnessIcon";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
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
import { menuSettings, signedOutAccountKeys } from "../../sessions/public/modelPickerData";
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
}: {
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
  const resetLabel = inherits ? t("Use global default") : t("Reset to automatic");

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
        ...effort.options.map((option, index) => ({
          ...option,
          label: t(option.label),
          icon: (
            <Text size="caption" tone="accent">
              {"▁▂▄▆█"[Math.round((index * 4) / Math.max(1, effort.options.length - 1))]}
            </Text>
          ),
        })),
      ]
    : [];
  return (
    <Group
      id="agent-clis"
      layout="full"
      title={t("New conversation defaults")}
      description={
        inherits
          ? t(
              "Fields left on Global follow the global defaults. Existing conversations keep their settings.",
            )
          : t("Applies to new conversations. Existing conversations keep their settings.")
      }
    >
      {scopeControl}
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
                  ? t("Account override. Global: {p0}", {
                      p0: modelDisplayName(harness, globalModel),
                    })
                  : t("Project override. Global: {p0}", {
                      p0: modelDisplayName(harness, globalModel),
                    })
                : t("Follows the global model")
              : undefined
          }
          modified={inherits && Boolean(modelOverride)}
          onReset={onModelReset}
          resetLabel={t("Use global model")}
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
              description: item.id,
              icon: <HarnessIcon harness={harness} className="icon-sm" />,
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
            <div className="provider-effort-segments">
              <SegmentedControl
                label={t("{p0} default effort", { p0: HARNESS_TITLE[harness] })}
                value={scopeDefaults.effort && validEffort ? scopeDefaults.effort : ""}
                compact
                options={effortOptions.map((option) => ({
                  ...option,
                  tooltip: option.label,
                  label:
                    option.value === ""
                      ? t("Auto")
                      : option.value === "xhigh"
                        ? t("X-high")
                        : option.label,
                }))}
                onValueChange={(next) =>
                  onSessionDefaultsChange({ ...scopeDefaults, effort: next || undefined })
                }
              />
            </div>
            <Text size="caption" tone="muted" className="provider-effort-selected">
              {effortOptions.find((option) => option.value === (scopeDefaults.effort ?? ""))?.label}
            </Text>
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
      <ProviderDefaultExtras
        extras={extras}
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
