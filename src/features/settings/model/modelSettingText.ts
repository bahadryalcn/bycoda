import { getLocale, t } from "../../../shared/i18n";

let cached: { locale: string; labels: Record<string, string> } | null = null;

/**
 * Every label, option and description the provider catalogs give a model setting. Catalogs hand the
 * UI English source text, so each one is written here as a literal `t()` the locale check can extract.
 */
function buildModelSettingLabels(): Record<string, string> {
  return {
    Reasoning: t("Reasoning"),
    Low: t("Low"),
    Medium: t("Medium"),
    High: t("High"),
    Max: t("Max"),
    "Extra High": t("Extra High"),
    Fast: t("Fast"),
    On: t("On"),
    Off: t("Off"),
    Context: t("Context"),
    Standard: t("Standard"),
    Effort: t("Effort"),
    Agent: t("Agent"),
    Yes: t("Yes"),
    No: t("No"),
    "Auto-compact": t("Auto-compact"),
    "Automatically compact when context fills up. Default follows your provider settings. Manual compaction remains available.":
      t(
        "Automatically compact when context fills up. Default follows your provider settings. Manual compaction remains available.",
      ),
    Default: t("Default"),
    "Auto-compact window": t("Auto-compact window"),
    "Automatically compact at this token count. Default follows your provider settings. The model's context window remains the limit.":
      t(
        "Automatically compact at this token count. Default follows your provider settings. The model's context window remains the limit.",
      ),
    Advisor: t("Advisor"),
    "Experimental second opinion. Uses extra tokens; requires a compatible Claude Code version, model and account. Fable may require usage-credit consent in Claude Code.":
      t(
        "Experimental second opinion. Uses extra tokens; requires a compatible Claude Code version, model and account. Fable may require usage-credit consent in Claude Code.",
      ),
    "Claude default": t("Claude default"),
    "Compacts the conversation automatically when the context fills up. Claude default keeps your Claude Code /config choice. Manual /compact always works.":
      t(
        "Compacts the conversation automatically when the context fills up. Claude default keeps your Claude Code /config choice. Manual /compact always works.",
      ),
    "How many tokens the context may hold before auto-compacting. Overrides a window saved with /autocompact. Claude Code caps it at the model's context window.":
      t(
        "How many tokens the context may hold before auto-compacting. Overrides a window saved with /autocompact. Claude Code caps it at the model's context window.",
      ),
    "Subagent model": t("Subagent model"),
    "Chooses the default model for delegated work. Agent definitions and per-call choices can override it. Aliases use the version configured by Claude Code.":
      t(
        "Chooses the default model for delegated work. Agent definitions and per-call choices can override it. Aliases use the version configured by Claude Code.",
      ),
    "Subagent model policy": t("Subagent model policy"),
    "Agent's choice uses your subagent model only for agents that set no model. Override all uses it for every agent, including Explore and Plan. Requires Claude Code 2.1.257 or later. Forks and skills with model: inherit keep the main model.":
      t(
        "Agent's choice uses your subagent model only for agents that set no model. Override all uses it for every agent, including Explore and Plan. Requires Claude Code 2.1.257 or later. Forks and skills with model: inherit keep the main model.",
      ),
    "Agent's choice": t("Agent's choice"),
    "Override all": t("Override all"),
    "Image models": t("Image models"),
    Automatic: t("Automatic"),
    Subagents: t("Subagents"),
    "Subagent max effort": t("Subagent max effort"),
    "The highest thinking level a subagent may use, whatever the main model's own level. Automatic sets no limit.":
      t(
        "The highest thinking level a subagent may use, whatever the main model's own level. Automatic sets no limit.",
      ),
  };
}

/** The translated text of a model-setting label, option or description; unknown text is shown as given. */
export function modelSettingText(text: string): string {
  const locale = getLocale();
  if (cached?.locale !== locale) cached = { locale, labels: buildModelSettingLabels() };
  return cached.labels[text] ?? text;
}
