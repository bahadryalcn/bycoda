import { projectDisplayName } from "../../projects/model/projectNames";
import { t, useLocale, getLocale } from "../../../shared/i18n";
import { ArrowDownCircle, Check, Globe, Loader, RefreshCw } from "../../../shared/ui/icons";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import "./ProviderSettings.css";

import { SecondaryButton } from "../../../shared/ui/SecondaryButton";

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
import { loadClaudeHooks, saveClaudeHooks } from "../model/settings";

import { Group, Row, Toggle, Select } from "./settingsControls";
import { GLOBAL_PROVIDER_SCOPE, ProviderBinaryControl } from "./ProviderBinarySettings";
import { ProviderAccountsSettings } from "./ProviderAccountsSettings";

export function ProvidersPage({ cwd, recents }: { cwd?: string; recents?: RecentProject[] }) {
  useLocale();
  useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
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
  const [claudeHooks, setClaudeHooks] = useState(loadClaudeHooks);
  const [scope, setScope] = useState<string>(GLOBAL_PROVIDER_SCOPE);
  const [hiddenGlobally, setHiddenGlobally] = useState(loadHiddenPickerProviders);

  const scopeOptions = useMemo(() => {
    const options: { value: string; label: string; icon?: ReactNode }[] = [
      {
        value: GLOBAL_PROVIDER_SCOPE,
        get label() {
          return t("Global");
        },
        icon: <Globe className="size-3.5 shrink-0 text-content/60" strokeWidth={1.75} />,
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

  return (
    <>
      <Group
        id="agent-clis"
        layout="full"
        title={t("Agent CLIs")}
        action={
          <div className="provider-cli-scope">
            <span className="text-[11px] text-content/60">{t("Apply defaults to")}</span>
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
            : t(
                "Choose the default model, effort and permissions for new conversations. CLIs not found on your PATH are left out of the picker.",
              )
        }
      >
        <div className="provider-cli-grid">
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
              <ProviderRow
                key={harness}
                harness={harness}
                selectedModel={selectedModel}
                isDefault={isDefault}
                inPicker={inPicker}
                pickerLocked={pickerLocked}
                sessionDefaults={providerSessionDefaults(harness, project ?? undefined)}
                inheritedDefaults={project ? providerSessionDefaults(harness) : undefined}
                scopeDefaults={
                  project ? projectSettings.defaults?.[harness] : providerSessionDefaults(harness)
                }
                onSessionDefaultsChange={(next) =>
                  project
                    ? setProjectSessionDefaults(project, harness, next)
                    : saveGlobalSessionDefaults(harness, next)
                }
                onDefault={onDefault}
                onModelChange={onModelChange}
                onPickerVisible={(visible) => onPickerVisible(harness, visible)}
              />
            );
          })}
        </div>
      </Group>

      <ProviderAccountsSettings />

      <EnabledModelsGroup />

      <HarnessUpdatesGroup />

      <Group title={t("Claude Code hooks")}>
        <Row
          id="claude-hooks"
          label={t("Claude Code hooks")}
          description={t(
            "Run the hooks configured in your settings.json files — PreToolUse command rewrites, blocks, notifications, and the rest — just as the Claude Code CLI would. Turn this off if a hook is misbehaving and you need the session back. Takes effect on the next turn.",
          )}
        >
          <Toggle label={t("Claude Code hooks")} on={claudeHooks} onChange={onClaudeHooks} />
        </Row>
      </Group>
    </>
  );
}

/** Per-model switches: a model turned off is never offered or picked by default. */
export function EnabledModelsGroup() {
  useLocale();
  const harnesses = HARNESSES.filter(
    (harness) => isHarnessAvailable(harness) && catalogModelsFor(harness).length > 0,
  );
  const [selected, setSelected] = useState<HarnessId | null>(null);
  const harness = selected && harnesses.includes(selected) ? selected : harnesses[0];
  if (!harness) return null;

  const models = catalogModelsFor(harness);
  const enabledCount = models.filter((model) => isModelEnabled(model.id)).length;

  return (
    <Group
      id="enabled-models"
      title={t("Models")}
      description={t(
        "Models that are off are hidden from every picker and never chosen by default. Existing conversations keep theirs.",
      )}
      action={
        <Select
          label={t("Provider")}
          value={harness}
          options={harnesses.map((id) => ({
            value: id,
            label: HARNESS_TITLE[id],
            icon: <HarnessIcon harness={id} className="size-3.5 shrink-0" />,
          }))}
          onChange={(next) => setSelected(next as HarnessId)}
        />
      }
    >
      <div className="max-h-[360px] overflow-y-auto">
        {models.map((model) => {
          const on = isModelEnabled(model.id);
          return (
            <Row
              key={model.id}
              label={model.name}
              description={
                [model.provider?.name, model.nativeId].filter(Boolean).join(" · ") || undefined
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
        })}
      </div>
    </Group>
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
      title={t("CLI updates")}
      description={t(
        "Compares installed CLIs with their newest release. Hermes Agent and Antigravity have no release feed and are not listed.",
      )}
      action={
        <div className="flex items-center gap-2">
          {pending.length > 1 ? (
            <SecondaryButton onClick={() => start(pending)}>
              <ArrowDownCircle className="size-3.5 text-accent" aria-hidden />
              {t("Update all")}
            </SecondaryButton>
          ) : null}
          <SecondaryButton
            onClick={() =>
              void checkInstalledHarnessVersions({ force: true }).catch(() => undefined)
            }
            disabled={checking}
          >
            {checking ? (
              <Loader className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-3.5" strokeWidth={1.75} aria-hidden />
            )}
            {t("Check for updates")}
          </SecondaryButton>
        </div>
      }
    >
      {error ? (
        <p role="alert" className="px-4 py-2 text-[12px] text-red-400">
          {t("Could not check CLI updates: ")}
          {error}
        </p>
      ) : null}
      {checks === null ? (
        <Row
          label={checking ? t("Checking installed CLIs…") : t("Not checked yet")}
          description={t(
            "Runs each installed CLI to read its version, then looks up the newest release.",
          )}
        />
      ) : checks.length === 0 ? (
        <Row
          label={t("No CLIs to check")}
          description={t("None of the CLIs with a release feed are installed.")}
        />
      ) : (
        <div className="max-h-[360px] overflow-y-auto">
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
    check.status === "unknown"
      ? `Could not check: ${check.error}`
      : check.status === "current"
        ? state.status === "updated"
          ? `Updated to ${state.version}.`
          : "Up to date."
        : state.status === "updating"
          ? "Updating…"
          : state.status === "failed"
            ? state.error
            : `Version ${check.latest} is available.`;

  return (
    <Row
      label={
        <span className="flex items-center gap-2">
          <HarnessIcon harness={check.harness} className="size-4 shrink-0" />
          {title}
          {check.status !== "unknown" ? (
            <span className="font-mono text-[12px] text-content/45">{check.installed}</span>
          ) : null}
        </span>
      }
      description={description}
    >
      {check.status === "behind" ? (
        <SecondaryButton
          onClick={() => onUpdate(check)}
          disabled={state.status === "updating"}
          aria-label={
            state.status === "failed"
              ? t("Retry updating {p0}", { p0: title })
              : t("Update {p0} to {p1}", { p0: title, p1: check.latest })
          }
        >
          {state.status === "updating" ? (
            <Loader className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <ArrowDownCircle className="size-3.5 text-accent" aria-hidden />
          )}
          {state.status === "failed" ? t("Retry") : t("Update")}
        </SecondaryButton>
      ) : check.status === "current" ? (
        <Check className="size-4 text-emerald-400" aria-hidden />
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
      <ProjectLogoIcon path={logoPath} className="size-4 rounded-sm" imageClassName="size-4" />
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

export function ProviderRow({
  harness,
  selectedModel,
  isDefault,
  inPicker,
  pickerLocked = false,
  onDefault,
  onModelChange,
  onPickerVisible,
  sessionDefaults = {},
  inheritedDefaults,
  scopeDefaults = {},
  onSessionDefaultsChange,
}: {
  harness: HarnessId;
  selectedModel: string;
  isDefault: boolean;
  inPicker: boolean;
  /** Globally hidden providers cannot be turned on per project. */
  pickerLocked?: boolean;
  onDefault: (harness: HarnessId, model: string) => void;
  onModelChange: (harness: HarnessId, model: string) => void;
  onPickerVisible: (visible: boolean) => void;
  sessionDefaults?: ProviderSessionDefaults;
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
  const validEffort = effort?.options.some((option) => option.value === sessionDefaults.effort);
  // Every other model control (fast, advisor, subagents, auto-compact…) can
  // also get a default for new conversations.
  const extras = current
    ? pickerSettings(current)
        .filter((setting) => setting.id !== effort?.id)
        .map((setting) => offeredDelegationSetting(setting, models))
    : [];
  const extrasSet = extras.filter((setting) => scopeDefaults.extras?.[setting.id]).length;

  useEffect(() => {
    if (!available || hasLiveCatalog(harness)) return;
    void refreshHarnessCatalogs([harness]);
  }, [available, harness]);

  return (
    <article
      className="provider-cli-card"
      aria-label={t("{p0} CLI settings", { p0: HARNESS_TITLE[harness] })}
      data-default={isDefault || undefined}
    >
      <div className="provider-cli-header">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-content/10 bg-content/5">
            <HarnessIcon harness={harness} className="size-4 shrink-0" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-content">
              {harness === "gemini"
                ? t("Gemini CLI (enterprise / API key)")
                : HARNESS_TITLE[harness]}
            </h3>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-content/60">
              <span
                className={`size-1.5 rounded-full ${available ? "bg-emerald-400" : "bg-content/30"}`}
              />
              {available
                ? t("CLI detected")
                : hasProbedHarnessAvailability()
                  ? t("CLI not found")
                  : t("Checking CLI…")}
              {available ? (
                <span className="text-content/45">
                  · {models.length} {models.length === 1 ? t("model") : t("models")}
                </span>
              ) : null}
            </span>
          </div>
        </div>
        <ProviderBinaryControl provider={harness} showLabel />
      </div>
      {!available && hasProbedHarnessAvailability() ? (
        <details className="provider-cli-install">
          <summary>{t("Installation help")}</summary>
          <p>{harnessUnavailableHint(harness)}</p>
        </details>
      ) : null}
      <div className="provider-cli-fields">
        {current ? (
          <div className="provider-cli-field">
            <span>{t("Model")}</span>
            <Select
              label={t("{p0} model", { p0: HARNESS_TITLE[harness] })}
              onOpen={() => {
                void refreshHarnessCatalogs([harness], { force: true });
              }}
              value={current.id}
              onChange={(next) => onModelChange(harness, next)}
              options={models.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
            />
          </div>
        ) : (
          <div className="provider-cli-field">
            <span>{t("Model")}</span>
            <p className="py-1 text-[12px] text-content/45">
              {available ? t("Loading models…") : t("Available after CLI setup")}
            </p>
          </div>
        )}
        {onSessionDefaultsChange ? (
          <>
            {effort ? (
              <div className="provider-cli-field">
                <span>{t("Effort")}</span>
                <Select
                  label={t("{p0} default effort", { p0: HARNESS_TITLE[harness] })}
                  value={scopeDefaults.effort && validEffort ? scopeDefaults.effort : ""}
                  options={[
                    {
                      value: "",
                      label: inheritedDefaults
                        ? `Global (${inheritedDefaults.effort ?? "automatic"})`
                        : "Automatic",
                    },
                    ...effort.options,
                  ]}
                  onChange={(next) =>
                    onSessionDefaultsChange({
                      ...scopeDefaults,
                      effort: next || undefined,
                    })
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
                    label: inheritedDefaults
                      ? `Global (${inheritedDefaults.runtimeMode ? RUNTIME_MODE_LABEL[inheritedDefaults.runtimeMode] : "inherit"})`
                      : "Inherit / Supervised",
                  },
                  ...RUNTIME_MODES.filter(
                    (mode) => !runtimeModeUnavailableReason(harness, mode),
                  ).map((mode) => ({
                    value: mode,
                    label: RUNTIME_MODE_LABEL[mode],
                  })),
                ]}
                onChange={(next) =>
                  onSessionDefaultsChange({
                    ...scopeDefaults,
                    runtimeMode: (next || undefined) as RuntimeMode | undefined,
                  })
                }
              />
            </div>
          </>
        ) : null}
      </div>
      {onSessionDefaultsChange && extras.length > 0 ? (
        <details className="provider-cli-install provider-cli-extras">
          <summary>
            {extrasSet > 0
              ? t("Default extras ({p0} set)", { p0: String(extrasSet) })
              : t("Default extras")}
          </summary>
          <div className="provider-cli-fields">
            {extras.map((setting) => {
              const saved = scopeDefaults.extras?.[setting.id];
              const inherited = inheritedDefaults?.extras?.[setting.id];
              const optionLabel = (value: string | undefined) =>
                t(
                  setting.options.find((option) => option.value === value)?.label ??
                    "Model default",
                );
              return (
                <div key={setting.id} className="provider-cli-field">
                  <span>{t(setting.label)}</span>
                  <Select
                    label={t("{p0} default {p1}", {
                      p0: HARNESS_TITLE[harness],
                      p1: t(setting.label),
                    })}
                    value={
                      saved && setting.options.some((option) => option.value === saved) ? saved : ""
                    }
                    options={[
                      {
                        value: "",
                        label: inheritedDefaults
                          ? `${t("Global")} (${optionLabel(inherited)})`
                          : t("Model default"),
                      },
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
          </div>
        </details>
      ) : null}
      <div className="provider-cli-footer">
        <SecondaryButton
          aria-label={
            isDefault
              ? t("{p0} is the default provider", { p0: HARNESS_TITLE[harness] })
              : t("Use {p0} by default", { p0: HARNESS_TITLE[harness] })
          }
          onClick={() => current && onDefault(harness, current.id)}
          disabled={isDefault || !current}
        >
          {isDefault ? <Check className="size-3.5" /> : null}
          {isDefault ? t("Default") : t("Use by default")}
        </SecondaryButton>
        {available ? (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-content/60">
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
          <span className="text-[11px] text-content/45">{t("Not in picker")}</span>
        )}
      </div>
    </article>
  );
}
