import { t } from "../../../shared/i18n";
import type { BuiltinSkill } from "../../skills/model/skills";

export const COMPACT_COMMAND: BuiltinSkill = {
  kind: "builtin",
  name: "compact",
  invocation: "compact",
  get description() {
    return t("Summarize older conversation context to free space.");
  },
  scope: "builtin",
  source: "bycoda",
};

/** Match the standalone composer command without consuming ordinary prompt text. */
export function isCompactCommand(text: string): boolean {
  return /^\s*\/compact\s*$/i.test(text);
}
