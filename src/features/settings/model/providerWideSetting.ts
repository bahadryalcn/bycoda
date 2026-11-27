import type { AgentModel, ModelSetting } from "../../sessions/public/models";

/** Settings whose choices differ per model while one provider default covers every model. */
const PROVIDER_WIDE = new Set(["serviceTier", "fast"]);

/**
 * A provider default applies to whichever model a conversation starts on, so a speed setting
 * offers every tier any of the provider's models has (Codex Ultrafast is offered by some models
 * only). The selected model's own order comes first. A model without the saved tier starts on its
 * catalog default, as with any value it does not offer.
 */
export function providerWideSetting(
  setting: ModelSetting,
  models: readonly AgentModel[],
): ModelSetting {
  if (!PROVIDER_WIDE.has(setting.id)) return setting;
  const options = [...setting.options];
  for (const model of models)
    for (const other of model.settings ?? [])
      if (other.id === setting.id)
        for (const option of other.options)
          if (!options.some((known) => known.value === option.value)) options.push(option);
  return options.length === setting.options.length ? setting : { ...setting, options };
}

/**
 * Provider-wide settings the selected model does not offer but another model of the provider does
 * (Codex service tier on one model only). They stay visible, since the default covers every model.
 * `settingsFor` builds the picker settings for another model, so values resolve as for the selected one.
 */
export function missingProviderWideSettings(
  present: readonly ModelSetting[],
  models: readonly AgentModel[],
  settingsFor: (model: AgentModel) => readonly ModelSetting[],
): ModelSetting[] {
  const found: ModelSetting[] = [];
  for (const id of PROVIDER_WIDE) {
    if (present.some((setting) => setting.id === id)) continue;
    const owner = models.find((model) => model.settings?.some((setting) => setting.id === id));
    const setting = owner && settingsFor(owner).find((candidate) => candidate.id === id);
    if (setting) found.push(setting);
  }
  return found;
}
