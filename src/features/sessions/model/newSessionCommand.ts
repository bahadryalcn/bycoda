import { t } from "../../../shared/i18n";
import type { BuiltinSkill } from "../../skills/model/skills";

export type NewSessionOptions = { preserveSettings?: boolean };

export const CLEAR_SESSION_COMMAND: BuiltinSkill = {
  kind: "builtin",
  name: "clear",
  invocation: "clear",
  get description() {
    return t("Clear conversation");
  },
  scope: "builtin",
  source: "bycoda",
};

export function isClearSessionCommand(text: string): boolean {
  return /^\s*\/clear\s*$/i.test(text);
}

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
