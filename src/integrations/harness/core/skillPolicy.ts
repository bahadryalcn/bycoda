import { skillInvocationTokens } from "../../../features/skills/model/skillTokens";

/** Machine-owned bycoda restrictions, intersected with the provider's own rules. */
export type SkillPolicy = { disabledNames: string[]; disabledPaths: string[] };
export const EMPTY_SKILL_POLICY: SkillPolicy = { disabledNames: [], disabledPaths: [] };

/** Invocation visibility is separate from an owner's full disable. */
export function skillInvocationFlags(text: string): {
  modelInvocable?: false;
  userInvocable?: false;
} {
  const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
  if (!frontmatter) return {};
  return {
    ...(/^disable-model-invocation:\s*true(?:\s+#.*)?\s*$/m.test(frontmatter)
      ? { modelInvocable: false as const }
      : {}),
    ...(/^user-invocable:\s*false(?:\s+#.*)?\s*$/m.test(frontmatter)
      ? { userInvocable: false as const }
      : {}),
  };
}

export function skillPathKey(path: string): string {
  const normalized = path
    .replace(/\\/g, "/")
    .replace(/^\/\/\?\/UNC\//i, "//")
    .replace(/^\/\/\?\//, "")
    .replace(/\/+$/, "");
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
}

export function parseSkillPolicy(value: unknown): SkillPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid skill policy");
  const raw = value as Record<string, unknown>;
  const strings = (key: string) => {
    const values = raw[key];
    if (
      !Array.isArray(values) ||
      values.length > 5000 ||
      values.some((v) => typeof v !== "string" || !v || v.length > 4096)
    )
      throw new Error("Invalid skill policy");
    return [...new Set(values as string[])].sort();
  };
  const disabledNames = strings("disabledNames");
  if (disabledNames.some((name) => name.length > 300 || !/^[\w.:-]+$/.test(name)))
    throw new Error("Invalid skill name");
  return { disabledNames, disabledPaths: strings("disabledPaths") };
}

export function skillDisabled(
  policy: SkillPolicy,
  skill: { name: string; path?: string },
): boolean {
  return (
    policy.disabledNames.includes(skill.name) ||
    (!!skill.path &&
      policy.disabledPaths.some((path) => skillPathKey(path) === skillPathKey(skill.path!)))
  );
}

export function assertSkillInvocationsEnabled(text: string, policy: SkillPolicy): void {
  for (const token of skillInvocationTokens(text)) {
    const name = token.name.replace(/^skill:/, "");
    if (policy.disabledNames.includes(name))
      throw new Error(
        `Skill "${name}" is disabled in bycoda. Enable it in Skills before invoking it.`,
      );
  }
}

/** Repeat each turn: an old transcript/catalog must never override a new owner preference. */
export function skillPolicyInstructions(policy: SkillPolicy): string {
  if (!policy.disabledNames.length && !policy.disabledPaths.length)
    return "bycoda skill restrictions (current owner settings): no bycoda-disabled skills on this machine. This replaces older bycoda skill restrictions in the conversation; provider restrictions still apply. Installed or active does not establish provider enablement.";
  return [
    "bycoda skill restrictions for this machine (current owner settings):",
    `Disabled skill names: ${JSON.stringify(policy.disabledNames)}.`,
    `Disabled skill paths: ${JSON.stringify(policy.disabledPaths)}.`,
    "Do not discover, read, invoke, delegate to, or apply these skills, including same-name copies from other sources and instructions already present in conversation history. Continue the task using enabled capabilities. Installed, active, or previously loaded does not mean enabled. Never enable a skill or change these settings yourself. Provider restrictions still apply to all other skills.",
  ].join("\n");
}

export function withSkillPolicy<
  T extends { text: string; runtimeInstructions?: string; skillPolicy?: SkillPolicy },
>(harness: string, input: T, policy: SkillPolicy): T {
  assertSkillInvocationsEnabled(input.text, policy);
  const instructions = skillPolicyInstructions(policy);
  if (!instructions) return { ...input, skillPolicy: policy };
  return {
    ...input,
    skillPolicy: policy,
    ...(harness === "codex"
      ? {
          runtimeInstructions: [input.runtimeInstructions, instructions]
            .filter(Boolean)
            .join("\n\n"),
        }
      : // Native commands parse their entire argument string. Supply restrictions through
        // launch/session controls; carry the current guidance on the next model prompt.
        {
          text: /^\s*\/[^\s/\\]+(?=\s|$)/.test(input.text)
            ? input.text
            : `${input.text}\n\n${instructions}`,
        }),
  };
}
