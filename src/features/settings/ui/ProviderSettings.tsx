import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SettingsFeedback } from "./settingsControls";
import { Badge } from "../../../shared/ui/Badge";
import { projectDisplayName } from "../../projects/model/projectNames";
import { t, useLocale, getLocale } from "../../../shared/i18n";
import { ArrowDownCircle, Check, Globe, Loader, RefreshCw } from "../../../shared/ui/icons";
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

import { refreshHarnessCatalogs } from "../../../integrations/harness/core/registry";

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
  loadProjectProviderSettings,
  projectProvidersRevision,
  setProjectDefaultModel,
  setProjectDefaultProvider,
  setProjectProviderHidden,
  subscribeProjectProviders,
  setProjectSessionDefaults,
  type ProviderSessionDefaults,
} from "../../sessions/model/projectProviders";
import {
  providerSessionDefaults,
  providerSessionDefaultsSnapshot,
  saveGlobalSessionDefaults,
  subscribeProviderSessionDefaults,
} from "../../sessions/model/providerSessionDefaults";

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
  const [claudeHooks, setClaudeHooks] = useStoredPreferenceState(loadClaudeHooks, subscribeClaudeHooks);
  const [scope, setScope] = useState<string>(GLOBAL_PROVIDER_SCOPE);
  const [hiddenGlobally, setHiddenGlobally] = useStoredPreferenceState(loadHiddenPickerProviders, subscribePickerVisibility);
  const [selectedProvider, setSelectedProvider] = useState<HarnessId | null>(
    () => loadLastModelChoice()?.harness ?? null,
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
    if (!scopeOptions.some((option) => option.value === scope)) {
      setScope(GLOBAL_PROVIDER_SCOPE);
    }
  }, [scope, scopeOptions]);

  const onClaudeHooks = (next: boolean) => {
    saveClaudeHooks(next);
    setClaudeHooks(next);
  };

  const onModelChange = (harness: HarnessId, model: string) => {
    if (project) {
      setProjectDefaultModel(project, harness, model);
      return;
    }
    saveDefaultModel(harness, model);
    setDefaultModels((prev) => ({ ...prev, [harness]: model }));
    if (choice?.harness === harness) {
      saveLastModelChoice(harness, model);
      setChoice({ harness, model });
    }
  };

  const onDefault = (harness: HarnessId, model: string) => {
    if (project) {
      setProjectDefaultProvider(project, harness, model);
      return;
    }
    saveLastModelChoice(harness, model);
    setDefaultModels((prev) => ({ ...prev, [harness]: model }));
    setChoice({ harness, model });
  };

  const onPickerVisible = (harness: HarnessId, visible: boolean) => {
    if (project) {
      setProjectProviderHidden(project, harness, !visible);
      return;
    }
    savePickerProviderVisible(harness, visible);
    setHiddenGlobally((prev) =>
      visible ? prev.filter((id) => id !== harness) : [...new Set([...prev, harness])],
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
  }, [revealedSetting, modelsVersion, activeProvider]);

  return (
    <>
      <Group
        id="agent-clis"
        layout="full"
        title={t("Providers and model defaults")}
        persistence={{ mode: "automatic" }}
        action={
          <div className="provider-cli-scope">
            <span className="text-ui-micro text-(--ui-text-secondary)">{t("Apply defaults to")}</span>
            <Select
              label={t("Provider defaults scope")}
              value={scope}
              options={scopeOptions}
              onChange={setScope}
            />
          </div>
        }
        description={
          project
            ? t("Defaults for {p0} only. CLI paths stay global.", {
                p0: projectDisplayName(project),
              })
            : undefined
        }
      >
        <div className="provider-cli-workspace">
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
              return (
                <Button
                  key={harness}
                  variant="item"
                  selected={selected}
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
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  onClick={() => setSelectedProvider(harness)}
                >
                  <HarnessIcon harness={harness} className="icon-md shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{HARNESS_TITLE[harness]}</span>
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
            <ProviderAccountsSettings harness={activeProvider ?? undefined} />
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
                    onSessionDefaultsChange={(next) =>
                      project
                        ? setProjectSessionDefaults(project, harness, next)
                        : saveGlobalSessionDefaults(harness, next)
                    }
                    onDefault={onDefault}
                    onModelChange={onModelChange}
                    onPickerVisible={(visible) => onPickerVisible(harness, visible)}
                    isSelected={activeProvider === harness}
                    claudeHooks={claudeHooks}
                    onClaudeHooksChange={onClaudeHooks}
                  />
                  {harness === "acp" ? <GenericAcpSettings cwd={cwd} embedded /> : null}
                </div>
              );
            })}
          </div>
        </div>
      </Group>

      <HarnessUpdatesGroup />
    </>
  );
}

/** Per-model switches: a model turned off is never offered or picked by default. */
export function EnabledModelsGroup({ harness }: { harness: HarnessId }) {
  useLocale();
  const models = catalogModelsFor(harness);
  const enabledCount = models.filter((model) => isModelEnabled(model.id)).length;

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
      <div className="provider-cli-model-list">
        {models.length > 0 ? (
          models.map((model) => {
            const on = isModelEnabled(model.id);
            return (
              <Row key={model.id} label={model.name}>
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
          >
            {checking ? (
              <Loader className="icon-sm animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="icon-sm" strokeWidth={1.75} aria-hidden />
            )}
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
          {checks.map((entry) => (
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
        : state.status === "updated"
          ? t("Updated to {p0}.", { p0: state.version })
          : check.status === "unknown"
            ? t("Could not check: {p0}", { p0: check.error })
            : check.status === "current"
              ? t("Up to date.")
              : t("Version {p0} is available.", { p0: check.latest });

  return (
    <Row
      label={
        <span className="flex items-center gap-2">
          <HarnessIcon harness={check.harness} className="icon-md shrink-0" />
          {title}
          {check.status !== "unknown" ? (
            <span className="font-mono text-ui-caption text-(--ui-text-muted)">{check.installed}</span>
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
                  : state.status === "updated"
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
          aria-label={
            state.status === "failed"
              ? t("Retry updating {p0}", { p0: title })
              : t("Update {p0} to {p1}", { p0: title, p1: check.latest })
          }
        >
          {state.status === "updating" ? (
            <Loader className="icon-sm animate-spin" aria-hidden />
          ) : (
            <ArrowDownCircle className="icon-sm text-accent" aria-hidden />
          )}
          {state.status === "failed" ? t("Retry") : t("Update")}
        </Button>
      ) : check.status === "current" ? (
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
          </div>
        </div>
      </div>
      <AdvancedSettings
        id={`cli-path-${harness}`}
        settingIds={[`cli-path-${harness}`]}
        title={t("CLI path and installation")}
      >
        <ProviderBinaryControl provider={harness} showLabel />
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
    if (!available || hasLiveCatalog(harness)) return;
    void refreshHarnessCatalogs([harness]);
  }, [available, harness]);

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
            <h4
              title={t("Applies to new conversations. Existing conversations keep their settings.")}
            >
              {t("New conversation defaults")}
            </h4>
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
                        void refreshHarnessCatalogs([harness], { force: true });
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
