import type { SkillPolicy } from "../../../integrations/harness/core/skillPolicy";

export type ProviderScopedSkill = { name: string; path: string; installProvider?: string };

/** Per-operation restrictions; installation targets never mutate owner preferences. */
export function withInstalledSkillScope(
  policy: SkillPolicy,
  provider: string,
  candidates: readonly ProviderScopedSkill[],
): SkillPolicy {
  const excluded = candidates.filter(
    (skill) =>
      skill.installProvider &&
      skill.installProvider !== "all" &&
      skill.installProvider !== provider,
  );
  if (!excluded.length) return policy;
  const eligible = new Set(
    candidates
      .filter(
        (skill) =>
          !skill.installProvider ||
          skill.installProvider === "all" ||
          skill.installProvider === provider,
      )
      .map((skill) => skill.name),
  );
  return {
    disabledNames: [
      ...new Set([
        ...policy.disabledNames,
        ...excluded.filter((skill) => !eligible.has(skill.name)).map((skill) => skill.name),
      ]),
    ],
    disabledPaths: [...new Set([...policy.disabledPaths, ...excluded.map((skill) => skill.path)])],
  };
}
