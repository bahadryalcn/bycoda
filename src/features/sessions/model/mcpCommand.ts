import { t } from "../../../shared/i18n";
import type { BuiltinSkill } from "../../skills/model/skills";

export const MCP_COMMAND: BuiltinSkill = {
  kind: "builtin",
  name: "mcp",
  invocation: "mcp",
  get description() {
    return t("Find an MCP server for this message.");
  },
  scope: "builtin",
  source: "bycoda",
};

export function isMcpCommand(text: string): boolean {
  return /^\s*\/mcp\s*$/i.test(text);
}
