import { storedFlag } from "../../../shared/lib/storedSetting";

export const CLAUDE_HOOKS_DEFAULT = true;

const claudeHooksSetting = storedFlag(
  "bycoda.claudeHooks",
  CLAUDE_HOOKS_DEFAULT,
  "bycoda:claude-hooks-change",
  true,
);
export const subscribeClaudeHooks = claudeHooksSetting.subscribe;

export function loadClaudeHooks(): boolean {
  return claudeHooksSetting.load() ?? CLAUDE_HOOKS_DEFAULT;
}

export function saveClaudeHooks(value: boolean) {
  claudeHooksSetting.save(value);
}
