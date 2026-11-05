import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SearchInput } from "../../../shared/ui/SearchInput";
import {
  Group,
  RevealedSetting,
  Row,
  Select,
  SettingsFeedback,
  Toggle,
  settingDomId,
  useSettingsPageReset,
} from "./settingsControls";
import { Badge } from "../../../shared/ui/Badge";
import { projectDisplayName } from "../../projects/public/projectNames";
import { t, useLocale, getLocale } from "../../../shared/i18n";
import { ArrowDownCircle, Globe, RefreshCw } from "../../../shared/ui/icons";
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { RelativeSessionTime, useMinuteNow } from "../../../app/shell/RelativeSessionTime";
import "./ProviderSettings.css";

import { Button } from "../../../shared/ui/Button";

import {
  getHarnessAvailabilitySnapshot,
  hasProbedHarnessAvailability,
  harnessUnavailableHint,
  isHarnessAvailable,
  probeHarnessAvailability,
  subscribeHarnessAvailability,
} from "../../../integrations/harness/core/availability";

import {
  catalogModelsFor,
  defaultModelId,
  firstEnabledHarness,
  getModelSnapshot,
  hasLiveCatalog,
  isEnabledChoice,
  isModelEnabled,
  saveModelEnabled,
  loadDefaultModels,
  loadHiddenPickerProviders,
  loadLastModelChoice,
  modelsFor,
  resolveModel,
  modelEffortSetting,
  saveDefaultModel,
  saveLastModelChoice,
  savePickerProviderVisible,
  subscribeModels,
  subscribePickerVisibility,
  type AgentModel,
} from "../../sessions/public/models";
import { HARNESSES, HARNESS_TITLE } from "../../sessions";
import { offeredDelegationSetting } from "../../sessions/public/claudeAdvisor";
import { pickerSettings } from "../../sessions/public/modelPickerData";
import { pathKey, projectKey } from "../../../shared/lib/paths";

import { looksLikeProject, type RecentProject } from "../../projects/public/recents";

import {
  RUNTIME_MODES,
  RUNTIME_MODE_LABEL,
  runtimeModeUnavailableReason,
  type HarnessId,
  type RuntimeMode,
} from "../../sessions/public/session";
import {
  clearProjectModelChoice,
  loadProjectProviderSettings,
  normalizeProviderDefaults,
  projectProviderSettingsPersisted,
  projectProvidersRevision,
  setProjectDefaultModel,
  setProjectDefaultProvider,
  setProjectProviderHidden,
  subscribeProjectProviders,
  setProjectSessionDefaults,
  resetProjectSessionPreferences,
  type ProjectProviderSettings,
  type ProviderSessionDefaults,
} from "../../sessions/public/projectProviders";
import {
  loadGlobalSessionDefaults,
  providerSessionDefaults,
  providerSessionDefaultsSnapshot,
  saveGlobalSessionDefaults,
  subscribeProviderSessionDefaults,
} from "../../sessions/public/providerSessionDefaults";

import { refreshProviderCatalog } from "../../providers/model/catalogReceipts";
import { persistProviderPreference } from "../../providers/model/providerPreferenceOutcome";
import { CatalogReceiptStatus } from "../../providers/ui/CatalogReceiptStatus";
import {
  ProviderList,
  providerMetaLine,
  type ProviderListEntry,
} from "../../providers/ui/ProviderList";
import { ProviderDetailHeader, ProviderStatusGroup } from "../../providers/ui/ProviderStatusGroup";
import { providerAuthState } from "../../providers/ui/providerStatus";
import {
  checkInstalledHarnessVersions,
  getHarnessUpdateSnapshot,
  runHarnessUpdate,
  subscribeHarnessUpdates,
} from "../../providers/model/harnessUpdateActions";
import { onHarnessUpdated, pendingHarnessUpdates } from "../../providers/model/harnessUpdates";
import {
  defaultProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";
import { getAllRateLimits, subscribeRateLimits } from "../../providers/model/rateLimitsCache";

import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../../workspace/model/tabGroups";
import { useTabGroupLogos } from "../../projects/public/useTabGroupLogos";
import { ProjectLogoIcon } from "../../projects/public/ProjectLogoIcon";
import { ProjectMascot } from "../../projects/public/ProjectMascot";
import { loadClaudeHooks, saveClaudeHooks, subscribeClaudeHooks } from "../model/settings";

import { GLOBAL_PROVIDER_SCOPE, ProviderBinaryControl } from "./ProviderBinarySettings";
import { ProviderAccountsSettings } from "./ProviderAccountsSettings";
import { GenericAcpSettings } from "../../providers/ui/GenericAcpSettings";
import { PROVIDER_ACCOUNT_PROVIDERS } from "../../providers/model/providerAccounts";

export function ProvidersPage({ cwd, recents }: { cwd?: string; recents?: RecentProject[] }) {
  useLocale();
  const modelsVersion = useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  const providersRevision = useSyncExternalStore(
    subscribeProjectProviders,
    projectProvidersRevision,
    projectProvidersRevision,
  );
  void providersRevision;
  useSyncExternalStore(
    subscribeProviderSessionDefaults,
    providerSessionDefaultsSnapshot,
    providerSessionDefaultsSnapshot,
  );
  const rateLimits = useSyncExternalStore(subscribeRateLimits, getAllRateLimits, getAllRateLimits);
  const now = useMinuteNow();
  const [choice, setChoice] = useState(loadLastModelChoice);
  const [defaultModels, setDefaultModels] = useState(loadDefaultModels);
  const [claudeHooks, setClaudeHooks] = useStoredPreferenceState(
    loadClaudeHooks,
    subscribeClaudeHooks,
  );
  const [selectedScope, setScope] = useState<string>(GLOBAL_PROVIDER_SCOPE);
  const [hiddenGlobally, setHiddenGlobally] = useStoredPreferenceState(
    loadHiddenPickerProviders,
    subscribePickerVisibility,
  );
  const [selectedProvider, setSelectedProvider] = useState<HarnessId | null>(
    () => loadLastModelChoice()?.harness ?? null,
  );
  const [accountBusy, setAccountBusy] = useState(false);
  // When this window last finished a version check; the snapshot itself carries no time.
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  // Defaults are written to browser storage that can refuse the write. The
  // chosen value stays on screen, so say plainly when it will not survive.
  const [saveOutcome, setSaveOutcome] = useState<
    { state: "saved" } | { state: "unsaved"; message: string; retry: () => void } | null
  >(null);
  const updateSnapshot = useSyncExternalStore(
    subscribeHarnessUpdates,
    getHarnessUpdateSnapshot,
    getHarnessUpdateSnapshot,
  );
  const revealedSetting = useContext(RevealedSetting);
  const handledReveal = useRef<string | null>(null);

  const scopeOptions = useMemo(() => {
    const options: { value: string; label: string; icon?: ReactNode }[] = [
      {
        value: GLOBAL_PROVIDER_SCOPE,
        get label() {
          return t("Global");
        },
        icon: <Globe className="icon-sm shrink-0 text-(--ui-text-secondary)" strokeWidth={1.75} />,
      },
    ];
    const seen = new Set<string>();
    for (const path of [cwd, ...(recents ?? []).map((entry) => entry.path)]) {
      if (!path || !looksLikeProject(path)) continue;
      const key = pathKey(path);
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({
        value: path,
        label: projectDisplayName(path),
        icon: <ProjectScopeIcon path={path} />,
      });
    }
    return options;
  }, [getLocale(), cwd, recents]);

  // A project that left the options falls back to Global without rewriting the selection.
  const scope = scopeOptions.some((option) => option.value === selectedScope)
    ? selectedScope
    : GLOBAL_PROVIDER_SCOPE;
  const project = scope === GLOBAL_PROVIDER_SCOPE ? null : scope;
  const projectSettings = project ? loadProjectProviderSettings(project) : {};
  // A project without overrides inherits the global default provider, the same
  // way `defaultSessionChoice` resolves it for new conversations.
  const effectiveDefaultHarness = project
    ? firstEnabledHarness(project, projectSettings.defaultHarness ?? choice?.harness ?? "cursor")
    : (choice?.harness ?? null);

  useEffect(() => {
    void probeHarnessAvailability();
  }, []);

  useEffect(() => {
    // Another window's update leaves this window's versions stale.
    const unlisten = onHarnessUpdated(() => {
      if (getHarnessUpdateSnapshot().checks) {
        void checkInstalledHarnessVersions().catch(() => undefined);
      }
    }).catch(() => undefined);
    return () => {
      void unlisten.then((stop) => stop?.());
    };
  }, []);

  const onClaudeHooks = (next: boolean) => {
    saveClaudeHooks(next);
    setClaudeHooks(next);
  };

  const persist = (write: () => void, verify: () => boolean) => {
    const attempt = () => {
      const outcome = persistProviderPreference(write, verify);
      setSaveOutcome(
        outcome.state === "saved"
          ? outcome
          : { state: "unsaved", message: outcome.message, retry: attempt },
      );
    };
    attempt();
  };

  const onModelChange = (harness: HarnessId, model: string) => {
    if (project) {
      persist(
        () => setProjectDefaultModel(project, harness, model),
        projectProviderSettingsPersisted,
      );
      return;
    }
    const follows = choice?.harness === harness;
    persist(
      () => {
        saveDefaultModel(harness, model);
        if (follows) saveLastModelChoice(harness, model);
      },
      () =>
        loadDefaultModels()[harness] === model &&
        (!follows || loadLastModelChoice()?.model === model),
    );
    setDefaultModels((prev) => ({ ...prev, [harness]: model }));
    if (follows) setChoice({ harness, model });
  };

  const onModelReset = (harness: HarnessId) => {
    if (!project) return;
    persist(() => clearProjectModelChoice(project, harness), projectProviderSettingsPersisted);
  };

  const onDefault = (harness: HarnessId, model: string) => {
    if (project) {
      persist(
        () => setProjectDefaultProvider(project, harness, model),
        projectProviderSettingsPersisted,
      );
      return;
    }
    persist(
      () => saveLastModelChoice(harness, model),
      () => {
        const saved = loadLastModelChoice();
        return saved?.harness === harness && saved.model === model;
      },
    );
    setDefaultModels((prev) => ({ ...prev, [harness]: model }));
    setChoice({ harness, model });
  };

  const onPickerVisible = (harness: HarnessId, visible: boolean) => {
    if (project) {
      persist(
        () => setProjectProviderHidden(project, harness, !visible),
        projectProviderSettingsPersisted,
      );
      return;
    }
    persist(
      () => savePickerProviderVisible(harness, visible),
      () => loadHiddenPickerProviders().includes(harness) === !visible,
    );
    setHiddenGlobally((prev) =>
      visible ? prev.filter((id) => id !== harness) : [...new Set([...prev, harness])],
    );
  };

  const onSessionDefaults = (harness: HarnessId, next: ProviderSessionDefaults) => {
    if (project) {
      persist(
        () => setProjectSessionDefaults(project, harness, next),
        projectProviderSettingsPersisted,
      );
      return;
    }
    persist(
      () => saveGlobalSessionDefaults(harness, next),
      () =>
        JSON.stringify(loadGlobalSessionDefaults()[harness] ?? {}) ===
        JSON.stringify(normalizeProviderDefaults(next)),
    );
  };

  const resetToGlobalDefaults = () => {
    if (!project) return;
    persist(() => resetProjectSessionPreferences(project), projectProviderSettingsPersisted);
  };
  // The settings shell offers "Restore defaults" for a project; visibility and accounts stay.
  useSettingsPageReset(project ? resetToGlobalDefaults : null);
  const projectOverridden = project != null && hasProjectOverrides(projectSettings);

  // Installed CLIs come first. Stable sorting keeps Claude before Codex and
  // preserves the catalog order within each availability group.
  const orderedHarnesses = [...HARNESSES].sort(
    (left, right) => Number(isHarnessAvailable(right)) - Number(isHarnessAvailable(left)),
  );
  const activeProvider =
    selectedProvider && orderedHarnesses.includes(selectedProvider)
      ? selectedProvider
      : (orderedHarnesses[0] ?? null);

  useEffect(() => {
    if (accountBusy) return;
    if (!revealedSetting) {
      handledReveal.current = null;
      return;
    }
    // A search reveal selects its provider once. Keep subsequent manual
    // selections stable while the same setting remains revealed.
    if (handledReveal.current === revealedSetting) return;
    handledReveal.current = revealedSetting;

    if (revealedSetting?.startsWith("cli-path-")) {
      const harness = revealedSetting.slice("cli-path-".length) as HarnessId;
      if (HARNESSES.includes(harness)) setSelectedProvider(harness);
    } else if (revealedSetting?.startsWith("terminal-account-profiles-")) {
      const provider = revealedSetting.slice("terminal-account-profiles-".length);
      if (PROVIDER_ACCOUNT_PROVIDERS.some((candidate) => candidate === provider)) {
        setSelectedProvider(provider as HarnessId);
      }
    } else if (revealedSetting === "enabled-models") {
      const modelProvider =
        activeProvider && catalogModelsFor(activeProvider).length > 0
          ? activeProvider
          : HARNESSES.find((harness) => catalogModelsFor(harness).length > 0);
      if (modelProvider) setSelectedProvider(modelProvider);
    } else if (revealedSetting === "claude-hooks") {
      setSelectedProvider("claude");
    } else if (revealedSetting === "antigravity-account") {
      setSelectedProvider("antigravity");
    } else if (
      revealedSetting === "acp-agents" ||
      revealedSetting === "acp-advanced" ||
      revealedSetting === "acp-registry"
    ) {
      setSelectedProvider("acp");
    } else if (
      revealedSetting === "provider-accounts" ||
      revealedSetting === "terminal-account-profiles"
    ) {
      setSelectedProvider((current) =>
        current && PROVIDER_ACCOUNT_PROVIDERS.some((provider) => provider === current)
          ? current
          : PROVIDER_ACCOUNT_PROVIDERS[0],
      );
    }
  }, [revealedSetting, modelsVersion, activeProvider, accountBusy]);

  const inPickerFor = (harness: HarnessId) =>
    !hiddenGlobally.includes(harness) &&
    (!project || !(projectSettings.hidden ?? []).includes(harness));
  const isDefaultFor = (harness: HarnessId) =>
    project ? effectiveDefaultHarness === harness : choice?.harness === harness;
  const probed = hasProbedHarnessAvailability();
  const entryFor = (harness: HarnessId): ProviderListEntry => {
    const check = updateSnapshot.checks?.find((entry) => entry.harness === harness);
    const accountKey = supportsProviderAccounts(harness)
      ? `${harness}:${defaultProviderAccountId(harness)}`
      : null;
    return {
      harness,
      available: isHarnessAvailable(harness),
      isDefault: isDefaultFor(harness),
      inPicker: inPickerFor(harness),
      // A globally hidden provider stays out of every project's picker, so the
      // project toggle is shown locked rather than appearing to work.
      pickerLocked: project != null && hiddenGlobally.includes(harness),
      version: check && check.status !== "unknown" ? check.installed : undefined,
      updateAvailable: check?.status === "behind",
      auth: accountKey ? providerAuthState(rateLimits[accountKey], now) : null,
    };
  };
  const entries = orderedHarnesses.map(entryFor);

  // Update summary for the whole page; each provider's own state lives in its Status group.
  const { checks, checking, runs, error: checkError } = updateSnapshot;
  const pending = pendingHarnessUpdates(checks ?? []).filter(
    (update) => runs[update.harness]?.status !== "updating",
  );
  const attention = checks
    ? checks.filter(
        (check) => check.status !== "current" || runs[check.harness]?.status === "failed",
      ).length
    : 0;
  const runCheck = () => {
    void checkInstalledHarnessVersions({ force: true })
      .then(() => setCheckedAt(Date.now()))
      .catch(() => undefined);
  };
  const updatesSummary = checking
    ? t("Checking installed CLIs…")
    : checks === null
      ? t("Not checked yet")
      : checks.length === 0
        ? t("None of the CLIs with a release feed are installed.")
        : attention > 0
          ? attention === 1
            ? t("1 CLI needs attention")
            : t("{p0} CLIs need attention", { p0: attention })
          : t("All CLIs are up to date");

  const setupProvider = (harness: HarnessId) => {
    setSelectedProvider(harness);
    // The Runtime section holds the CLI path and setup for this provider.
    requestAnimationFrame(() =>
      document
        .getElementById(settingDomId(`cli-path-${harness}`))
        ?.scrollIntoView?.({ block: "center" }),
    );
  };

  return (
    <div className="settings-topics grid min-w-0 gap-6">
      <Group
        id="agent-clis"
        layout="full"
        title={t("Providers and model defaults")}
        persistence={{
          mode: "automatic",
          state: saveOutcome?.state === "unsaved" ? "error" : saveOutcome ? "saved" : "idle",
          error: saveOutcome?.state === "unsaved" ? saveOutcome.message : undefined,
        }}
        feedback={
          saveOutcome?.state === "unsaved" ? (
            <SettingsFeedback
              state="error"
              action={
                <Button size="sm" variant="ghost" onClick={saveOutcome.retry}>
                  {t("Retry")}
                </Button>
              }
            >
              {t("Not saved. The choice applies until this window closes. {p0}", {
                p0: saveOutcome.message,
              })}
            </SettingsFeedback>
          ) : undefined
        }
      >
        <Row
          label={t("Apply defaults to")}
          description={
            project
              ? t("Defaults for {p0} only. CLI paths stay global.", {
                  p0: projectDisplayName(project),
                })
              : t(
                  "CLI paths, accounts and model lists are shared by every project on this machine.",
                )
          }
          modified={projectOverridden}
          onReset={resetToGlobalDefaults}
          resetLabel={t("Use global defaults")}
        >
          <SearchableSelect
            label={t("Provider defaults scope")}
            searchPlaceholder={t("Search projects")}
            value={scope}
            options={scopeOptions}
            onChange={setScope}
          />
        </Row>
        <Row
          id="harness-updates"
          label={t("CLI updates")}
          description={updatesSummary}
          feedback={
            checkError ? (
              <SettingsFeedback state="error">
                {t("Could not check CLI updates: ")}
                {checkError}
              </SettingsFeedback>
            ) : undefined
          }
        >
          <div className="provider-updates-actions">
            {checkedAt != null && !checking ? (
              <span className="provider-status-checked">
                {t("Checked")} <RelativeSessionTime at={checkedAt} />
              </span>
            ) : null}
            <Button
              size="sm"
              stableWidth
              onClick={runCheck}
              disabled={checking}
              loading={checking}
              startIcon={<RefreshCw className="icon-sm" strokeWidth={1.75} aria-hidden />}
            >
              {t("Check all")}
            </Button>
            <Button
              size="sm"
              stableWidth
              onClick={() => {
                for (const update of pending) void runHarnessUpdate(update);
              }}
              disabled={pending.length === 0}
              tooltip={pending.length === 0 ? t("Nothing to update") : undefined}
              startIcon={<ArrowDownCircle className="icon-sm text-accent" aria-hidden />}
            >
              {t("Update all")}
            </Button>
          </div>
        </Row>
      </Group>

      <div className="provider-cli-container">
        <div className="provider-cli-workspace">
          <div className="provider-cli-select">
            <SearchableSelect
              label={t("Providers")}
              value={activeProvider ?? ""}
              disabled={accountBusy}
              searchPlaceholder={t("Search providers…")}
              options={entries.map((entry) => ({
                value: entry.harness,
                label: HARNESS_TITLE[entry.harness],
                description: [
                  providerMetaLine(entry, probed),
                  entry.isDefault ? t("Default provider") : "",
                ]
                  .filter(Boolean)
                  .join(" · "),
              }))}
              onChange={(value) => {
                const provider = orderedHarnesses.find((harness) => harness === value);
                if (provider) setSelectedProvider(provider);
              }}
            />
          </div>
          <ProviderList
            entries={entries}
            active={activeProvider}
            probed={probed}
            disabled={accountBusy}
            onSelect={setSelectedProvider}
            onPickerVisible={onPickerVisible}
            onSetup={setupProvider}
          />
          <div className="provider-cli-detail">
            {activeProvider ? (
              <>
                <ProviderDetailHeader
                  harness={activeProvider}
                  available={isHarnessAvailable(activeProvider)}
                />
                <ProviderStatusGroup
                  harness={activeProvider}
                  available={isHarnessAvailable(activeProvider)}
                  checkedAt={checkedAt}
                  onCheck={runCheck}
                  onSetup={() => setupProvider(activeProvider)}
                />
              </>
            ) : null}
            {accountBusy ? (
              <p role="status" className="text-ui-caption text-(--ui-text-secondary)">
                {t("Finish or cancel the account operation before switching providers.")}
              </p>
            ) : null}
            <ProviderAccountsSettings
              harness={activeProvider ?? undefined}
              onBusyChange={setAccountBusy}
            />
            {orderedHarnesses.map((harness) => {
              const selectedModel = project
                ? (projectSettings.models?.[harness] ??
                  (projectSettings.defaultHarness === harness
                    ? projectSettings.defaultModel
                    : undefined) ??
                  defaultModels[harness] ??
                  (choice?.harness === harness ? choice.model : defaultModelId(harness)))
                : (defaultModels[harness] ??
                  (choice?.harness === harness ? choice.model : defaultModelId(harness)));
              return (
                <div
                  key={harness}
                  className="provider-cli-panel"
                  hidden={activeProvider !== harness}
                >
                  <ProviderRow
                    harness={harness}
                    selectedModel={selectedModel}
                    isDefault={isDefaultFor(harness)}
                    inPicker={inPickerFor(harness)}
                    pickerLocked={project != null && hiddenGlobally.includes(harness)}
                    inheritedDefaults={project ? providerSessionDefaults(harness) : undefined}
                    scopeDefaults={
                      project
                        ? projectSettings.defaults?.[harness]
                        : providerSessionDefaults(harness)
                    }
                    onSessionDefaultsChange={(next) => onSessionDefaults(harness, next)}
                    modelOverride={
                      project ? projectModelOverride(projectSettings, harness) : undefined
                    }
                    globalModel={
                      project
                        ? (defaultModels[harness] ??
                          (choice?.harness === harness ? choice.model : defaultModelId(harness)))
                        : undefined
                    }
                    onModelReset={project ? () => onModelReset(harness) : undefined}
                    onDefault={onDefault}
                    onModelChange={onModelChange}
                    onPickerVisible={(visible) => onPickerVisible(harness, visible)}
                    isSelected={activeProvider === harness}
                    claudeHooks={claudeHooks}
                    onClaudeHooksChange={onClaudeHooks}
                    projectScope={project != null}
                  />
                  {harness === "acp" ? <GenericAcpSettings cwd={cwd} embedded /> : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** True when a project stores anything that "Use global defaults" would clear. */
function hasProjectOverrides(settings: ProjectProviderSettings): boolean {
  return Boolean(
    settings.defaultHarness ||
    settings.defaultModel ||
    Object.keys(settings.models ?? {}).length > 0 ||
    Object.keys(settings.defaults ?? {}).length > 0,
  );
}

/** The model a project stores for a provider; undefined when it follows global. */
function projectModelOverride(
  settings: ReturnType<typeof loadProjectProviderSettings>,
  harness: HarnessId,
): string | undefined {
  return (
    settings.models?.[harness] ??
    (settings.defaultHarness === harness ? settings.defaultModel : undefined)
  );
}

function modelDisplayName(harness: HarnessId, id: string | undefined): string {
  if (!id) return t("Automatic");
  return resolveModel(harness, id).name;
}

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

/** Per-model switches: a model turned off is never offered or picked by default. */
export function EnabledModelsGroup({ harness }: { harness: HarnessId }) {
  useLocale();
  const models = catalogModelsFor(harness);
  const enabledCount = models.filter((model) => isModelEnabled(model.id)).length;
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const filtered = models.filter((model) =>
    `${model.name} ${model.id}`.toLocaleLowerCase().includes(needle),
  );
  const defaultId = defaultModelId(harness);
  const guard = t("Keep one model enabled. Hide the provider to remove it from the picker.");

  // Bulk actions keep at least one model on, the same guard each switch applies.
  const enableAll = () => {
    for (const model of models) if (!isModelEnabled(model.id)) saveModelEnabled(model.id, true);
  };
  const onlyDefault = () => {
    const keep = models.find((model) => model.id === defaultId) ?? models[0];
    if (!keep) return;
    saveModelEnabled(keep.id, true);
    for (const model of models) {
      if (model.id !== keep.id && isModelEnabled(model.id)) saveModelEnabled(model.id, false);
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
      description={t("Models turned off stay out of every model picker.")}
      dependency={models.length > 0 && enabledCount <= 1 ? guard : undefined}
      action={
        models.length > 1 ? (
          <div className="provider-models-actions">
            <Button
              size="sm"
              variant="ghost"
              onClick={enableAll}
              disabled={enabledCount === models.length}
            >
              {t("Enable all")}
            </Button>
            <Button size="sm" variant="ghost" onClick={onlyDefault} disabled={enabledCount <= 1}>
              {t("Only default")}
            </Button>
          </div>
        ) : undefined
      }
    >
      {models.length > 5 ? (
        <div className="provider-models-search">
          <SearchInput
            aria-label={t("Search models…")}
            appearance="field"
            placeholder={t("Search models…")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      ) : null}
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
                  <span className="truncate">{model.name}</span>
                  {model.id === defaultId ? (
                    <Badge size="sm" className="shrink-0">
                      {t("Default")}
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
      <div className="provider-models-source">
        <CatalogReceiptStatus harness={harness} available={isHarnessAvailable(harness)} />
      </div>
    </Group>
  );
}

/** The icon the project rail shows: custom logo, else the project mascot. */
export function ProjectScopeIcon({ path }: { path: string }) {
  useLocale();
  const logos = useTabGroupLogos();
  const [colors] = useState(loadTabGroupColors);
  const [customColors] = useState(loadTabGroupCustomColors);
  const [mascots] = useState(loadTabGroupMascots);
  const key = projectKey(path);
  const name = projectDisplayName(path);
  const logoPath = resolveTabGroupLogo(key, logos);
  if (logoPath) {
    return (
      <ProjectLogoIcon path={logoPath} className="icon-md rounded-sm" imageClassName="size-4" />
    );
  }
  return (
    <ProjectMascot
      project={name}
      color={resolveTabGroupColor(key, colors, customColors, name)}
      name={resolveTabGroupMascot(key, mascots)}
      className="size-3.5"
    />
  );
}

/** CLI path, setup and installation help; for Claude Code also its hooks switch. */
function ProviderRuntimeGroup({
  harness,
  isSelected,
  claudeHooks,
  onClaudeHooksChange,
}: {
  harness: HarnessId;
  isSelected: boolean;
  claudeHooks: boolean;
  onClaudeHooksChange?: (next: boolean) => void;
}) {
  useLocale();
  const missing = hasProbedHarnessAvailability() && !isHarnessAvailable(harness);
  return (
    <Group id={`cli-path-${harness}`} layout="full" title={t("Runtime")}>
      <Row label={t("{p0} CLI path and installation", { p0: HARNESS_TITLE[harness] })}>
        <ProviderBinaryControl
          key={harness}
          provider={harness}
          showLabel
          triggerVariant="secondary"
        />
      </Row>
      {missing ? (
        <Row label={t("Installation help")} description={harnessUnavailableHint(harness)} />
      ) : null}
      {isSelected && harness === "claude" && onClaudeHooksChange ? (
        <Row
          id="claude-hooks"
          label={t("Claude Code hooks")}
          description={t("Configured hooks run on the next turn.")}
        >
          <Toggle label={t("Claude Code hooks")} on={claudeHooks} onChange={onClaudeHooksChange} />
        </Row>
      ) : null}
    </Group>
  );
}

/** Label of the "follow the scope above" choice, naming the value it inherits. */
function inheritedChoiceLabel(inherited: string | undefined, valid: boolean): string {
  return inherited
    ? `${t("Global")} (${inherited}${valid ? "" : ` · ${t("Unavailable")}`})`
    : t("Automatic");
}

export function ProviderRow({
  harness,
  isSelected = false,
  claudeHooks = false,
  onClaudeHooksChange,
  selectedModel,
  isDefault,
  inPicker,
  pickerLocked = false,
  onDefault,
  onModelChange,
  onPickerVisible,
  inheritedDefaults,
  scopeDefaults = {},
  onSessionDefaultsChange,
  projectScope = false,
  modelOverride,
  globalModel,
  onModelReset,
}: {
  harness: HarnessId;
  isSelected?: boolean;
  claudeHooks?: boolean;
  onClaudeHooksChange?: (next: boolean) => void;
  selectedModel: string;
  isDefault: boolean;
  inPicker: boolean;
  /** Globally hidden providers cannot be turned on per project. */
  pickerLocked?: boolean;
  onDefault: (harness: HarnessId, model: string) => void;
  onModelChange: (harness: HarnessId, model: string) => void;
  onPickerVisible: (visible: boolean) => void;
  inheritedDefaults?: ProviderSessionDefaults;
  scopeDefaults?: ProviderSessionDefaults;
  onSessionDefaultsChange?: (next: ProviderSessionDefaults) => void;
  projectScope?: boolean;
  /** Project scope: the model this project stores for the provider, if any. */
  modelOverride?: string;
  /** Project scope: the global model the provider falls back to. */
  globalModel?: string;
  /** Project scope: drop the override and follow the global model again. */
  onModelReset?: () => void;
}) {
  useLocale();
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
    ? pickerSettings(current)
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
  const resetLabel = projectScope ? t("Use global default") : t("Reset to automatic");

  useEffect(() => {
    if (!isSelected || !available || hasLiveCatalog(harness)) return;
    void refreshProviderCatalog(harness);
  }, [available, harness, isSelected]);

  return (
    <article
      className="provider-cli-card"
      aria-label={t("{p0} CLI settings", { p0: HARNESS_TITLE[harness] })}
      data-default={isDefault || undefined}
    >
      <Group
        layout="full"
        title={t("New conversation defaults")}
        description={
          projectScope
            ? t(
                "Fields left on Global follow the global defaults. Existing conversations keep their settings.",
              )
            : t("Applies to new conversations. Existing conversations keep their settings.")
        }
      >
        {available ? (
          <div className="provider-picker-narrow">
            <Row label={pickerLocked ? t("Hidden globally") : t("Show in picker")}>
              <Toggle
                label={t("Show {p0} in the model picker", { p0: HARNESS_TITLE[harness] })}
                on={inPicker}
                onChange={onPickerVisible}
                disabled={pickerLocked}
              />
            </Row>
          </div>
        ) : null}
        {current ? (
          <Row
            label={t("Model")}
            description={
              projectScope
                ? modelOverride
                  ? t("Project override. Global: {p0}", {
                      p0: modelDisplayName(harness, globalModel),
                    })
                  : t("Follows the global model")
                : undefined
            }
            modified={projectScope && Boolean(modelOverride)}
            onReset={onModelReset}
            resetLabel={t("Use global model")}
          >
            <SearchableSelect
              label={t("{p0} model", { p0: HARNESS_TITLE[harness] })}
              triggerProps={{
                onClick: (event) => {
                  if (event.currentTarget.getAttribute("aria-expanded") !== "true")
                    void refreshProviderCatalog(harness, { force: true });
                },
              }}
              value={current.id}
              onChange={(next) => onModelChange(harness, next)}
              options={models.map((item) => ({
                value: item.id,
                label: item.name,
                description: item.id,
              }))}
            />
          </Row>
        ) : (
          <Row label={t("Model")}>
            <span className="text-ui-caption text-(--ui-text-muted)">
              {available ? t("Loading models…") : t("Available after CLI setup")}
            </span>
          </Row>
        )}
        {effort ? (
          <Row
            label={t("Effort")}
            modified={Boolean(scopeDefaults.effort)}
            onReset={() => onSessionDefaultsChange?.({ ...scopeDefaults, effort: undefined })}
            resetLabel={resetLabel}
          >
            <Select
              label={t("{p0} default effort", { p0: HARNESS_TITLE[harness] })}
              value={scopeDefaults.effort && validEffort ? scopeDefaults.effort : ""}
              options={[
                {
                  value: "",
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
                ...effort.options.map((option) => ({ ...option, label: t(option.label) })),
              ]}
              onChange={(next) =>
                onSessionDefaultsChange?.({ ...scopeDefaults, effort: next || undefined })
              }
            />
          </Row>
        ) : null}
        <Row
          label={t("Permissions")}
          modified={Boolean(scopeDefaults.runtimeMode)}
          onReset={() => onSessionDefaultsChange?.({ ...scopeDefaults, runtimeMode: undefined })}
          resetLabel={resetLabel}
        >
          <Select
            label={t("{p0} default permissions", { p0: HARNESS_TITLE[harness] })}
            value={scopeDefaults.runtimeMode ?? ""}
            options={[
              {
                value: "",
                label: inheritedChoiceLabel(
                  inheritedRuntimeMode ? t(RUNTIME_MODE_LABEL[inheritedRuntimeMode]) : undefined,
                  validInheritedRuntimeMode,
                ),
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
                (mode) => ({ value: mode, label: t(RUNTIME_MODE_LABEL[mode]) }),
              ),
            ]}
            onChange={(next) =>
              onSessionDefaultsChange?.({
                ...scopeDefaults,
                runtimeMode: (next || undefined) as RuntimeMode | undefined,
              })
            }
          />
        </Row>
        {onSessionDefaultsChange
          ? extras.map((setting) => {
              const saved = scopeDefaults.extras?.[setting.id];
              const inherited = inheritedDefaults?.extras?.[setting.id];
              const inheritedOption = setting.options.find((option) => option.value === inherited);
              const inheritedLabel = inheritedOption?.label ?? inherited;
              const savedIsUnavailable =
                Boolean(saved) && !setting.options.some((option) => option.value === saved);
              return (
                <Row
                  key={setting.id}
                  label={t(setting.label)}
                  modified={Boolean(saved)}
                  onReset={() => {
                    const nextExtras = { ...scopeDefaults.extras };
                    delete nextExtras[setting.id];
                    onSessionDefaultsChange({ ...scopeDefaults, extras: nextExtras });
                  }}
                  resetLabel={resetLabel}
                >
                  <Select
                    label={t("{p0} default {p1}", {
                      p0: HARNESS_TITLE[harness],
                      p1: t(setting.label),
                    })}
                    value={saved ?? ""}
                    options={[
                      {
                        value: "",
                        label: inheritedChoiceLabel(
                          inheritedLabel ? t(inheritedLabel) : undefined,
                          Boolean(inheritedOption),
                        ),
                      },
                      ...(savedIsUnavailable
                        ? [{ value: saved!, label: `${saved} (${t("Unavailable")})` }]
                        : []),
                      ...setting.options.map((option) => ({
                        value: option.value,
                        label: t(option.label),
                      })),
                    ]}
                    onChange={(next) => {
                      const nextExtras = { ...scopeDefaults.extras };
                      if (next) nextExtras[setting.id] = next;
                      else delete nextExtras[setting.id];
                      onSessionDefaultsChange({
                        ...scopeDefaults,
                        extras: nextExtras,
                      });
                    }}
                  />
                </Row>
              );
            })
          : null}
        <Row label={t("Default provider")}>
          <Toggle
            label={
              isDefault
                ? t("{p0} is the default provider", { p0: HARNESS_TITLE[harness] })
                : t("Use {p0} by default", { p0: HARNESS_TITLE[harness] })
            }
            on={isDefault}
            onChange={() => current && onDefault(harness, current.id)}
            // The default provider is replaced by choosing another one, never switched off.
            disabled={isDefault || !current}
          />
        </Row>
      </Group>
      {isSelected ? <EnabledModelsGroup harness={harness} /> : null}
      <ProviderRuntimeGroup
        harness={harness}
        isSelected={isSelected}
        claudeHooks={claudeHooks}
        onClaudeHooksChange={onClaudeHooksChange}
      />
    </article>
  );
}
