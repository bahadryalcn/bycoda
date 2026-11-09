import type { HarnessId } from "../../../shared/model/harnessIdentity";
import {
  persistProviderPreference,
  type ProviderPreferenceOutcome,
} from "../../providers/public/providerPreferenceOutcome";
import {
  defaultModelId,
  loadDefaultModels,
  loadHiddenPickerProviders,
  loadLastModelChoice,
  saveDefaultModel,
  saveLastModelChoice,
  savePickerProviderVisible,
} from "../../sessions/public/models";
import {
  clearProjectModelChoice,
  loadProjectProviderSettings,
  normalizeProviderDefaults,
  projectProviderSettingsPersisted,
  setProjectDefaultModel,
  setProjectDefaultProvider,
  setProjectProviderHidden,
  setProjectSessionDefaults,
} from "../../sessions/public/projectProviders";
import {
  accountSessionDefaults,
  loadGlobalSessionDefaults,
  normalizeAccountDefaults,
  saveAccountSessionDefaults,
  saveGlobalSessionDefaults,
} from "../../sessions/public/providerSessionDefaults";
import {
  overlaySessionDefaults,
  parseAccountDraftKey,
  targetProjects,
  type DefaultsDraft,
  type DefaultsTarget,
  type ProviderDefaultsChange,
} from "./providerDefaultsDraft";

/** The model new conversations use for a provider when no project overrides it. */
export function globalModelFor(harness: HarnessId): string {
  const choice = loadLastModelChoice();
  return (
    loadDefaultModels()[harness] ??
    (choice?.harness === harness ? choice.model : defaultModelId(harness))
  );
}

/** The model a project stores for a provider; undefined when it follows Global. */
export function storedProjectModel(project: string, harness: HarnessId): string | undefined {
  const settings = loadProjectProviderSettings(project);
  return (
    settings.models?.[harness] ??
    (settings.defaultHarness === harness ? settings.defaultModel : undefined)
  );
}

const sessionChanged = (change: ProviderDefaultsChange) =>
  change.effort !== undefined || change.runtimeMode !== undefined || change.extras !== undefined;

const json = (value: unknown) => JSON.stringify(value ?? {});

function writeGlobal(draft: DefaultsDraft, checks: (() => boolean)[]) {
  for (const [harness, change] of Object.entries(draft.providers) as [
    HarnessId,
    ProviderDefaultsChange,
  ][]) {
    const model = change.model;
    if (typeof model === "string") {
      const follows = loadLastModelChoice()?.harness === harness;
      saveDefaultModel(harness, model);
      if (follows) saveLastModelChoice(harness, model);
      checks.push(() => loadDefaultModels()[harness] === model);
    }
    if (sessionChanged(change)) {
      const next = normalizeProviderDefaults(
        overlaySessionDefaults(loadGlobalSessionDefaults()[harness] ?? {}, change),
      );
      saveGlobalSessionDefaults(harness, next);
      checks.push(() => json(loadGlobalSessionDefaults()[harness]) === json(next));
    }
    if (change.hidden !== undefined) {
      const hidden = change.hidden;
      savePickerProviderVisible(harness, !hidden);
      checks.push(() => loadHiddenPickerProviders().includes(harness) === hidden);
    }
  }
  const provider = draft.defaultProvider;
  if (provider) {
    const model = globalModelFor(provider);
    saveLastModelChoice(provider, model);
    checks.push(() => loadLastModelChoice()?.harness === provider);
  }
}

function writeProject(project: string, draft: DefaultsDraft) {
  for (const [harness, change] of Object.entries(draft.providers) as [
    HarnessId,
    ProviderDefaultsChange,
  ][]) {
    if (typeof change.model === "string") setProjectDefaultModel(project, harness, change.model);
    else if (change.model === null) clearProjectModelChoice(project, harness);
    if (sessionChanged(change)) {
      const stored = loadProjectProviderSettings(project).defaults?.[harness] ?? {};
      setProjectSessionDefaults(project, harness, overlaySessionDefaults(stored, change));
    }
    if (change.hidden !== undefined) setProjectProviderHidden(project, harness, change.hidden);
  }
  const provider = draft.defaultProvider;
  if (provider) {
    const model = storedProjectModel(project, provider) ?? globalModelFor(provider);
    setProjectDefaultProvider(project, provider, model);
  }
}

function writeAccounts(draft: DefaultsDraft, checks: (() => boolean)[]) {
  for (const [key, change] of Object.entries(draft.accounts)) {
    const { harness, accountId } = parseAccountDraftKey(key);
    const { model, ...own } = accountSessionDefaults(harness, accountId);
    const next = normalizeAccountDefaults({
      ...overlaySessionDefaults(own, change),
      model: change.model === undefined ? model : (change.model ?? undefined),
    });
    saveAccountSessionDefaults(harness, accountId, next);
    checks.push(() => json(accountSessionDefaults(harness, accountId)) === json(next));
  }
}

/**
 * Writes the change set to the target, then reads it back. Storage that refuses the write
 * reports "unsaved" so the page keeps the draft and offers a retry.
 */
export function saveDefaultsDraft(
  draft: DefaultsDraft,
  target: DefaultsTarget,
): ProviderPreferenceOutcome {
  const checks: (() => boolean)[] = [];
  return persistProviderPreference(
    () => {
      writeAccounts(draft, checks);
      if (target.kind === "global") {
        writeGlobal(draft, checks);
        return;
      }
      const projects = targetProjects(target);
      if (projects.length === 0) throw new Error("This group has no projects yet.");
      for (const project of projects) writeProject(project, draft);
      checks.push(projectProviderSettingsPersisted);
    },
    () => checks.every((check) => check()),
  );
}
