import { IMAGE_MODELS_KEY } from "../../../shared/model/host-contracts/image-models";
import {
  carryCrossDelegation,
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENTS_KEY,
} from "../../../shared/model/host-contracts/delegation";
import {
  loadProjectProviderSettings,
  normalizeProviderDefaults,
  type ProviderSessionDefaults,
} from "./projectProviders";
import { loadLastModelSettings, modelEffortSetting, modelsFor, type AgentModel } from "./models";
import {
  ACCOUNT_DEFAULTS_KEY,
  accountSessionDefaults,
  accountSessionDefaultsSnapshot,
  newSessionAccountId,
  SESSION_DEFAULTS_CHANGE,
} from "./accountSessionDefaults";
import { productProviderDefaults } from "../../../shared/model/productProviderDefaults";
import type { HarnessId } from "./session";

const KEY = "bycoda.providerSessionDefaults.v1";
const CHANGE = SESSION_DEFAULTS_CHANGE;

/** Effective product values for presentation; these are not saved overrides. */
export function productSessionDefaults(
  harness: HarnessId,
  accountId?: string,
): ProviderSessionDefaults {
  const { model: _model, ...defaults } = productProviderDefaults(
    harness,
    modelsFor(harness),
    newSessionAccountId(harness, accountId),
  );
  return defaults;
}

export function mergeProviderExtras(
  harness: HarnessId,
  base: Record<string, string> | undefined,
  override: Record<string, string> | undefined,
): Record<string, string> {
  const next = { ...base };
  if (harness === "claude" && override?.subagentModel != null && override.crossSubagents == null)
    delete next[CROSS_SUBAGENTS_KEY];
  if (harness === "claude" && override?.advisor != null && override.crossAdvisor == null)
    delete next[CROSS_ADVISOR_KEY];
  return { ...next, ...override };
}

/** Product defaults plus saved global values, without account or project overrides. */
export function globalProviderSessionDefaults(
  harness: HarnessId,
  accountId?: string,
): ProviderSessionDefaults {
  const product = productSessionDefaults(harness, accountId);
  const global = loadGlobalSessionDefaults()[harness];
  return normalizeProviderDefaults({
    ...product,
    ...global,
    extras: mergeProviderExtras(harness, product.extras, global?.extras),
  });
}

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

/**
 * Defaults for a new conversation: the provider's global values, then the
 * account's own (the default account when none is given), then the project's.
 */
export function providerSessionDefaults(
  harness: HarnessId,
  cwd?: string,
  accountId?: string,
): ProviderSessionDefaults {
  const product = productSessionDefaults(harness, accountId);
  const global = loadGlobalSessionDefaults()[harness];
  const { model: _model, ...account } = accountSessionDefaults(harness, accountId);
  const project = loadProjectProviderSettings(cwd).defaults?.[harness];
  const recent = loadLastModelSettings();
  const recentDelegation = Object.fromEntries(
    [
      CROSS_SUBAGENTS_KEY,
      CROSS_ADVISOR_KEY,
      IMAGE_MODELS_KEY,
      ...(harness === "claude" ? ["advisor", "subagentModel"] : []),
    ]
      .filter((key) => recent[key] != null)
      .map((key) => [key, recent[key]]),
  );
  const extras = [recentDelegation, global?.extras, account.extras, project?.extras].reduce<
    Record<string, string>
  >((base, override) => mergeProviderExtras(harness, base, override), product.extras ?? {});
  return normalizeProviderDefaults({ ...product, ...global, ...account, ...project, extras });
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
  // An explicit empty selection overrides both recent settings and global defaults.
  for (const key of [CROSS_SUBAGENTS_KEY, CROSS_ADVISOR_KEY, IMAGE_MODELS_KEY]) {
    if (defaults.extras?.[key] != null) delete next[key];
  }
  return carryCrossDelegation(defaults.extras, next);
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
    if (event.key === KEY || event.key === ACCOUNT_DEFAULTS_KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGE, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(CHANGE, listener);
    window.removeEventListener("storage", storage);
  };
}

export function providerSessionDefaultsSnapshot(): string {
  return JSON.stringify([loadGlobalSessionDefaults(), accountSessionDefaultsSnapshot()]);
}
