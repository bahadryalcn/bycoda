/**
 * Tools a Claude turn may not use. `subagentModel: "off"` means the owner's
 * subagent selection has no model Claude's native Agent tool can honor, so the
 * tool is removed instead of letting it pick any Claude model.
 */
export function claudeDisallowedTools(input: {
  subagentModel?: string;
  disabledSkills?: readonly string[];
}): string[] {
  return [
    ...(input.disabledSkills ?? []).map((name) => `Skill(${name})`),
    ...(input.subagentModel === "off" ? ["Agent", "Task"] : []),
  ];
}
