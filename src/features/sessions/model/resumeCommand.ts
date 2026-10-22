import { t } from "../../../shared/i18n";
import type { BuiltinSkill } from "../../skills/model/skills";

/**
 * Opens the picker of terminal conversations recorded for this
 * project, so one can be continued in Bycoda. Named `/resume` because that
 * is what people reach for after using the CLI, even though the CLI's own
 * `/resume` is an interactive screen that headless mode has no equivalent of.
 */
export const RESUME_COMMAND: BuiltinSkill = {
  kind: "builtin",
  name: "resume",
  invocation: "resume",
  get description() {
    return t("Import and continue a Claude Code or Codex conversation in this project.");
  },
  scope: "builtin",
  source: "bycoda",
};

export function isResumeCommand(text: string): boolean {
  return /^\s*\/\s*resume\s*$/.test(text);
}
