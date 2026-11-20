import { t } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import type { Skill } from "./skills";

/**
 * Built-in CLI descriptions are English catalog text (`cliCommandCatalog.ts`). Each one is
 * listed here with its own `t()` call so the locale check finds it. Reported and on-disk
 * descriptions are provider text and are shown as written.
 */
const BUILT_IN_DESCRIPTIONS = new Map<string, () => string>([
  [
    "Set a persistent Codex goal, show its progress, pause or clear it",
    () => t("Set a persistent Codex goal, show its progress, pause or clear it"),
  ],
  ["Set a goal Claude checks before stopping", () => t("Set a goal Claude checks before stopping")],
  [
    "Initialize a new CLAUDE.md file with codebase documentation",
    () => t("Initialize a new CLAUDE.md file with codebase documentation"),
  ],
  [
    "Complete a security review of the pending changes on the current branch",
    () => t("Complete a security review of the pending changes on the current branch"),
  ],
  ["Show current context usage", () => t("Show current context usage")],
  ["Show session cost and plan usage", () => t("Show session cost and plan usage")],
]);

/** Origin labels the CLI command merge writes; anything else is shown as stored. */
function originLabel(origin: string): string {
  switch (origin) {
    case "built-in":
      return t("Built-in");
    case "project command":
      return t("Project command");
    case "user command":
      return t("Personal command");
    case "plugin":
      return t("Plugin");
    case "skill":
      return t("Skill");
    case "session":
      return t("Session");
    default:
      return origin;
  }
}

/** The badge shown beside a picker row. Provider names (`claude`, `codex`) stay as they are. */
export function skillScopeLabel(skill: Skill): string {
  if (skill.kind === "native") {
    return skill.origin ? `${skill.source} · ${originLabel(skill.origin)}` : skill.source;
  }
  if (skill.kind === "builtin") return PRODUCT_IDENTITY.displayName;
  if (skill.kind === "template") return t("Templates");
  if (skill.scope === "user") return t("Personal");
  if (skill.source !== "agents" && skill.source !== "bycoda") return skill.source;
  return t("Project");
}

/** The row description. Only built-in catalog text is translated; provider text is kept. */
export function skillPickerDescription(skill: Skill): string {
  if (skill.kind !== "native" || skill.origin !== "built-in") return skill.description;
  return BUILT_IN_DESCRIPTIONS.get(skill.description)?.() ?? skill.description;
}
