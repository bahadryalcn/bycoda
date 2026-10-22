import {
  loadProjectProviderSettings,
  normalizeProviderDefaults,
  type ProviderSessionDefaults,
} from "./projectProviders";
import { modelEffortSetting, type AgentModel } from "./models";
import type { HarnessId } from "./session";

const KEY = "bycoda.providerSessionDefaults.v1";
const CHANGE = "bycoda:provider-session-defaults";

export function loadGlobalSessionDefaults(): Partial<Record<HarnessId, ProviderSessionDefaults>> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Partial<Record<HarnessId, ProviderSessionDefaults>> = {};
    for (const [harness, entry] of Object.entries(value)) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        out[harness as HarnessId] = normalizeProviderDefaults(entry);
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function providerSessionDefaults(harness: HarnessId, cwd?: string): ProviderSessionDefaults {
  const global = loadGlobalSessionDefaults()[harness];
  const project = loadProjectProviderSettings(cwd).defaults?.[harness];
  const extras = { ...global?.extras, ...project?.extras };
  return normalizeProviderDefaults({ ...global, ...project, extras });
}

/**
 * Applies the provider's default effort and extras to a fresh model selection.
 * Values the model does not offer are skipped.
 */
export function applySessionDefaults(
  model: AgentModel,
  settings: Record<string, string>,
  defaults: ProviderSessionDefaults,
): Record<string, string> {
  const next = { ...settings };
  const wanted: Record<string, string> = { ...defaults.extras };
  const effort = modelEffortSetting(model);
  if (effort && defaults.effort) wanted[effort.id] = defaults.effort;
  for (const setting of model.settings ?? []) {
    const value = wanted[setting.id];
    if (value && setting.options.some((option) => option.value === value)) {
      next[setting.id] = value;
    }
  }
  return next;
}

export function saveGlobalSessionDefaults(
  harness: HarnessId,
  defaults: ProviderSessionDefaults,
): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        ...loadGlobalSessionDefaults(),
        [harness]: normalizeProviderDefaults(defaults),
      }),
    );
  } catch {
    // Private mode / quota.
  }
  window.dispatchEvent(new CustomEvent(CHANGE));
}

export function subscribeProviderSessionDefaults(listener: () => void): () => void {
  const storage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGE, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(CHANGE, listener);
    window.removeEventListener("storage", storage);
  };
}

export function providerSessionDefaultsSnapshot(): string {
  return JSON.stringify(loadGlobalSessionDefaults());
}
