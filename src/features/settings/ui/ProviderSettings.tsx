import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { SettingsFeedback } from "./settingsControls";
import { Badge } from "../../../shared/ui/Badge";
import { projectDisplayName } from "../../projects/model/projectNames";
import { t, useLocale, getLocale } from "../../../shared/i18n";
import { ArrowDownCircle, Check, Globe, RefreshCw } from "../../../shared/ui/icons";
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
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
} from "../../sessions/model/models";
import { offeredDelegationSetting } from "../../sessions/model/claudeAdvisor";
import { pickerSettings } from "../../sessions/model/modelPickerData";
import { pathKey, projectKey } from "../../../shared/lib/paths";

import { looksLikeProject, type RecentProject } from "../../projects/model/recents";
import {
  HARNESSES,
  HARNESS_TITLE,
  type HarnessId,
  type RuntimeMode,
  RUNTIME_MODES,
  RUNTIME_MODE_LABEL,
  runtimeModeUnavailableReason,
} from "../../sessions/model/session";
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
  type ProviderSessionDefaults,
} from "../../sessions/model/projectProviders";
import {
  loadGlobalSessionDefaults,
  providerSessionDefaults,
  providerSessionDefaultsSnapshot,
  saveGlobalSessionDefaults,
  subscribeProviderSessionDefaults,
} from "../../sessions/model/providerSessionDefaults";

import { refreshProviderCatalog } from "../../providers/model/catalogReceipts";
import { persistProviderPreference } from "../../providers/model/providerPreferenceOutcome";
import { CatalogReceiptStatus } from "../../providers/ui/CatalogReceiptStatus";
import {
  checkInstalledHarnessVersions,
  getHarnessUpdateSnapshot,
  runHarnessUpdate,
  subscribeHarnessUpdates,
  type HarnessUpdateRun,
} from "../../providers/model/harnessUpdateActions";
import {
  onHarnessUpdated,
  pendingHarnessUpdates,
  type HarnessUpdate,
  type HarnessVersionCheck,
} from "../../providers/model/harnessUpdates";

import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../../workspace/model/tabGroups";
import { useTabGroupLogos } from "../../projects/hooks/useTabGroupLogos";
import { ProjectLogoIcon } from "../../projects/ui/ProjectLogoIcon";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import { loadClaudeHooks, saveClaudeHooks, subscribeClaudeHooks } from "../model/settings";

import { AdvancedSettings, Group, RevealedSetting, Row, Toggle, Select } from "./settingsControls";
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

  const scopeControl = (
    <div className="provider-cli-scope">
      <span className="text-ui-micro text-(--ui-text-secondary)">{t("Apply defaults to")}</span>
      <SearchableSelect
        label={t("Provider defaults scope")}
        searchPlaceholder={t("Search projects")}
        value={scope}
        options={scopeOptions}
        onChange={setScope}
      />
      {project ? (
        <Button
          variant="ghost"
          onClick={() =>
            persist(() => resetProjectSessionPreferences(project), projectProviderSettingsPersisted)
          }
        >
          {t("Use global defaults")}
        </Button>
      ) : null}
    </div>
  );

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
        scope={
          project
            ? t("Defaults for {p0} only. CLI paths stay global.", {
                p0: projectDisplayName(project),
              })
            : t("This machine · all projects")
        }
        description={
          project
            ? t("Defaults for {p0} only. CLI paths stay global.", {
                p0: projectDisplayName(project),
              })
            : undefined
        }
      >
        {saveOutcome?.state === "unsaved" ? (
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
        ) : null}
        <div className="provider-cli-container">
          <div className="provider-cli-workspace">
            <div className="provider-cli-select">
              <SearchableSelect
                label={t("Providers")}
                value={activeProvider ?? ""}
                disabled={accountBusy}
                searchPlaceholder={t("Search providers…")}
                options={orderedHarnesses.map((harness) => {
                  const available = isHarnessAvailable(harness);
                  const inPicker =
                    !hiddenGlobally.includes(harness) &&
                    (!project || !(projectSettings.hidden ?? []).includes(harness));
                  const isDefault = project
                    ? effectiveDefaultHarness === harness
                    : choice?.harness === harness;
                  return {
                    value: harness,
                    label: HARNESS_TITLE[harness],
                    description: [
                      available
                        ? t("CLI detected")
                        : hasProbedHarnessAvailability()
                          ? t("CLI not found")
                          : t("Checking CLI…"),
                      isDefault ? t("Default provider") : !inPicker ? t("Hidden") : "",
                    ]
                      .filter(Boolean)
                      .join(" · "),
                  };
                })}
                onChange={(value) => {
                  const provider = orderedHarnesses.find((harness) => harness === value);
                  if (provider) setSelectedProvider(provider);
                }}
              />
            </div>
            <nav className="provider-cli-selector" aria-label={t("Providers")}>
              {orderedHarnesses.map((harness) => {
                const available = isHarnessAvailable(harness);
                const inPicker = project
                  ? !(projectSettings.hidden ?? []).includes(harness) &&
                    !hiddenGlobally.includes(harness)
                  : !hiddenGlobally.includes(harness);
                const isDefault = project
                  ? effectiveDefaultHarness === harness
                  : choice?.harness === harness;
                const selected = activeProvider === harness;
                const updateAvailable = updateSnapshot.checks?.some(
                  (check) => check.harness === harness && check.status === "behind",
                );
                return (
                  <Button
                    key={harness}
                    variant="item"
                    selected={selected}
                    disabled={accountBusy}
                    className="provider-cli-option"
                    title={HARNESS_TITLE[harness]}
                    aria-current={selected ? "true" : undefined}
                    aria-label={[
                      HARNESS_TITLE[harness],
                      available
                        ? t("CLI detected")
                        : hasProbedHarnessAvailability()
                          ? t("CLI not found")
                          : t("Checking CLI…"),
                      isDefault ? t("Default provider") : !inPicker ? t("Hidden") : "",
                      updateAvailable ? t("Update available") : "",
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    onClick={() => setSelectedProvider(harness)}
                  >
                    <HarnessIcon harness={harness} className="icon-md shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{HARNESS_TITLE[harness]}</span>
                    {updateAvailable ? (
                      <ArrowDownCircle
                        className="icon-sm shrink-0 text-accent"
                        aria-hidden
                        strokeWidth={1.75}
                      />
                    ) : null}
                    {isDefault ? (
                      <Badge size="sm" className="shrink-0">
                        {t("Default")}
                      </Badge>
                    ) : !inPicker ? (
                      <Badge size="sm" className="shrink-0">
                        {t("Hidden")}
                      </Badge>
                    ) : !available && hasProbedHarnessAvailability() ? (
                      <Badge size="sm" tone="warning" className="shrink-0">
                        {t("Not installed")}
                      </Badge>
                    ) : null}
                  </Button>
                );
              })}
            </nav>
            <div className="provider-cli-detail">
              {activeProvider ? <ProviderCliHeader harness={activeProvider} /> : null}
              {accountBusy ? (
                <p role="status" className="mb-3 text-ui-caption text-(--ui-text-secondary)">
                  {t("Finish or cancel the account operation before switching providers.")}
                </p>
              ) : null}
              <ProviderAccountsSettings
                harness={activeProvider ?? undefined}
                onBusyChange={setAccountBusy}
              />
              {orderedHarnesses.map((harness) => {
                const inPicker = project
                  ? !(projectSettings.hidden ?? []).includes(harness) &&
                    !hiddenGlobally.includes(harness)
                  : !hiddenGlobally.includes(harness);
                // A globally hidden provider stays out of every project's picker, so
                // the project toggle is shown locked rather than appearing to work.
                const pickerLocked = project != null && hiddenGlobally.includes(harness);
                const selectedModel = project
                  ? (projectSettings.models?.[harness] ??
                    (projectSettings.defaultHarness === harness
                      ? projectSettings.defaultModel
                      : undefined) ??
                    defaultModels[harness] ??
                    (choice?.harness === harness ? choice.model : defaultModelId(harness)))
                  : (defaultModels[harness] ??
                    (choice?.harness === harness ? choice.model : defaultModelId(harness)));
                const isDefault = project
                  ? effectiveDefaultHarness === harness
                  : choice?.harness === harness;
                return (
                  <div
                    key={harness}
                    className="provider-cli-panel"
                    hidden={activeProvider !== harness}
                  >
                    <ProviderRow
                      hideHeader={activeProvider === harness}
                      harness={harness}
                      selectedModel={selectedModel}
                      isDefault={isDefault}
                      inPicker={inPicker}
                      pickerLocked={pickerLocked}
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
                      scopeLabel={project ? projectDisplayName(project) : t("Global")}
                      scopeControl={activeProvider === harness ? scopeControl : undefined}
                      projectScope={project != null}
                    />
                    {harness === "acp" ? <GenericAcpSettings cwd={cwd} embedded /> : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Group>

      <HarnessUpdatesGroup />
    </div>
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

/** Per-model switches: a model turned off is never offered or picked by default. */
export function EnabledModelsGroup({ harness }: { harness: HarnessId }) {
  useLocale();
  const models = catalogModelsFor(harness);
  const enabledCount = models.filter((model) => isModelEnabled(model.id)).length;
  const [query, setQuery] = useState("");
  const filtered = models.filter((model) =>
    `${model.name} ${model.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );

  return (
    <AdvancedSettings
      id="enabled-models"
      settingIds={["enabled-models"]}
      title={
        <span className="provider-cli-model-heading">
          {t("Models")}{" "}
          <Badge size="sm">
            {enabledCount} / {models.length}
          </Badge>
        </span>
      }
    >
      <p className="mb-2 text-ui-caption text-(--ui-text-secondary)">
        {t("This machine · all projects")}
      </p>
      <SearchInput
        aria-label={t("Search models…")}
        appearance="field"
        placeholder={t("Search models…")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        containerClassName="mb-2"
      />
      {models.length > 0 && filtered.length === 0 ? (
        <p role="status" className="text-ui-caption text-(--ui-text-secondary)">
          {t("No matching models")}
        </p>
      ) : null}
      <div className="provider-cli-model-list">
        {models.length > 0 ? (
          filtered.map((model) => {
            const on = isModelEnabled(model.id);
            return (
              <Row
                key={model.id}
                label={model.name}
                dependency={
                  on && enabledCount <= 1
                    ? t("Keep one model enabled. Hide the provider to remove it from the picker.")
                    : undefined
                }
              >
                <Toggle
                  label={t("Use {p0}", { p0: model.name })}
                  on={on}
                  onChange={(next) => saveModelEnabled(model.id, next)}
                  // The last model stays on so the provider keeps a default.
                  disabled={on && enabledCount <= 1}
                />
              </Row>
            );
          })
        ) : (
          <Row
            label={
              isHarnessAvailable(harness) ? t("Loading models…") : t("Available after CLI setup")
            }
          />
        )}
      </div>
    </AdvancedSettings>
  );
}

/**
 * Lists every installed CLI with a release feed. The launch toast offers only
 * harnesses shown in the model picker and is gone once dismissed. Opening the
 * page runs no CLI: it shows the last check, and the button runs a new one.
 */
export function HarnessUpdatesGroup() {
  useLocale();
  const { checks, checking, runs, error } = useSyncExternalStore(
    subscribeHarnessUpdates,
    getHarnessUpdateSnapshot,
    getHarnessUpdateSnapshot,
  );

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

  const stateOf = (harness: HarnessId): HarnessUpdateRun => runs[harness] ?? { status: "idle" };
  // A harness updated earlier in this session can fall behind again when a
  // newer release ships, so only a running update is left out.
  const pending = pendingHarnessUpdates(checks ?? []).filter(
    (update) => stateOf(update.harness).status !== "updating",
  );
  const start = (targets: HarnessUpdate[]) => {
    for (const update of targets) void runHarnessUpdate(update);
  };

  return (
    <Group
      id="harness-updates"
      layout="full"
      title={t("CLI updates")}
      action={
        <div className="flex items-center gap-2">
          {pending.length > 1 ? (
            <Button className="shrink-0" onClick={() => start(pending)}>
              <ArrowDownCircle className="icon-sm text-accent" aria-hidden />
              {t("Update all")}
            </Button>
          ) : null}
          <Button
            className="shrink-0"
            onClick={() =>
              void checkInstalledHarnessVersions({ force: true }).catch(() => undefined)
            }
            disabled={checking}
            loading={checking}
            startIcon={<RefreshCw className="icon-sm" strokeWidth={1.75} aria-hidden />}
          >
            {t("Check for updates")}
          </Button>
        </div>
      }
    >
      {error ? (
        <SettingsFeedback state="error">
          {t("Could not check CLI updates: ")}
          {error}
        </SettingsFeedback>
      ) : null}
      {checking ? (
        <SettingsFeedback state="loading">{t("Checking installed CLIs…")}</SettingsFeedback>
      ) : null}
      {checks === null ? (
        <Row
          label={checking ? t("Checking installed CLIs…") : t("Not checked yet")}
          description={t(
            "Runs each installed CLI to read its version, then looks up the newest release.",
          )}
        />
      ) : checks.length === 0 && !error && !checking ? (
        <SettingsFeedback state="empty">
          {t("No CLIs to check")}. {t("None of the CLIs with a release feed are installed.")}
        </SettingsFeedback>
      ) : (
        <div className="provider-cli-updates">
          {[...checks]
            .sort(
              (a, b) =>
                Number(
                  b.status !== "current" ||
                    stateOf(b.harness).status === "failed" ||
                    stateOf(b.harness).status === "updating",
                ) -
                Number(
                  a.status !== "current" ||
                    stateOf(a.harness).status === "failed" ||
                    stateOf(a.harness).status === "updating",
                ),
            )
            .map((entry) => (
              <HarnessUpdateSettingsRow
                key={entry.harness}
                check={entry}
                state={stateOf(entry.harness)}
                onUpdate={(update) => start([update])}
              />
            ))}
        </div>
      )}
    </Group>
  );
}

export function HarnessUpdateSettingsRow({
  check,
  state,
  onUpdate,
}: {
  check: HarnessVersionCheck;
  state: HarnessUpdateRun;
  onUpdate: (update: HarnessUpdate) => void;
}) {
  useLocale();
  const title = HARNESS_TITLE[check.harness];
  const description =
    state.status === "failed"
      ? state.error
      : state.status === "updating"
        ? t("Updating…")
        : check.status === "behind"
          ? t("Version {p0} is available.", { p0: check.latest })
          : check.status === "unknown"
            ? t("Could not check: {p0}", { p0: check.error })
            : state.status === "updated"
              ? state.catalogRefresh === "failed"
                ? t("CLI updated to {p0}. Model refresh failed. Retry it in Providers.", {
                    p0: state.version,
                  })
                : state.catalogRefresh === "unchanged"
                  ? t(
                      "CLI updated to {p0}. The model list did not change, so it may be out of date.",
                      { p0: state.version },
                    )
                  : t("Updated to {p0}.", { p0: state.version })
              : t("Up to date.");

  return (
    <Row
      label={
        <span className="flex items-center gap-2">
          <HarnessIcon harness={check.harness} className="icon-md shrink-0" />
          {title}
          {check.status !== "unknown" ? (
            <span className="font-mono text-ui-caption text-(--ui-text-muted)">
              {check.installed}
            </span>
          ) : null}
        </span>
      }
      feedback={
        check.status === "current" && state.status === "idle" ? undefined : (
          <SettingsFeedback
            state={
              state.status === "failed"
                ? "error"
                : state.status === "updating"
                  ? "loading"
                  : state.status === "updated" &&
                      check.status === "current" &&
                      state.catalogRefresh === "fresh"
                    ? "success"
                    : "warning"
            }
          >
            {description}
          </SettingsFeedback>
        )
      }
    >
      {check.status === "behind" ? (
        <Button
          className="shrink-0"
          onClick={() => onUpdate(check)}
          disabled={state.status === "updating"}
          loading={state.status === "updating"}
          startIcon={<ArrowDownCircle className="icon-sm text-accent" aria-hidden />}
          aria-label={
            state.status === "failed"
              ? t("Retry updating {p0}", { p0: title })
              : t("Update {p0} to {p1}", { p0: title, p1: check.latest })
          }
        >
          {state.status === "failed" ? t("Retry") : t("Update")}
        </Button>
      ) : check.status === "current" && state.status === "idle" ? (
        <span className="inline-flex items-center gap-1.5 text-ui-caption text-(--ui-text-secondary)">
          <Check className="icon-md text-success" aria-hidden />
          {description}
        </span>
      ) : null}
    </Row>
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

/** Installed version and update action for the selected provider, on the identity row. */
function ProviderUpdateInline({ harness }: { harness: HarnessId }) {
  useLocale();
  const { checks, runs } = useSyncExternalStore(
    subscribeHarnessUpdates,
    getHarnessUpdateSnapshot,
    getHarnessUpdateSnapshot,
  );
  const check = checks?.find((entry) => entry.harness === harness);
  if (!check || check.status === "unknown") return null;
  const run: HarnessUpdateRun = runs[harness] ?? { status: "idle" };
  const title = HARNESS_TITLE[harness];
  if (check.status === "current" && run.status !== "failed" && run.status !== "updating") {
    return <span className="provider-cli-version font-mono">{check.installed}</span>;
  }
  return (
    <span className="provider-cli-update">
      <span className="provider-cli-version font-mono">{check.installed}</span>
      {check.status === "behind" ? (
        <>
          <span className="provider-cli-update-text" role={run.status === "failed" ? "alert" : undefined}>
            {run.status === "failed"
              ? run.error
              : run.status === "updating"
                ? t("Updating…")
                : t("Version {p0} is available.", { p0: check.latest })}
          </span>
          <Button
            size="sm"
            onClick={() => void runHarnessUpdate(check)}
            disabled={run.status === "updating"}
            loading={run.status === "updating"}
            startIcon={<ArrowDownCircle className="icon-sm text-accent" aria-hidden />}
            aria-label={
              run.status === "failed"
                ? t("Retry updating {p0}", { p0: title })
                : t("Update {p0} to {p1}", { p0: title, p1: check.latest })
            }
          >
            {run.status === "failed" ? t("Retry") : t("Update")}
          </Button>
        </>
      ) : null}
    </span>
  );
}

function ProviderCliHeader({ harness }: { harness: HarnessId }) {
  const available = isHarnessAvailable(harness);
  const models = modelsFor(harness);
  return (
    <div className="provider-cli-header">
      <div className="provider-cli-header-main">
        <HarnessIcon harness={harness} className="icon-md shrink-0" />
        <div className="provider-cli-header-copy">
          <div className="provider-cli-title-line">
            <h3>{HARNESS_TITLE[harness]}</h3>
            <span className="provider-cli-status">
              <span
                className={`size-1.5 rounded-full ${available ? "bg-success" : "bg-(--ui-text-muted)"}`}
                aria-hidden
              />
              {available
                ? t("CLI detected")
                : hasProbedHarnessAvailability()
                  ? t("CLI not found")
                  : t("Checking CLI…")}
              {available ? (
                <span className="text-(--ui-text-muted)">
                  · {models.length} {models.length === 1 ? t("model") : t("models")}
                </span>
              ) : null}
              <span
                className="provider-cli-machine"
                title={t(
                  "This machine · shared across projects. CLI detection does not confirm account sign-in.",
                )}
              >
                · {t("This machine · all projects")}
              </span>
            </span>
            {available ? <ProviderUpdateInline harness={harness} /> : null}
          </div>
        </div>
      </div>
      <AdvancedSettings
        id={`cli-path-${harness}`}
        settingIds={[`cli-path-${harness}`]}
        title={t("CLI path and installation")}
      >
        <ProviderBinaryControl key={harness} provider={harness} showLabel />
        {!available && hasProbedHarnessAvailability() ? (
          <section className="provider-cli-install">
            <h3>{t("Installation help")}</h3>
            <p>{harnessUnavailableHint(harness)}</p>
          </section>
        ) : null}
      </AdvancedSettings>
    </div>
  );
}

export function ProviderRow({
  harness,
  hideHeader = false,
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
  scopeLabel,
  scopeControl,
  projectScope = false,
  modelOverride,
  globalModel,
  onModelReset,
}: {
  harness: HarnessId;
  hideHeader?: boolean;
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
  /** Name of the scope the defaults below are written to (Global or a project). */
  scopeLabel?: string;
  /** Scope picker and reset action, shown with the defaults it controls. */
  scopeControl?: ReactNode;
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
  // Every other model control (fast, advisor, subagents, auto-compact…) can
  // also get a default for new conversations.
  const extras = current
    ? pickerSettings(current)
        .filter((setting) => setting.id !== effort?.id)
        .map((setting) =>
          offeredDelegationSetting(
            setting,
            models,
            scopeDefaults.extras?.[setting.id] ?? inheritedDefaults?.extras?.[setting.id],
          ),
        )
    : [];

  useEffect(() => {
    if (!isSelected || !available || hasLiveCatalog(harness)) return;
    void refreshProviderCatalog(harness);
  }, [available, harness, isSelected]);

  return (
    <>
      <article
        className="provider-cli-card"
        aria-label={t("{p0} CLI settings", { p0: HARNESS_TITLE[harness] })}
        data-default={isDefault || undefined}
      >
        {!hideHeader ? <ProviderCliHeader harness={harness} /> : null}
        <section className="provider-cli-defaults" aria-label={t("New conversation defaults")}>
          <div className="provider-cli-defaults-heading">
            <div className="provider-cli-defaults-title">
              <h4>{t("New conversation defaults")}</h4>
              {scopeLabel ? (
                <span className="provider-cli-defaults-scope">{scopeLabel}</span>
              ) : null}
            </div>
            {scopeControl}
            <p className="provider-cli-defaults-help">
              {projectScope
                ? t("Fields left on Global follow the global defaults. Existing conversations keep their settings.")
                : t("Applies to new conversations. Existing conversations keep their settings.")}
            </p>
          </div>
          <div className="provider-cli-fields">
            {current ? (
              <div className="provider-cli-field">
                <span>{t("Model")}</span>
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
                {projectScope ? (
                  <p className="provider-cli-model-scope text-ui-micro text-(--ui-text-muted)">
                    {modelOverride ? (
                      <>
                        {t("Project override. Global: {p0}", {
                          p0: modelDisplayName(harness, globalModel),
                        })}
                        {onModelReset ? (
                          <Button size="sm" variant="ghost" onClick={onModelReset}>
                            {t("Use global model")}
                          </Button>
                        ) : null}
                      </>
                    ) : (
                      t("Follows the global model")
                    )}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="provider-cli-field">
                <span>{t("Model")}</span>
                <p className="py-1 text-ui-caption text-(--ui-text-muted)">
                  {available ? t("Loading models…") : t("Available after CLI setup")}
                </p>
              </div>
            )}
            {effort ? (
              <div className="provider-cli-field">
                <span>{t("Effort")}</span>
                <Select
                  label={t("{p0} default effort", { p0: HARNESS_TITLE[harness] })}
                  value={scopeDefaults.effort && validEffort ? scopeDefaults.effort : ""}
                  options={[
                    {
                      value: "",
                      label: inheritedDefaults?.effort
                        ? `${t("Global")} (${t(effort.options.find((option) => option.value === inheritedDefaults.effort)?.label ?? inheritedDefaults.effort)}${validInheritedEffort ? "" : ` · ${t("Unavailable")}`})`
                        : t("Automatic"),
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
              </div>
            ) : null}
            <div className="provider-cli-field">
              <span>{t("Permissions")}</span>
              <Select
                label={t("{p0} default permissions", { p0: HARNESS_TITLE[harness] })}
                value={scopeDefaults.runtimeMode ?? ""}
                options={[
                  {
                    value: "",
                    label: inheritedRuntimeMode
                      ? `${t("Global")} (${t(RUNTIME_MODE_LABEL[inheritedRuntimeMode])}${validInheritedRuntimeMode ? "" : ` · ${t("Unavailable")}`})`
                      : t("Automatic"),
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
                  ...RUNTIME_MODES.filter(
                    (mode) => !runtimeModeUnavailableReason(harness, mode),
                  ).map((mode) => ({ value: mode, label: t(RUNTIME_MODE_LABEL[mode]) })),
                ]}
                onChange={(next) =>
                  onSessionDefaultsChange?.({
                    ...scopeDefaults,
                    runtimeMode: (next || undefined) as RuntimeMode | undefined,
                  })
                }
              />
            </div>
            {onSessionDefaultsChange ? (
              <>
                {extras.map((setting) => {
                  const saved = scopeDefaults.extras?.[setting.id];
                  const inherited = inheritedDefaults?.extras?.[setting.id];
                  const inheritedOption = setting.options.find(
                    (option) => option.value === inherited,
                  );
                  const inheritedLabel = inheritedOption?.label ?? inherited;
                  const savedIsUnavailable =
                    Boolean(saved) && !setting.options.some((option) => option.value === saved);
                  return (
                    <div key={setting.id} className="provider-cli-field">
                      <span>{t(setting.label)}</span>
                      <Select
                        label={t("{p0} default {p1}", {
                          p0: HARNESS_TITLE[harness],
                          p1: t(setting.label),
                        })}
                        value={saved ?? ""}
                        options={[
                          {
                            value: "",
                            label: inheritedLabel
                              ? `${t("Global")} (${t(inheritedLabel)}${inheritedOption ? "" : ` · ${t("Unavailable")}`})`
                              : t("Automatic"),
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
                    </div>
                  );
                })}
              </>
            ) : null}
          </div>
          <CatalogReceiptStatus harness={harness} available={available} />
        </section>
        <div className="provider-cli-footer">
          <Button
            className="shrink-0"
            aria-label={
              isDefault
                ? t("{p0} is the default provider", { p0: HARNESS_TITLE[harness] })
                : t("Use {p0} by default", { p0: HARNESS_TITLE[harness] })
            }
            onClick={() => current && onDefault(harness, current.id)}
            disabled={isDefault || !current}
          >
            {isDefault ? <Check className="icon-sm" /> : null}
            {isDefault ? t("Default provider") : t("Use by default")}
          </Button>
          {available ? (
            <div className="flex items-center gap-2">
              <span className="text-ui-micro text-(--ui-text-secondary)">
                {pickerLocked ? t("Hidden globally") : t("Show in picker")}
              </span>
              <Toggle
                label={t("Show {p0} in the model picker", { p0: HARNESS_TITLE[harness] })}
                on={inPicker}
                onChange={onPickerVisible}
                disabled={pickerLocked}
              />
            </div>
          ) : (
            <span className="text-ui-micro text-(--ui-text-muted)">{t("Not in picker")}</span>
          )}
        </div>
      </article>
      {isSelected ? <EnabledModelsGroup harness={harness} /> : null}
      {isSelected && harness === "claude" && onClaudeHooksChange ? (
        <Row
          id="claude-hooks"
          label={t("Claude Code hooks")}
          description={t("Configured hooks run on the next turn.")}
        >
          <Toggle label={t("Claude Code hooks")} on={claudeHooks} onChange={onClaudeHooksChange} />
        </Row>
      ) : null}
    </>
  );
}
