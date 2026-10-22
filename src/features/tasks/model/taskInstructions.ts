/** A versioned task brief. Stored as text for compatibility with older hosts. */
export type TaskInstructions = {
  schema: "bycoda.task.v1";
  objective: string;
  deliverables: string[];
  acceptance: string[];
  constraints: string[];
  verification: string[];
};

export function readTaskInstructions(value: unknown): TaskInstructions | undefined {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const brief = parsed as Record<string, unknown>;
    if (
      brief.schema !== "bycoda.task.v1" ||
      typeof brief.objective !== "string" ||
      !brief.objective.trim()
    )
      return;
    const keys = ["deliverables", "acceptance", "constraints", "verification"] as const;
    if (
      keys.some(
        (key) =>
          !Array.isArray(brief[key]) ||
          (brief[key] as unknown[]).some((item) => typeof item !== "string"),
      )
    )
      return;
    // Reject unknown fields rather than silently dropping instructions.
    if (Object.keys(brief).some((key) => !["schema", "objective", ...keys].includes(key))) return;
    return brief as TaskInstructions;
  } catch {
    return undefined;
  }
}

export function taskInstructionsMarkdown(prompt: string): string {
  const brief = readTaskInstructions(prompt);
  if (!brief) return prompt;
  return [
    brief.objective,
    ...(
      [
        ["Deliverables", brief.deliverables],
        ["Acceptance criteria", brief.acceptance],
        ["Constraints", brief.constraints],
        ["Verification", brief.verification],
      ] as const
    )
      .filter(([, items]) => items.length)
      .map(([title, items]) => `### ${title}\n\n${items.map((item) => `- ${item}`).join("\n")}`),
  ].join("\n\n");
}

export function taskInstructionsSummary(prompt: string): string {
  return readTaskInstructions(prompt)?.objective ?? prompt.trim();
}
