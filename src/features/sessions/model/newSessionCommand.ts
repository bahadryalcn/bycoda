import { t } from "../../../shared/i18n";
import type { BuiltinSkill } from "../../skills/model/skills";

export const NEW_SESSION_COMMAND: BuiltinSkill = {
  kind: "builtin",
  name: "new",
  invocation: "new",
  get description() {
    return t("New session");
  },
  scope: "builtin",
  source: "bycoda",
};

/** Only a standalone command opens a tab; ordinary prompt text stays intact. */
export function isNewSessionCommand(text: string): boolean {
  return /^\s*\/new\s*$/i.test(text);
}
