/** Everything that edits files or runs commands; a read-only crew member loses all of it. */
export const CLAUDE_WRITE_TOOLS: readonly string[] = [
  "Bash",
  "PowerShell",
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
];

/**
 * Tools a Claude turn may not use. `subagentModel: "off"` means the owner's
 * subagent selection has no model Claude's native Agent tool can honor, so the
 * tool is removed instead of letting it pick any Claude model.
 */
/** Native-tool restrictions a Claude launch carries: owner-disabled skills, crew read-only. */
export type ClaudeNativeLimits = { disabledSkills?: readonly string[]; nativeReadOnly?: boolean };

export function claudeDisallowedTools(
  input: { subagentModel?: string } & ClaudeNativeLimits,
): string[] {
  return [
    ...(input.nativeReadOnly ? CLAUDE_WRITE_TOOLS : []),
    ...(input.disabledSkills ?? []).map((name) => `Skill(${name})`),
    ...(input.subagentModel === "off" ? ["Agent", "Task"] : []),
  ];
}
