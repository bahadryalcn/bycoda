import { getGroupLockView } from "../../group-lock/model/groupLock";
import { isProjectLockedIn } from "../../group-lock/model/lockState";
import {
  HARNESSES,
  runtimeModeUnavailableReason,
  type HarnessId,
  type RuntimeMode,
} from "./session";
import {
  catalogModelsFor,
  getModelSnapshot,
  isEnabledChoice,
  loadDefaultModels,
  loadLastModelChoice,
  modelEffortSetting,
  saveDefaultModel,
  saveLastModelChoice,
  type AgentModel,
} from "./models";
import {
  loadPromptTemplates,
  savePromptTemplates,
  normalizeTrigger,
  validatePromptTemplates,
  type PromptTemplate,
} from "./promptTemplates";
import {
  loadProjectProviderSettings,
  normalizeProviderDefaults,
  resetProjectSessionPreferences,
  setProjectDefaultModel,
  setProjectDefaultProvider,
  setProjectSessionDefaults,
  type ProviderSessionDefaults,
} from "./projectProviders";
import { loadGlobalSessionDefaults, saveGlobalSessionDefaults } from "./providerSessionDefaults";

export type DesktopPreferencesContext = {
  environmentId: string;
  sourceSessionId: string;
  projectCwd: string;
  workingCwd: string;
  valid: () => boolean;
};
export type PreferenceModel = {
  id: string;
  name: string;
  settings: {
    id: string;
    label: string;
    options: { value: string; label: string }[];
    effort: boolean;
  }[];
};
export type DesktopPreferencesSnapshot = Omit<DesktopPreferencesContext, "valid"> & {
  revision: string;
  atomic: false;
  templates: { id: string; name: string; trigger?: string; preview: string }[];
  providers: {
    id: HarnessId;
    models: PreferenceModel[];
    runtimeModes: RuntimeMode[];
    globalModel?: string;
    projectModel?: string;
    globalDefaults: ProviderSessionDefaults;
    projectDefaults: ProviderSessionDefaults;
    unsupportedDefaults: number;
    hidden: boolean;
  }[];
  globalProvider?: HarnessId;
  projectProvider?: HarnessId;
};
export type DesktopPreferencesStatus = {
  state: "unknown" | "applied" | "failed";
  snapshot?: DesktopPreferencesSnapshot;
  message?: string;
};
export type DesktopTemplateDetail = { revision: string; template: PromptTemplate };
type Deps = {
  hash: (value: string) => Promise<string>;
  salt: () => string;
  catalog: (harness: HarnessId) => AgentModel[];
  catalogRevision: () => number;
};
const defaults: Deps = {
  salt: () => crypto.randomUUID(),
  catalog: catalogModelsFor,
  catalogRevision: getModelSnapshot,
  hash: async (value) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join(""),
};
const KEYS = [
  "bycoda.promptTemplates",
  "bycoda.projectProviderSettings.v1",
  "bycoda.providerSessionDefaults.v1",
  "bycoda.defaultModels",
  "bycoda.lastModel",
  "bycoda.disabledModels",
  "bycoda.hiddenPickerProviders",
];
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\0\r\n]/.test(value);
const exact = (input: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(input).some((key) => !keys.includes(key)))
    throw new Error("Unsupported preference field");
};
const modes: RuntimeMode[] = ["supervised", "auto-accept-edits", "auto", "full-access"];
function rawMetadata() {
  const raw = JSON.stringify(
    KEYS.map((key) => {
      const value = localStorage.getItem(key);
      if (value && value.length > 3 * 1024 * 1024)
        throw new Error("Preferences exceed review budget");
      if (value !== null) {
        const parsed: unknown = JSON.parse(value);
        if (!record(parsed) && !Array.isArray(parsed))
          throw new Error("Invalid desktop preferences");
      }
      return [key, value];
    }),
  );
  if (raw.length > 5 * 1024 * 1024) throw new Error("Preferences exceed review budget");
  return raw;
}
const privacy = () => {
  const lock = getGroupLockView().lock;
  return JSON.stringify([[...lock.lockedGroupIds].sort(), [...lock.lockedProjectKeys].sort()]);
};
function safeDefaults(
  value: ProviderSessionDefaults | undefined,
  model: PreferenceModel | undefined,
  allowed: RuntimeMode[],
) {
  const safe: ProviderSessionDefaults = {};
  let unsupported = 0;
  if (value?.runtimeMode) {
    if (allowed.includes(value.runtimeMode)) safe.runtimeMode = value.runtimeMode;
    else unsupported++;
  }
  if (value?.effort) {
    if (
      model?.settings.some(
        (setting) =>
          setting.effort && setting.options.some((option) => option.value === value.effort),
      )
    )
      safe.effort = value.effort;
    else unsupported++;
  }
  for (const [key, val] of Object.entries(value?.extras ?? {})) {
    if (
      model?.settings.some(
        (setting) =>
          !setting.effort &&
          setting.id === key &&
          setting.options.some((option) => option.value === val),
      )
    )
      (safe.extras ??= {})[key] = val;
    else unsupported++;
  }
  return { safe, unsupported };
}

/** Canonical desktop preference owners, with optimistic review guards rather than cross-window CAS. */
export function createDesktopPreferencesControl(overrides: Partial<Deps> = {}) {
  const deps = { ...defaults, ...overrides };
  const salt = deps.salt();
  const receipts = new Map<
    string,
    { scope: string; signature: string; status: DesktopPreferencesStatus }
  >();
  const scope = (context: DesktopPreferencesContext) =>
    JSON.stringify([
      context.environmentId,
      context.sourceSessionId,
      context.projectCwd,
      context.workingCwd,
    ]);
  const assert = (context: DesktopPreferencesContext) => {
    const lock = getGroupLockView().lock;
    if (
      !context.valid() ||
      context.projectCwd.startsWith("remote://") ||
      context.workingCwd.startsWith("remote://") ||
      isProjectLockedIn(lock, context.projectCwd) ||
      isProjectLockedIn(lock, context.workingCwd)
    )
      throw new Error("Desktop preference source is unavailable or private");
  };
  const capture = async (context: DesktopPreferencesContext) => {
    assert(context);
    const raw = rawMetadata();
    const lock = privacy();
    const catalogRevision = deps.catalogRevision();
    const templates = loadPromptTemplates();
    const project = loadProjectProviderSettings(context.projectCwd);
    const globals = loadGlobalSessionDefaults();
    const globalModels = loadDefaultModels();
    const providers = HARNESSES.map((harness) => {
      const catalog = deps.catalog(harness);
      if (catalog.length > 500) throw new Error("Model catalog exceeds review budget");
      const models = catalog
        .filter((model) => isEnabledChoice(harness, model.id))
        .map((model) => {
          if (model.settings && model.settings.length > 50)
            throw new Error("Model settings exceed review budget");
          return {
            id: model.id,
            name: model.name,
            settings: (model.settings ?? []).map((setting) => {
              if (setting.options.length > 100)
                throw new Error("Model options exceed review budget");
              return {
                id: setting.id,
                label: setting.label,
                options: setting.options.map(({ value, label }) => ({ value, label })),
                effort: modelEffortSetting(model)?.id === setting.id,
              };
            }),
          };
        });
      const allowed = modes.filter((mode) => !runtimeModeUnavailableReason(harness, mode));
      const globalModel = models.find((model) => model.id === globalModels[harness])?.id;
      const projectModel = models.find(
        (model) =>
          model.id ===
          (project.models?.[harness] ??
            (project.defaultHarness === harness ? project.defaultModel : undefined)),
      )?.id;
      const globalDefaults = safeDefaults(
        globals[harness],
        models.find((model) => model.id === globalModel) ?? models[0],
        allowed,
      );
      const projectDefaults = safeDefaults(
        project.defaults?.[harness],
        models.find((model) => model.id === (projectModel ?? globalModel)) ?? models[0],
        allowed,
      );
      return {
        id: harness,
        models,
        runtimeModes: allowed,
        globalModel,
        projectModel,
        globalDefaults: globalDefaults.safe,
        projectDefaults: projectDefaults.safe,
        unsupportedDefaults: globalDefaults.unsupported + projectDefaults.unsupported,
        hidden: !!project.hidden?.includes(harness),
      };
    });
    const projection = {
      templates: templates.map(({ id, name, trigger, body }) => ({
        id,
        name,
        trigger,
        preview: body.slice(0, 160),
      })),
      providers,
      globalProvider: loadLastModelChoice()?.harness,
      projectProvider: project.defaultHarness,
    };
    if (JSON.stringify(projection).length > 2 * 1024 * 1024)
      throw new Error("Preferences exceed response budget");
    const revision = await deps.hash(
      JSON.stringify([salt, scope(context), raw, lock, catalogRevision, projection]),
    );
    assert(context);
    if (rawMetadata() !== raw || privacy() !== lock || deps.catalogRevision() !== catalogRevision)
      throw new Error("Desktop preferences changed; refresh the review");
    const { valid: _valid, ...identity } = context;
    return {
      snapshot: {
        ...identity,
        revision,
        atomic: false,
        ...projection,
      } as DesktopPreferencesSnapshot,
      raw,
      lock,
      catalogRevision,
      templates,
    };
  };
  const currentStatus = async (
    context: DesktopPreferencesContext,
    status: DesktopPreferencesStatus,
  ) => (status.snapshot ? { ...status, snapshot: (await capture(context)).snapshot } : status);
  return async (
    context: DesktopPreferencesContext,
    action: string,
    input: Record<string, unknown>,
  ): Promise<DesktopPreferencesSnapshot | DesktopPreferencesStatus | DesktopTemplateDetail> => {
    assert(context);
    if (action === "preferences.read") {
      exact(input, []);
      return (await capture(context)).snapshot;
    }
    if (action === "preferences.templateRead") {
      exact(input, ["templateId", "expectedRevision"]);
      const state = await capture(context);
      if (state.snapshot.revision !== input.expectedRevision || !id(input.templateId))
        throw new Error("Template review changed; refresh it");
      const template = state.templates.find((row) => row.id === input.templateId);
      if (!template) throw new Error("Template is unavailable");
      return { revision: state.snapshot.revision, template: { ...template } };
    }
    if (action === "preferences.status") {
      exact(input, ["operationId"]);
      if (!id(input.operationId)) throw new Error("Invalid preference operation");
      const receipt = receipts.get(input.operationId);
      return receipt?.scope === scope(context)
        ? currentStatus(context, receipt.status)
        : { state: "unknown" };
    }
    if (action !== "preferences.patch") throw new Error("Unsupported preference action");
    exact(input, ["operationId", "expectedRevision", "change"]);
    if (
      !id(input.operationId) ||
      !id(input.expectedRevision) ||
      !record(input.change) ||
      !id(input.change.kind)
    )
      throw new Error("Invalid preference change");
    const signature = JSON.stringify(input);
    const previous = receipts.get(input.operationId);
    if (previous) {
      if (previous.scope !== scope(context) || previous.signature !== signature)
        throw new Error("Preference operation identity mismatch");
      return currentStatus(context, previous.status);
    }
    if (receipts.size >= 128) throw new Error("Desktop preference receipt limit reached");
    const receipt = {
      scope: scope(context),
      signature,
      status: { state: "unknown" } as DesktopPreferencesStatus,
    };
    receipts.set(input.operationId, receipt);
    try {
      const state = await capture(context);
      if (state.snapshot.revision !== input.expectedRevision)
        throw new Error("Stale preference review");
      const change = input.change as Record<string, unknown> & { kind: string };
      let apply: () => void;
      let verify: () => boolean;
      if (change.kind.startsWith("template")) {
        let next = state.templates.map((row) => ({ ...row }));
        if (change.kind === "templateDelete") {
          exact(change, ["kind", "templateId"]);
          if (!id(change.templateId) || !next.some((row) => row.id === change.templateId))
            throw new Error("Unknown template");
          next = next.filter((row) => row.id !== change.templateId);
        } else {
          exact(change, ["kind", "templateId", "name", "body", "trigger"]);
          if (change.kind !== "templateCreate" && change.kind !== "templateUpdate")
            throw new Error("Unsupported template change");
          if (
            !id(change.templateId) ||
            typeof change.name !== "string" ||
            !change.name.trim() ||
            change.name.length > 160 ||
            /[\0\r\n]/.test(change.name) ||
            typeof change.body !== "string" ||
            change.body.length > 20_000 ||
            typeof (change.trigger ?? "") !== "string"
          )
            throw new Error("Invalid template");
          const at = next.findIndex((row) => row.id === change.templateId);
          if ((change.kind === "templateCreate") !== at < 0)
            throw new Error("Template identity changed");
          const trigger = normalizeTrigger(change.trigger as string | undefined);
          const template = {
            id: change.templateId,
            name: change.name.trim(),
            body: change.body,
            ...(trigger ? { trigger } : {}),
          };
          if (at < 0) next.push(template);
          else next[at] = template;
        }
        validatePromptTemplates(next);
        apply = () => savePromptTemplates(next);
        verify = () => JSON.stringify(loadPromptTemplates()) === JSON.stringify(next);
      } else if (change.kind === "projectReset") {
        exact(change, ["kind"]);
        const hidden = JSON.stringify(loadProjectProviderSettings(context.projectCwd).hidden);
        apply = () => resetProjectSessionPreferences(context.projectCwd);
        verify = () => {
          const value = loadProjectProviderSettings(context.projectCwd);
          return (
            !value.defaultHarness &&
            !value.defaultModel &&
            !value.models &&
            !value.defaults &&
            JSON.stringify(value.hidden) === hidden
          );
        };
      } else {
        const harness = change.harness;
        const provider = state.snapshot.providers.find((row) => row.id === harness);
        if (!provider) throw new Error("Unsupported provider");
        if (
          [
            "projectDefaultProvider",
            "projectDefaultModel",
            "globalDefaultProvider",
            "globalDefaultModel",
          ].includes(change.kind)
        ) {
          exact(change, ["kind", "harness", "model"]);
          const model = provider.models.find((row) => row.id === change.model);
          if (!model || (change.kind.startsWith("project") && provider.hidden))
            throw new Error("Unavailable model choice");
          if (change.kind === "projectDefaultProvider") {
            apply = () => setProjectDefaultProvider(context.projectCwd, provider.id, model.id);
            verify = () => {
              const value = loadProjectProviderSettings(context.projectCwd);
              return value.defaultHarness === provider.id && value.defaultModel === model.id;
            };
          } else if (change.kind === "projectDefaultModel") {
            apply = () => setProjectDefaultModel(context.projectCwd, provider.id, model.id);
            verify = () =>
              loadProjectProviderSettings(context.projectCwd).models?.[provider.id] === model.id;
          } else if (change.kind === "globalDefaultProvider") {
            apply = () => saveLastModelChoice(provider.id, model.id);
            verify = () =>
              loadLastModelChoice()?.harness === provider.id &&
              loadLastModelChoice()?.model === model.id &&
              loadDefaultModels()[provider.id] === model.id;
          } else {
            apply = () => saveDefaultModel(provider.id, model.id);
            verify = () => loadDefaultModels()[provider.id] === model.id;
          }
        } else if (
          change.kind === "projectProviderDefaults" ||
          change.kind === "globalProviderDefaults"
        ) {
          exact(change, ["kind", "harness", "model", "defaults"]);
          if (!record(change.defaults)) throw new Error("Invalid session defaults");
          exact(change.defaults, ["effort", "runtimeMode", "extras"]);
          const model = provider.models.find((row) => row.id === change.model);
          if (!model) throw new Error("Unknown defaults model");
          const wanted = change.defaults as ProviderSessionDefaults;
          if (
            (wanted.effort !== undefined && !id(wanted.effort)) ||
            (wanted.runtimeMode !== undefined && !modes.includes(wanted.runtimeMode)) ||
            (wanted.extras !== undefined &&
              (!record(wanted.extras) || Object.values(wanted.extras).some((value) => !id(value))))
          )
            throw new Error("Invalid setting values");
          const clean = safeDefaults(wanted, model, provider.runtimeModes);
          if (clean.unsupported) throw new Error("Unavailable session setting");
          if (change.kind === "projectProviderDefaults") {
            apply = () => setProjectSessionDefaults(context.projectCwd, provider.id, clean.safe);
            verify = () =>
              JSON.stringify(
                loadProjectProviderSettings(context.projectCwd).defaults?.[provider.id] ?? {},
              ) === JSON.stringify(normalizeProviderDefaults(clean.safe));
          } else {
            apply = () => saveGlobalSessionDefaults(provider.id, clean.safe);
            verify = () =>
              JSON.stringify(loadGlobalSessionDefaults()[provider.id] ?? {}) ===
              JSON.stringify(normalizeProviderDefaults(clean.safe));
          }
        } else throw new Error("Unsupported preference change");
      }
      assert(context);
      if (
        rawMetadata() !== state.raw ||
        privacy() !== state.lock ||
        deps.catalogRevision() !== state.catalogRevision
      )
        throw new Error("Preference review changed before saving");
      apply();
      if (!verify()) throw new Error("Desktop preference readback did not match");
      receipt.status = { state: "applied", snapshot: (await capture(context)).snapshot };
    } catch {
      receipt.status = {
        state: "failed",
        message:
          "Could not verify the desktop preference change. Refresh before reviewing another change.",
      };
    }
    return receipt.status;
  };
}
export const handleDesktopPreferences = createDesktopPreferencesControl();
